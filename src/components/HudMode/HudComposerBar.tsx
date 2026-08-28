import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ComposerRegion } from "../ClaudeChatInput/composer-region";
import { wiseHudCancel, wiseHudExit, wiseHudNewSession, wiseHudSetDetailsOpen, wiseHudSubmit } from "../../services/wiseHud";
import { HudContextPicker } from "./HudContextPicker";
import { HudCompletionToasts } from "./HudCompletionToasts";
import { ClaudeSessionMessagesColumn } from "../ClaudeSessions/ClaudeSessionMessagesColumn";
import { safeUnlisten } from "../../utils/safeTauriUnlisten";
import {
  hudComposerSessionToClaudeSession,
  parseWiseHudActiveChanged,
  WISE_HUD_ACTIVE_EVENT,
  type WiseHudRunStatus,
  type WiseHudSessionSnapshot,
} from "../../utils/wiseHudSnapshot";
import type { HudCompletionToastView } from "../../utils/hudCompletionToast";
import type { ImageAttachmentPart } from "../../types";
import "./HudComposerBar.css";

export type HudOverlayMode = "none" | "images" | "menu" | "details";

export interface HudComposerBarProps {
  snapshot: WiseHudSessionSnapshot;
  toasts?: readonly HudCompletionToastView[];
  onDismissToast?: (id: string) => void;
  onOverlayOpenChange?: (mode: HudOverlayMode) => void;
}

function IconHudExit() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M14.5 5v14" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function IconHudPlus() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function IconHudStop() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="1.8" fill="currentColor" />
    </svg>
  );
}

function HudRunStatusChip({
  runningCount,
  runStatus,
  detailsOpen,
  disabled,
  onToggle,
}: {
  runningCount: number;
  runStatus: WiseHudRunStatus;
  detailsOpen: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const label =
    runStatus === "running"
      ? `${runningCount} 个任务运行中`
      : runStatus === "completed"
        ? "全部完成"
        : "就绪";
  const title = disabled
    ? label
    : detailsOpen
      ? `${label}，点击关闭会话详情`
      : `${label}，点击打开会话详情`;
  return (
    <button
      type="button"
      className={`app-hud-run-chip app-hud-run-chip--${runStatus}${detailsOpen ? " app-hud-run-chip--open" : ""}`}
      aria-label={title}
      aria-pressed={detailsOpen}
      title={title}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onToggle();
      }}
    >
      {runStatus === "running" ? (
        <>
          <span className="app-hud-run-chip__spinner" aria-hidden />
          <span className="app-hud-run-chip__badge">{runningCount}</span>
        </>
      ) : (
        <span className="app-hud-run-chip__check" aria-hidden>
          <svg viewBox="0 0 16 16">
            <path
              d="M3.6 8.2 6.6 11.1 12.4 4.7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      )}
    </button>
  );
}

function HudNewSessionButton({ disabled }: { disabled?: boolean }) {
  return (
    <button
      type="button"
      className="app-hud-new-session-btn"
      aria-label="新建会话"
      title={disabled ? "请先选择仓库" : "新建会话"}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        void wiseHudNewSession();
      }}
    >
      <IconHudPlus />
    </button>
  );
}

function HudExitButton() {
  return (
    <button
      type="button"
      className="app-hud-exit-btn"
      aria-label="退出 HUD"
      title="退出 HUD，回到主窗口（⌥H）"
      onClick={() => void wiseHudExit()}
    >
      <IconHudExit />
    </button>
  );
}

function HudStopButton() {
  return (
    <button
      type="button"
      className="app-hud-stop-btn"
      aria-label="停止当前运行"
      title="停止当前运行"
      onClick={() => void wiseHudCancel()}
    >
      <IconHudStop />
    </button>
  );
}

