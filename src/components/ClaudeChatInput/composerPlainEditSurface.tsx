import { AIChatInput, ConfigProvider as SemiConfigProvider } from "@douyinfe/semi-ui";
import semiLocaleZhCN from "@douyinfe/semi-ui/lib/es/locale/source/zh_CN";
import type { Content } from "@douyinfe/semi-ui/lib/es/aiChatInput/interface";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { AIChatInput as AIChatInputType } from "@douyinfe/semi-ui";
import { loadSlashCatalog } from "../../services/slashCatalogCache";
import { useAtMentionDefaultTarget } from "../../hooks/useAtMentionDefaultTarget";
import { SlashPopover } from "./slash-popover";
import type { ComposerPlainSurface } from "./slash-popover";
import type { TriggerInfo } from "./slash-trigger";
import type { SessionExecutionEngine } from "../../constants/sessionExecutionEngine";
import { composerTokenHighlightExtensions } from "./composerTokenHighlightExtension";
import {
  contentsToPlain,
  detectAtSlashTrigger,
  isAtSlashTriggerSuppressedByPaste,
  normalizeComposerEditorPlain,
  PASTE_TRIGGER_SUPPRESS_MS,
} from "./composer-plain-utils";
import { shouldSkipStaleComposerSetContent } from "./composerSetContentGuard";
import { syncComposerHighlightMarksOnEditor } from "./composerTokenHighlight";
import {
  focusComposerAtPlainOffset,
  getComposerEditorCaretRectAtPlainOffset,
  resolveComposerProseMirrorView,
  type ComposerProseMirrorEditor,
} from "./composer-trigger-anchor";
import "./composer-semi-tokens.css";

const SAFE_AI_CHAT_SET_CONTENT_MAX_FRAMES = 48;

function readSemiEditorPlain(
  ed: { getText?: (opts?: { blockSeparator?: string }) => string } | null | undefined,
): string {
  if (!ed?.getText) return "";
  try {
    return normalizeComposerEditorPlain(ed.getText({ blockSeparator: "\n" }) ?? "");
  } catch {
    return "";
  }
}

function isProseMirrorFocused(shell: HTMLElement | null): boolean {
  if (!shell) return false;
  const pm = shell.querySelector(".ProseMirror");
  if (!pm) return false;
  const ae = document.activeElement;
  return ae === pm || (ae instanceof Node && pm.contains(ae));
}