export function HudComposerBar({
  snapshot,
  toasts = [],
  onDismissToast,
  onOverlayOpenChange,
}: HudComposerBarProps) {
  const session = useMemo(() => hudComposerSessionToClaudeSession(snapshot), [snapshot]);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [menuOverlay, setMenuOverlay] = useState(false);
  const [contextOverlay, setContextOverlay] = useState(false);
  const [previewImage, setPreviewImage] = useState<ImageAttachmentPart | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsOpenRef = useRef(detailsOpen);
  detailsOpenRef.current = detailsOpen;
  const running = snapshot.busy;

  useEffect(() => {
    setPreviewImage(null);
  }, [session?.id]);

  useEffect(() => {
    if (!session) setDetailsOpen(false);
  }, [session]);

  useEffect(() => {
    if (menuOverlay || contextOverlay) setPreviewImage(null);
  }, [menuOverlay, contextOverlay]);

  useEffect(() => {
    onOverlayOpenChange?.(
      menuOverlay || contextOverlay
        ? "menu"
        : previewImage
          ? "images"
          : detailsOpen
            ? "details"
            : "none",
    );
  }, [menuOverlay, contextOverlay, previewImage, detailsOpen, onOverlayOpenChange]);

  useEffect(() => {
    void wiseHudSetDetailsOpen(detailsOpen);
  }, [detailsOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (previewImage) {
        event.preventDefault();
        event.stopPropagation();
        setPreviewImage(null);
        return;
      }
      if (detailsOpen) {
        event.preventDefault();
        event.stopPropagation();
        setDetailsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [previewImage, detailsOpen]);

  const handleHudImagePreviewChange = useCallback((image: ImageAttachmentPart | null) => {
    setPreviewImage((prev) => {
      if (image == null) return null;
      if (prev?.id === image.id) return null;
      return image;
    });
  }, []);

  const handleExecute = useCallback((sessionId: string, prompt: string) => {
    const text = prompt.replace(/\u200B/g, "").trim();
    if (!text) return;
    void wiseHudSubmit(text, sessionId || snapshot.sessionId);
  }, [snapshot.sessionId]);

  const focusEditor = useCallback(() => {
    if (detailsOpenRef.current) return;
    const editor = shellRef.current?.querySelector<HTMLElement>(
      ".app-claude-semi-chat-input-wrap .tiptap",
    );
    editor?.focus();
  }, []);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(".app-claude-semi-chat-input-wrap")) return;
      setDetailsOpen(false);
    };
    shell.addEventListener("focusin", onFocusIn);
    return () => shell.removeEventListener("focusin", onFocusIn);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => focusEditor(), 80);
    return () => window.clearTimeout(timer);
  }, [focusEditor, session?.id]);

  useEffect(() => {
    let cancelled = false;
    let unlistenFocus: (() => void) | undefined;
    let unlistenActive: (() => void) | undefined;
    void (async () => {
      try {
        const win = getCurrentWindow();
        const u1 = await win.onFocusChanged(({ payload: focused }) => {
          if (focused) focusEditor();
        });
        const u2 = await listen<unknown>(WISE_HUD_ACTIVE_EVENT, (event) => {
          const active = parseWiseHudActiveChanged(event.payload);
          if (active === true) focusEditor();
          else if (active === false) setDetailsOpen(false);
        });
        if (cancelled) {
          safeUnlisten(u1);
          safeUnlisten(u2);
          return;
        }
        unlistenFocus = () => safeUnlisten(u1);
        unlistenActive = () => safeUnlisten(u2);
      } catch {
        /* 非 Tauri 预览 */
      }
    })();
    return () => {
      cancelled = true;
      unlistenFocus?.();
      unlistenActive?.();
    };
  }, [focusEditor]);

  const contextPicker = (
    <HudContextPicker snapshot={snapshot} onOverlayWantedChange={setContextOverlay} />
  );

  return (
    <div className="app-hud-shell" ref={shellRef}>
      <div className="app-hud-drag-shell" data-tauri-drag-region aria-hidden />
      {previewImage ? (
        <button
          type="button"
          className="app-hud-image-float"
          aria-label="关闭图片预览"
          title="点击关闭预览"
          onClick={() => setPreviewImage(null)}
        >
          <img src={previewImage.dataUrl} alt={previewImage.filename} />
        </button>
      ) : null}
      <HudCompletionToasts toasts={toasts} onDismiss={onDismissToast ?? (() => undefined)} />
      {detailsOpen && !previewImage ? (
        <div className="app-hud-session-details">
          {session ? (
            <ClaudeSessionMessagesColumn
              session={session}
              listVariant="chat"
              pinUserMessages={false}
            />
          ) : (
            <div className="app-hud-session-details__empty">暂无会话</div>
          )}
        </div>
      ) : null}
      <div className={`app-hud-bar${running ? " app-hud-bar--running" : ""}`}>
        <div className="app-hud-bar-drag" data-tauri-drag-region aria-hidden />
        <HudNewSessionButton disabled={snapshot.activeRepositoryId == null} />
        <HudRunStatusChip
          runningCount={snapshot.runningCount}
          runStatus={snapshot.runStatus}
          detailsOpen={detailsOpen}
          disabled={!session}
          onToggle={() => setDetailsOpen((open) => !open)}
        />
        {session ? (
          <div className="app-hud-composer">
            <ComposerRegion
              session={session}
              gitRepositoryPath={session.repositoryPath}
              onExecute={handleExecute}
              onSessionModelChange={() => undefined}
              onCancel={() => {
                void wiseHudCancel();
              }}
              todos={[]}
              questionRequest={null}
              permissionRequest={null}
              followupItems={[]}
              revertItems={[]}
              respondQuestionAt={() => undefined}
              dismissQuestionAt={() => undefined}
              onRespondToPermission={() => undefined}
              onSendFollowup={() => undefined}
              onRestoreRevert={() => undefined}
              sessionExecutionEngine={snapshot.engine}
              allowSendWhileBusy
              hudChrome
              hudLeadingActions={contextPicker}
              hudTrailingActions={
                <>
                  {snapshot.canCancel ? <HudStopButton /> : null}
                  <HudExitButton />
                </>
              }
              onHudOverlayChange={setMenuOverlay}
              onHudImagePreviewChange={handleHudImagePreviewChange}
              draftBucketKey={`hud:${session.id}`}
            />
          </div>
        ) : (
          <>
            <div className="app-hud-empty-hint">选择仓库后可新建会话</div>
            {contextPicker}
            <HudExitButton />
          </>
        )}
      </div>
    </div>
  );
}