function scheduleSafeAiChatSetContent(
  resolveAiChat: () => InstanceType<typeof AIChatInputType> | null,
  content: string,
  onAfterSet?: () => void,
  shell?: HTMLElement | null,
): void {
  const attempt = (): boolean => {
    const ai = resolveAiChat();
    const ed = ai?.getEditor?.();
    if (!ai || !ed) return false;
    const editorPlain = readSemiEditorPlain(ed);
    if (shouldSkipStaleComposerSetContent(editorPlain, content, isProseMirrorFocused(shell ?? null))) {
      syncComposerHighlightMarksOnEditor(ed);
      onAfterSet?.();
      return true;
    }
    try {
      ai.setContent(content);
    } catch {
      return false;
    }
    syncComposerHighlightMarksOnEditor(ed);
    onAfterSet?.();
    return true;
  };
  if (attempt()) return;
  let frames = 0;
  const tick = (): void => {
    if (attempt()) return;
    frames += 1;
    if (frames >= SAFE_AI_CHAT_SET_CONTENT_MAX_FRAMES) return;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function resolveAtSlashTriggerAnchorRect(
  aiChat: InstanceType<typeof AIChatInputType> | null,
  shell: HTMLDivElement | null,
  plain: string,
  cursor: number,
): DOMRect | null {
  const detected = detectAtSlashTrigger(plain, cursor);
  if (!detected) return null;
  const rawEd = aiChat?.getEditor?.();
  const view = resolveComposerProseMirrorView(rawEd);
  if (
    view &&
    rawEd &&
    typeof rawEd === "object" &&
    "state" in rawEd &&
    (rawEd as ComposerProseMirrorEditor).state?.doc
  ) {
    const caret = getComposerEditorCaretRectAtPlainOffset(
      { state: (rawEd as ComposerProseMirrorEditor).state, view },
      detected.triggerStart,
    );
    if (caret) return caret;
  }
  return shell?.getBoundingClientRect() ?? null;
}

export interface ComposerPlainEditSurfaceProps {
  value: string;
  onChange: (plain: string) => void;
  repositoryPath?: string;
  employeeMentions?: Array<{ id: string; name: string }>;
  teamMentions?: Array<{ id: string; name: string }>;
  /** 当前会话执行引擎：决定 `/` 补全展示哪套内置命令（与会话输入框一致）。 */
  sessionExecutionEngine?: SessionExecutionEngine;
  codexAvailable?: boolean;
  cursorAvailable?: boolean;
  geminiAvailable?: boolean;
  opencodeAvailable?: boolean;
  qoderAvailable?: boolean;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  /** 会话输入框同款底栏：左侧配置区（默认空） */
  renderConfigureArea?: () => ReactNode;
  /** 会话输入框同款底栏：右侧操作区（默认空）；可渲染「保存」等主操作 */
  renderActionArea?: (args: { menuItem: ReactNode[]; className: string }) => ReactNode;
  /** 与会话输入框一致：canSend 为 true 时 Enter 触发 onMessageSend */
  canSend?: boolean;
  onMessageSend?: (plain: string) => void;
}

export function ComposerPlainEditSurface({
  value,
  onChange,
  repositoryPath,
  employeeMentions = [],
  teamMentions = [],
  sessionExecutionEngine,
  codexAvailable = true,
  cursorAvailable = true,
  geminiAvailable = false,
  opencodeAvailable = false,
  qoderAvailable = false,
  placeholder = "@ 终端/工作流/文件，/ 命令，Shift+Enter 换行",
  className = "",
  autoFocus = false,
  renderConfigureArea,
  renderActionArea,
  canSend = false,
  onMessageSend,
}: ComposerPlainEditSurfaceProps) {
  const aiChatRef = useRef<InstanceType<typeof AIChatInputType> | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const plainSurfaceRef = useRef<ComposerPlainSurface | null>(null);
  const lastEditorPlainRef = useRef("");
  const cursorRef = useRef(0);
  const ignoreNextContentSyncRef = useRef(false);
  const skipContentSyncRemainingRef = useRef(0);
  /** 文本粘贴后抑制 @ / 指令触发的截止时间戳（Date.now）。粘贴的邮箱/路径/单斜杠不应误开弹出面板或文件搜索。 */
  const suppressTriggerAfterPasteUntilRef = useRef(0);
  /** @ / 指令触发锚点矩形缓存：按 (mode, triggerStart) 复用，避免 @query 逐字符扩展时每键强制回流。 */
  const triggerRectCacheRef = useRef<{ key: string; rect: DOMRect | null } | null>(null);
  const [semiEditorReady, setSemiEditorReady] = useState(false);
  const [trigger, setTrigger] = useState<TriggerInfo>({ mode: null, query: "", rect: null });
  const triggerRef = useRef(trigger);
  triggerRef.current = trigger;
  const { target: atMentionDefaultTarget, save: saveAtMentionDefaultTarget } =
    useAtMentionDefaultTarget();

  useEffect(() => {
    setSemiEditorReady(true);
    return () => setSemiEditorReady(false);
  }, []);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    // 纯文本粘贴整块内容不应触发 @ / 指令弹出；capture 阶段先于 Tiptap 消费事件，只设窗口不拦截。
    // 用户已在主动 @ / 指令补全中（如输入 `@src/` 想粘贴补全路径）时保留 trigger，让 detect 扩展 query。
    const onPasteCapture = () => {
      if (triggerRef.current.mode) return;
      suppressTriggerAfterPasteUntilRef.current = Date.now() + PASTE_TRIGGER_SUPPRESS_MS;
      setTrigger((prev) =>
        prev.mode === null && prev.query === "" ? prev : { mode: null, query: "", rect: null },
      );
    };
    el.addEventListener("paste", onPasteCapture, true);
    return () => el.removeEventListener("paste", onPasteCapture, true);
  }, []);

  useEffect(() => {
    void loadSlashCatalog(repositoryPath?.trim() || null, {
      executionEngine: sessionExecutionEngine,
    });
  }, [repositoryPath, sessionExecutionEngine]);

  const scheduleComposerSetContent = useCallback((plain: string, onAfterSet?: () => void) => {
    const normalized = normalizeComposerEditorPlain(plain);
    scheduleSafeAiChatSetContent(
      () => aiChatRef.current,
      normalized,
      () => {
        const actual = readSemiEditorPlain(aiChatRef.current?.getEditor?.());
        if (actual) lastEditorPlainRef.current = actual;
        onAfterSet?.();
      },
      shellRef.current,
    );
  }, []);

  const applyPlainAndCursor = useCallback(
    (plain: string, cursor: number) => {
      const normalized = normalizeComposerEditorPlain(plain);
      ignoreNextContentSyncRef.current = true;
      cursorRef.current = cursor;
      lastEditorPlainRef.current = normalized;
      onChange(normalized);
      scheduleComposerSetContent(normalized, () => {
        focusComposerAtPlainOffset(aiChatRef.current, cursor);
      });
    },
    [onChange, scheduleComposerSetContent],
  );

  plainSurfaceRef.current = {
    anchorEl: () => shellRef.current,
    resolveTriggerAnchorRect: () => {
      const plain = plainSurfaceRef.current?.getPlain() ?? value;
      const cursor = plainSurfaceRef.current?.getCursor() ?? cursorRef.current;
      return resolveAtSlashTriggerAnchorRect(aiChatRef.current, shellRef.current, plain, cursor);
    },
    getPlain: () => {
      const live = lastEditorPlainRef.current;
      if (live) return live;
      const fromEditor = readSemiEditorPlain(aiChatRef.current?.getEditor?.());
      if (fromEditor) return fromEditor;
      return value;
    },
    getCursor: () => {
      const rawEd = aiChatRef.current?.getEditor?.();
      const ed = rawEd as ComposerProseMirrorEditor | null | undefined;
      if (ed?.state?.doc) {
        try {
          const from = ed.state.selection?.from ?? ed.state.doc.content.size;
          return ed.state.doc.textBetween(0, from, "\n").length;
        } catch {
          return cursorRef.current;
        }
      }
      return cursorRef.current;
    },
    setPlainAndCursor: applyPlainAndCursor,
    focus: () => {
      focusComposerAtPlainOffset(aiChatRef.current, cursorRef.current);
    },
  };

  useEffect(() => {
    if (!semiEditorReady) return;
    const normalized = normalizeComposerEditorPlain(value);
    if (normalized === lastEditorPlainRef.current) return;
    lastEditorPlainRef.current = normalized;
    ignoreNextContentSyncRef.current = true;
    scheduleComposerSetContent(normalized, () => {
      if (autoFocus) {
        focusComposerAtPlainOffset(aiChatRef.current, normalized.length);
      }
    });
  }, [autoFocus, scheduleComposerSetContent, semiEditorReady, value]);

  const applySemiContentChange = useCallback(
    (contents: Content[]) => {
      const rawEd = aiChatRef.current?.getEditor?.();
      const ed = rawEd as ComposerProseMirrorEditor | null | undefined;
      let plain = normalizeComposerEditorPlain(contentsToPlain(contents));
      if (ed) {
        try {
          plain = readSemiEditorPlain(ed) || plain;
        } catch {
          /* keep contentsToPlain */
        }
      }
      if (skipContentSyncRemainingRef.current > 0) {
        if (plain !== lastEditorPlainRef.current) {
          skipContentSyncRemainingRef.current = 0;
        } else {
          skipContentSyncRemainingRef.current -= 1;
          return;
        }
      }
      if (ignoreNextContentSyncRef.current) {
        ignoreNextContentSyncRef.current = false;
        return;
      }
      let cursor = plain.length;
      if (ed?.state?.doc) {
        try {
          const from = ed.state.selection?.from ?? ed.state.doc.content.size;
          cursor = ed.state.doc.textBetween(0, from, "\n").length;
        } catch {
          cursor = plain.length;
        }
      }
      cursorRef.current = cursor;
      lastEditorPlainRef.current = plain;
      onChange(plain);
      if (isAtSlashTriggerSuppressedByPaste(suppressTriggerAfterPasteUntilRef.current, Date.now())) {
        // 粘贴后的短窗口：整块插入内容（邮箱/路径/单斜杠除法等）不应误开 @ / 指令弹出与文件搜索查询
        setTrigger((prev) =>
          prev.mode === null && prev.query === "" ? prev : { mode: null, query: "", rect: null },
        );
        return;
      }
      if (suppressTriggerAfterPasteUntilRef.current > 0) {
        suppressTriggerAfterPasteUntilRef.current = 0;
      }
      const detected = detectAtSlashTrigger(plain, cursor);
      // 锚点矩形只在 (mode, triggerStart) 变化时重算：@query 逐字符扩展时 @ 位置不变，
      // 复用上次 rect，避免每键 getBoundingClientRect 强制回流（事件处理器内算，非渲染期副作用）。
      if (detected) {
        const rectKey = `${detected.mode}:${detected.triggerStart}`;
        if (triggerRectCacheRef.current?.key !== rectKey) {
          triggerRectCacheRef.current = {
            key: rectKey,
            rect: resolveAtSlashTriggerAnchorRect(aiChatRef.current, shellRef.current, plain, cursor),
          };
        }
      }
      const cachedRect = triggerRectCacheRef.current?.rect ?? null;
      setTrigger((prev) => {
        if (!detected) {
          if (prev.mode === null && prev.query === "") return prev;
          return { mode: null, query: "", rect: null };
        }
        if (prev.mode === detected.mode && prev.query === detected.query) return prev;
        return {
          mode: detected.mode,
          query: detected.query,
          rect: cachedRect,
        };
      });
    },
    [onChange],
  );

  return (
    <SemiConfigProvider locale={semiLocaleZhCN}>
      <div
        ref={shellRef}
        className={`app-claude-semi-chat-input-wrap app-composer-plain-edit-surface ${className}`.trim()}
      >
        <SlashPopover
          surfaceRef={plainSurfaceRef}
          trigger={trigger}
          onDismiss={() => setTrigger({ mode: null, query: "", rect: null })}
          onSelect={() => {}}
          repositoryPath={repositoryPath}
          employeeOptions={employeeMentions}
          teamOptions={teamMentions}
          codexAvailable={codexAvailable}
          cursorAvailable={cursorAvailable}
          geminiAvailable={geminiAvailable}
          opencodeAvailable={opencodeAvailable}
          qoderAvailable={qoderAvailable}
          atMentionDefaultTarget={atMentionDefaultTarget}
          onAtMentionDefaultTargetChange={(next) => void saveAtMentionDefaultTarget(next)}
          sessionExecutionEngine={sessionExecutionEngine}
        />
        {semiEditorReady ? (
          <AIChatInput
            ref={aiChatRef}
            extensions={composerTokenHighlightExtensions}
            placeholder={placeholder}
            keepSkillAfterSend={false}
            showUploadButton={false}
            showUploadFile={false}
            showReference={false}
            showTemplateButton={false}
            renderConfigureArea={renderConfigureArea ?? (() => null)}
            renderActionArea={renderActionArea ?? (() => null)}
            clearContentOnGenerating={false}
            generating={false}
            canSend={canSend}
            onMessageSend={(msg) => {
              const tiptapPlain = contentsToPlain((msg.inputContents ?? []) as Content[]);
              const live = lastEditorPlainRef.current;
              const plain = live ? live : tiptapPlain;
              onMessageSend?.(normalizeComposerEditorPlain(plain));
            }}
            onContentChange={applySemiContentChange}
            style={{ width: "100%" }}
          />
        ) : (
          <div className="app-claude-semi-chat-input-mount-placeholder" aria-busy="true" />
        )}
      </div>
    </SemiConfigProvider>
  );
}
