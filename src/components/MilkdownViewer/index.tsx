import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
  type WheelEvent,
} from "react";
import { commandsCtx, defaultValueCtx, Editor, editorViewCtx, editorViewOptionsCtx, rootCtx } from "@milkdown/kit/core";
import type { Node as PMNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose, getMarkdown } from "@milkdown/utils";
import {
  commonmark,
  createCodeBlockCommand,
  insertHrCommand,
  insertImageCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark";
import { history, redoCommand, undoCommand } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { redo, undo } from "@milkdown/kit/prose/history";
import type { EditorView } from "@milkdown/kit/prose/view";
import { Milkdown, MilkdownProvider, useEditor, useInstance } from "@milkdown/react";
import { Crepe, CrepeFeature } from "@milkdown/crepe";
import { nord } from "@milkdown/theme-nord";
import "@milkdown/theme-nord/style.css";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/nord.css";
import { annotateCrepeToolbarButtons } from "../../utils/crepeToolbarTitles";
import { sameResolvedAnchorRanges } from "../../utils/anchorStability";
import "./index.css";

function MilkdownImagePreview({ src, onClose }: { src: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    setScale(1);
  }, [src]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleWheel(e: WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 0.92;
    setScale((s) => Math.min(4, Math.max(0.25, s * factor)));
  }

  return (
    <div
      className="app-milkdown-image-preview-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="app-milkdown-image-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="图片预览"
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
      >
        <div
          className="app-milkdown-image-preview-stage"
          style={{ transform: `scale(${scale})` }}
        >
          <img src={src} alt="" className="app-milkdown-image-preview-img" draggable={false} />
        </div>
        <p className="app-milkdown-image-preview-hint">Esc 关闭 · ⌘ 或 Ctrl + 滚轮缩放</p>
      </div>
    </div>
  );
}

function useMilkdownImageDblClickPreview(
  hostRef: RefObject<HTMLElement | null>,
  resetKey: string | number,
): [string | null, Dispatch<SetStateAction<string | null>>] {
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  useEffect(() => {
    setPreviewSrc(null);
  }, [resetKey]);

  useEffect(() => {
    const hostEl = hostRef.current;
    if (!hostEl) return;
    const root: HTMLElement = hostEl;
    function onDblClick(e: MouseEvent) {
      const t = e.target;
      if (!(t instanceof HTMLImageElement)) return;
      if (!root.contains(t)) return;
      const src = t.currentSrc || t.src;
      if (src) {
        setPreviewSrc(src);
      }
    }
    root.addEventListener("dblclick", onDblClick, true);
    return () => root.removeEventListener("dblclick", onDblClick, true);
  }, [hostRef, resetKey]);

  return [previewSrc, setPreviewSrc];
}

interface Props {
  text: string;
}

export interface MilkdownTaskAnchorMarker {
  taskId: string;
  /** 展示用序号，通常与 taskId 中数字段一致（如 task-72 → "72"）。 */
  label: string;
}

export interface MilkdownTaskAnchor {
  key: string;
  searchText: string;
  markers: MilkdownTaskAnchorMarker[];
  /** 可选：命中范围缓存（用于编辑 transaction mapping 跟随）。 */
  range?: { from: number; to: number };
  /** 结构化锚点（来自拆分任务 taskAnchors）。 */
  descriptor?: {
    from: number;
    to: number;
    textHash: string;
    contextBefore: string;
    contextAfter: string;
  };
}

/** Crepe 选区气泡工具栏「链接」后追加；与 crepe 内置项同为内联 SVG 字符串。 */
const WISE_SPLIT_TOOLBAR_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="6" cy="6" r="3"/>
    <path d="M8.12 8.12 12 12"/>
    <path d="M4 20 8.12 15.88"/>
    <circle cx="18" cy="18" r="3"/>
    <path d="M15.88 15.88 12 12"/>
    <path d="M20 4 15.88 8.12"/>
  </svg>
`;

/** 空文档时 Crepe / 只读 Milkdown 的默认 Markdown，展示为普通正文「正文」。 */
const MILKDOWN_EMPTY_DOCUMENT_MARKDOWN = "";

interface MilkdownEditorProps extends Props {
  readonly?: boolean;
  onChange?: (markdown: string) => void;
  /**
   * 是否启用 Crepe 选区气泡工具栏（加粗/链接等）。
   * 多实例并排（如任务卡片列表）建议关闭，避免挂载/卸载时工具栏仍访问已销毁的 editorView 触发 MilkdownError。
   */
  floatingToolbar?: boolean;
  taskAnchors?: MilkdownTaskAnchor[];
  /** 与 `taskAnchors[].key` 一致时，该任务锚点高亮使用「选中」强调样式。 */
  selectedRequirementAnchorKey?: string | null;
  onTaskAnchorMarkerClick?: (taskId: string) => void;
  /** 每次锚点布局测量后回报已命中的 taskId 列表。 */
  onResolvedTaskAnchorIdsChange?: (taskIds: string[]) => void;
  /** 每次锚点装饰刷新后回报命中范围（taskId -> from/to），用于持久化位置缓存。 */
  onTaskAnchorRangesChange?: (ranges: Record<string, { from: number; to: number }>) => void;
  /** 选中文本时出现在 Crepe 浮动工具栏末尾；由宿主实现（如「拆分选中」）。 */
  onToolbarSplitSelection?: () => void;
}

export interface MilkdownEditorHandle {
  /** 当前选区序列化为 Markdown；无选区或仅空选区时返回 null（含仅选中图片节点）。 */
  getSelectedMarkdown: () => string | null;
  /** 当前选区纯文本（压缩空白并去首尾空白）；无选区时返回 null。 */
  getSelectedPlainText: () => string | null;
  /** 当前选区范围与上下文（用于新建任务时写入 taskAnchors）。 */
  getSelectedAnchorDraft: () => {
    from: number;
    to: number;
    text: string;
    contextBefore: string;
    contextAfter: string;
  } | null;
  undo: () => void;
  redo: () => void;
  insertImage: (payload: { src: string; alt?: string; title?: string }) => void;
  toggleStrong: () => void;
  toggleEmphasis: () => void;
  toggleInlineCode: () => void;
  wrapBlockquote: () => void;
  wrapBulletList: () => void;
  wrapOrderedList: () => void;
  wrapHeading: (level: number) => void;
  createCodeBlock: () => void;
  insertHr: () => void;
  toggleLink: (href: string) => void;
  /** 在文档中按需求摘要文本定位并滚动到对应块（与任务锚点 searchText 一致）。 */
  scrollToRequirementSnippet: (searchText: string) => void;
  /** 按文档位置滚动定位（用于 taskAnchors.from）。 */
  scrollToDocPosition: (from: number) => void;
  /** 将 from~to 区间临时高亮（用于 taskAnchors 点击反馈）。 */
  highlightDocRange: (from: number, to: number) => void;
  /** 优先按锚点语义（context/textHash）定位并高亮，必要时回退 from~to。 */
  highlightTaskAnchorRange: (anchor: {
    from: number;
    to: number;
    textHash: string;
    contextBefore: string;
    contextAfter: string;
  }, fallbackSearchText?: string) => "semantic" | "fallback" | "none";
  /** 清除需求定位高亮。 */
  clearRequirementFocusHighlight: () => void;
}

function MilkdownCoreEditor({ text, readonly = false, onChange }: MilkdownEditorProps) {
  const content = useMemo(
    () => (text.trim().length > 0 ? text : MILKDOWN_EMPTY_DOCUMENT_MARKDOWN),
    [text],
  );
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, content);
          ctx.update(editorViewOptionsCtx, (prev) => ({
            ...prev,
            editable: () => !readonly,
          }));
          if (!readonly) {
            ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
              onChangeRef.current?.(markdown);
            });
          }
        })
        .config(nord)
        .use(commonmark)
        .use(history)
        .use(listener),
    [readonly],
  );

  return <Milkdown />;
}

const MilkdownCommandBridge = forwardRef<MilkdownEditorHandle>((_props, ref) => {
  const [_loading, getInstance] = useInstance();

  const runCommand = useCallback((runner: (editor: Editor) => void) => {
    const editor = getInstance();
    if (!editor) return;
    runner(editor);
  }, [getInstance]);

  useImperativeHandle(ref, () => ({
    getSelectedMarkdown: () => null,
    getSelectedPlainText: () => null,
    getSelectedAnchorDraft: () => null,
    undo: () => {
      runCommand((editor) => editor.action((ctx) => {
        ctx.get(commandsCtx).call(undoCommand.key);
      }));
    },
    redo: () => {
      runCommand((editor) => editor.action((ctx) => {
        ctx.get(commandsCtx).call(redoCommand.key);
      }));
    },
    insertImage: (payload) => {
      runCommand((editor) => editor.action((ctx) => {
        ctx.get(commandsCtx).call(insertImageCommand.key, payload);
      }));
    },
    toggleStrong: () => {
      runCommand((editor) => editor.action((ctx) => {
        ctx.get(commandsCtx).call(toggleStrongCommand.key);
      }));
    },
    toggleEmphasis: () => {
      runCommand((editor) => editor.action((ctx) => {
        ctx.get(commandsCtx).call(toggleEmphasisCommand.key);
      }));
    },
    toggleInlineCode: () => {
      runCommand((editor) => editor.action((ctx) => {
        ctx.get(commandsCtx).call(toggleInlineCodeCommand.key);
      }));
    },
    wrapBlockquote: () => {
      runCommand((editor) => editor.action((ctx) => {
        ctx.get(commandsCtx).call(wrapInBlockquoteCommand.key);
      }));
    },
    wrapBulletList: () => {
      runCommand((editor) => editor.action((ctx) => {
        ctx.get(commandsCtx).call(wrapInBulletListCommand.key);
      }));
    },
    wrapOrderedList: () => {
      runCommand((editor) => editor.action((ctx) => {
        ctx.get(commandsCtx).call(wrapInOrderedListCommand.key);
      }));
    },
    wrapHeading: (level: number) => {
      runCommand((editor) => editor.action((ctx) => {
        ctx.get(commandsCtx).call(wrapInHeadingCommand.key, level);
      }));
    },
    createCodeBlock: () => {
      runCommand((editor) => editor.action((ctx) => {
        ctx.get(commandsCtx).call(createCodeBlockCommand.key);
      }));
    },
    insertHr: () => {
      runCommand((editor) => editor.action((ctx) => {
        ctx.get(commandsCtx).call(insertHrCommand.key);
      }));
    },
    toggleLink: (href: string) => {
      runCommand((editor) => editor.action((ctx) => {
        ctx.get(commandsCtx).call(toggleLinkCommand.key, { href });
      }));
    },
    scrollToRequirementSnippet: () => {},
    scrollToDocPosition: () => {},
    highlightDocRange: () => {},
    highlightTaskAnchorRange: () => "none",
    clearRequirementFocusHighlight: () => {},
  }), [runCommand]);

  return null;
});
MilkdownCommandBridge.displayName = "MilkdownCommandBridge";

export function MilkdownViewer({ text }: Props) {
  const viewerKey = useMemo(
    () => `${text.length}:${text.slice(0, 32)}:${text.slice(-32)}`,
    [text],
  );
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [previewSrc, setPreviewSrc] = useMilkdownImageDblClickPreview(hostRef, viewerKey);

  return (
    <div ref={hostRef} className="app-milkdown-viewer">
      {previewSrc ? (
        <MilkdownImagePreview src={previewSrc} onClose={() => setPreviewSrc(null)} />
      ) : null}
      <MilkdownProvider key={viewerKey}>
        <MilkdownCoreEditor text={text} readonly />
      </MilkdownProvider>
    </div>
  );
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function stripMarkdownSyntax(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[•·▪]\s+/gm, "")
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1");
}

function normalizeAnchorProbeText(text: string): string {
  return collapseWs(stripMarkdownSyntax(text));
}

/** 从长到短尝试匹配，避免「索引正文」与编辑器当前正文略有出入时完全匹配失败。 */
function buildNeedleCandidates(searchText: string): string[] {
  const collapsed = normalizeAnchorProbeText(searchText);
  if (collapsed.length < 2) return [];
  const out: string[] = [];
  const push = (s: string) => {
    const t = normalizeAnchorProbeText(s);
    if (t.length >= 2 && !out.includes(t)) out.push(t);
  };
  push(collapsed.length <= 96 ? collapsed : collapsed.slice(0, 96));
  for (const len of [72, 56, 40, 28, 20]) {
    if (collapsed.length > len) push(collapsed.slice(0, len));
  }
  return out;
}

/** 多行需求：除整段外逐行加入候选，便于与 Milkdown 列表「一行一块」对齐。 */
function expandNeedleCandidates(searchText: string): string[] {
  const out: string[] = [];
  const pushAll = (arr: string[]) => {
    for (const n of arr) {
      if (n.length >= 2 && !out.includes(n)) out.push(n);
    }
  };
  pushAll(buildNeedleCandidates(searchText));
  const lines = searchText.split(/\r?\n/);
  if (lines.length > 1) {
    for (const line of lines) {
      const t = line.trim();
      if (t.length < 2) continue;
      pushAll(buildNeedleCandidates(t));
    }
  }
  return out;
}

function textblockHayIncludesNeedle(hayRaw: string, needle: string): boolean {
  const hay = normalizeAnchorProbeText(hayRaw);
  if (hay.includes(needle)) return true;
  const deBullet = hay
    .replace(/^[\u200b\s]+/, "")
    .replace(/^[•·▪]\s*/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "");
  return deBullet.includes(needle);
}

/** 与 textblockHayIncludesNeedle 一致：从 collapsed+starts 去掉列表符号前缀，便于 indexOf(needle)。 */
function stripCollapsedListGlyphPrefix(
  collapsed: string,
  starts: number[],
): { collapsed: string; starts: number[] } {
  let i = 0;
  while (i < collapsed.length && collapsed[i] === " ") i++;
  if (i < collapsed.length && "•·▪".includes(collapsed[i]!)) {
    i += 1;
    while (i < collapsed.length && collapsed[i] === " ") i++;
    return { collapsed: collapsed.slice(i), starts: starts.slice(i) };
  }
  if (
    i + 1 < collapsed.length
    && "-*+".includes(collapsed[i]!)
    && collapsed[i + 1] === " "
  ) {
    i += 2;
    while (i < collapsed.length && collapsed[i] === " ") i++;
    return { collapsed: collapsed.slice(i), starts: starts.slice(i) };
  }
  if (i < collapsed.length && /\d/.test(collapsed[i]!)) {
    let j = i;
    while (j < collapsed.length && /\d/.test(collapsed[j]!)) j++;
    if (j < collapsed.length && collapsed[j] === "." && j + 1 < collapsed.length && collapsed[j + 1] === " ") {
      j += 2;
      while (j < collapsed.length && collapsed[j] === " ") j++;
      return { collapsed: collapsed.slice(j), starts: starts.slice(j) };
    }
  }
  return { collapsed, starts };
}

function findTextblockStartForNeedle(doc: PMNode, searchText: string): number | null {
  for (const needle of expandNeedleCandidates(searchText)) {
    if (needle.length < 2) continue;
    let found: number | null = null;
    doc.descendants((node, pos) => {
      if (found !== null) return false;
      if (!node.isTextblock) return true;
      if (node.type.spec.code) return true;
      if (textblockHayIncludesNeedle(node.textContent, needle)) {
        found = pos;
        return false;
      }
      return true;
    });
    if (found !== null) return found;
  }
  return null;
}

/** 与插件 `apply` 中读取的 meta 键一致，用于在锚点数据变化时强制重建装饰。 */
const TASK_REQ_HL_REFRESH = "wise_task_req_hl_refresh";
const TASK_REQ_FOCUS_REFRESH = "wise_task_req_focus_refresh";

function walkInlineText(node: PMNode, pos: number, out: { abs: number; ch: string }[]) {
  if (node.isText) {
    const t = node.text ?? "";
    for (let i = 0; i < t.length; i++) {
      out.push({ abs: pos + i, ch: t[i]! });
    }
    return;
  }
  node.forEach((child, offset) => {
    walkInlineText(child, pos + 1 + offset, out);
  });
}

function collectRawCharsInBlock(block: PMNode, blockPos: number): { abs: number; ch: string }[] {
  const out: { abs: number; ch: string }[] = [];
  block.forEach((child, offset) => {
    walkInlineText(child, blockPos + 1 + offset, out);
  });
  return out;
}

function collectRawCharsInDoc(doc: PMNode): { abs: number; ch: string }[] {
  const out: { abs: number; ch: string }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const text = node.text ?? "";
    for (let i = 0; i < text.length; i += 1) {
      out.push({ abs: pos + i, ch: text[i]! });
    }
    return true;
  });
  return out;
}

function resolveDocRangeFromVisibleOffsets(
  doc: PMNode,
  fromOffset: number,
  toOffset: number,
): { from: number; to: number } | null {
  const chars = collectRawCharsInDoc(doc);
  if (chars.length === 0) return null;
  const from = Math.floor(Number(fromOffset));
  const to = Math.floor(Number(toOffset));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  const fromIdx = Math.min(Math.max(0, from), chars.length - 1);
  const toIdxExclusive = Math.min(Math.max(fromIdx + 1, to), chars.length);
  const fromAbs = chars[fromIdx]!.abs;
  const toAbs = chars[toIdxExclusive - 1]!.abs + 1;
  if (toAbs <= fromAbs) return null;
  return { from: fromAbs, to: toAbs };
}

function trimOuterWsChars(chars: { abs: number; ch: string }[]): { abs: number; ch: string }[] {
  let a = 0;
  let b = chars.length - 1;
  while (a <= b && /\s/.test(chars[a]!.ch)) a++;
  while (b >= a && /\s/.test(chars[b]!.ch)) b--;
  if (a > b) return [];
  return chars.slice(a, b + 1);
}

function buildCollapsedWithStarts(chars: { abs: number; ch: string }[]): { collapsed: string; starts: number[] } {
  const starts: number[] = [];
  let collapsed = "";
  let i = 0;
  while (i < chars.length) {
    const { abs, ch } = chars[i]!;
    if (/\s/.test(ch)) {
      let j = i;
      while (j < chars.length && /\s/.test(chars[j]!.ch)) j++;
      collapsed += " ";
      starts.push(chars[i]!.abs);
      i = j;
      continue;
    }
    collapsed += ch;
    starts.push(abs);
    i += 1;
  }
  return { collapsed, starts };
}

function findRequirementHighlightRange(
  doc: PMNode,
  searchText: string,
  preferredFrom?: number,
): { from: number; to: number } | null {
  const candidates = findRequirementHighlightCandidates(doc, searchText, preferredFrom);
  if (candidates.length === 0) return null;
  return { from: candidates[0]!.from, to: candidates[0]!.to };
}

function collectNeedleOccurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle || needle.length < 2) return out;
  let fromIndex = 0;
  while (fromIndex < haystack.length) {
    const idx = haystack.indexOf(needle, fromIndex);
    if (idx < 0) break;
    out.push(idx);
    fromIndex = idx + 1;
  }
  return out;
}

function findRequirementHighlightCandidates(
  doc: PMNode,
  searchText: string,
  preferredFrom?: number,
): Array<{ from: number; to: number; distance: number; needle: string }> {
  const preferred = Number.isFinite(preferredFrom) ? Math.max(1, Math.floor(Number(preferredFrom))) : null;
  const candidates: Array<{ from: number; to: number; distance: number; needle: string }> = [];
  for (const needle of expandNeedleCandidates(searchText)) {
    if (needle.length < 2) continue;
    doc.descendants((node, pos) => {
      if (!node.isTextblock || node.type.spec.code) return true;
      if (!textblockHayIncludesNeedle(node.textContent, needle)) return true;
      const blockPos = pos;
      const block = node;
      const chars = trimOuterWsChars(collectRawCharsInBlock(block, blockPos));
      if (chars.length === 0) return true;
      const built = buildCollapsedWithStarts(chars);
      const stripped = stripCollapsedListGlyphPrefix(built.collapsed, built.starts);
      const starts = collectNeedleOccurrences(stripped.collapsed, needle);
      for (const start of starts) {
        const end = start + needle.length;
        if (end > stripped.starts.length) continue;
        const from = stripped.starts[start]!;
        const to = stripped.starts[end - 1]! + 1;
        const distance = preferred == null ? 0 : Math.abs(from - preferred);
        candidates.push({ from, to, distance, needle });
      }
      return true;
    });
  }
  candidates.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return b.needle.length - a.needle.length;
  });
  return candidates;
}

/**
 * 若当前区间右端落在某次 contextAfter 命中的「内部」（未含 needle 尾部），
 * 将 to 延伸到该次命中的终点，避免高亮在句中提前截断（如停在「版」而漏掉「本。」）。
 */
function extendAnchorRangeEndToCloseContextAfter(
  doc: PMNode,
  range: { from: number; to: number },
  contextAfterRaw: string,
): { from: number; to: number } {
  const docSize = doc.content.size;
  if (!contextAfterRaw.trim()) return range;
  const fromF = Math.floor(range.from);
  const toF = Math.floor(range.to);
  if (fromF < 0 || toF <= fromF || toF > docSize) return range;
  const candidates = findRequirementHighlightCandidates(doc, contextAfterRaw, toF).slice(0, 48);
  let maxTo = toF;
  for (const c of candidates) {
    if (c.to <= toF) continue;
    if (c.from > toF) continue;
    if (c.from <= toF && toF < c.to) {
      const ct = Math.min(Math.floor(c.to), docSize);
      if (ct > maxTo) maxTo = ct;
    }
  }
  if (maxTo > toF && maxTo <= docSize) return { from: fromF, to: maxTo };
  return range;
}

function finalizeAnchorRangeWithContextAfter(
  doc: PMNode,
  descriptor: MilkdownTaskAnchor["descriptor"] | undefined,
  range: { from: number; to: number } | null,
): { from: number; to: number } | null {
  if (!range || !descriptor?.contextAfter?.trim()) return range;
  return extendAnchorRangeEndToCloseContextAfter(doc, range, descriptor.contextAfter);
}

function findBestAnchorRange(
  doc: PMNode,
  descriptor: MilkdownTaskAnchor["descriptor"] | undefined,
  searchText: string,
): { from: number; to: number } | null {
  if (!descriptor) return null;
  const baseFrom = Math.floor(Number(descriptor.from));
  const baseTo = Math.floor(Number(descriptor.to));
  if (!Number.isFinite(baseFrom) || !Number.isFinite(baseTo) || baseTo <= baseFrom) return null;

  const docSize = doc.content.size;
  const beforeNeedles = expandNeedleCandidates(descriptor.contextBefore ?? "");
  const afterNeedles = expandNeedleCandidates(descriptor.contextAfter ?? "");
  const primaryNeedles = [
    searchText,
    descriptor.contextBefore ?? "",
  ].filter((x) => x.trim().length > 0);

  const rawCandidates: Array<{ from: number; to: number; distance: number; needle: string }> = [];
  for (const source of primaryNeedles) {
    rawCandidates.push(...findRequirementHighlightCandidates(doc, source, baseFrom).slice(0, 60));
  }

  // 「contextBefore -> contextAfter」配对：起点仍为 contextBefore 匹配起点；终点取 contextAfter 匹配终点（含 contextAfter 全文），避免结束在 after.from 时偏短。
  const beforeContextCandidates = (descriptor.contextBefore?.trim().length ?? 0) > 0
    ? findRequirementHighlightCandidates(doc, descriptor.contextBefore, baseFrom).slice(0, 24)
    : [];
  const afterContextCandidates = (descriptor.contextAfter?.trim().length ?? 0) > 0
    ? findRequirementHighlightCandidates(doc, descriptor.contextAfter, baseFrom).slice(0, 24)
    : [];
  if (beforeContextCandidates.length > 0 && afterContextCandidates.length > 0) {
    let bestPair: { from: number; to: number; distance: number; spanLen: number } | null = null;
    for (const before of beforeContextCandidates) {
      for (const after of afterContextCandidates) {
        if (after.from <= before.to) continue;
        const spanFrom = before.from;
        const spanTo = after.to;
        const spanLen = spanTo - spanFrom;
        if (spanLen <= 0 || spanLen > 2600) continue;
        const distance = Math.abs(spanFrom - baseFrom);
        const current = { from: spanFrom, to: spanTo, distance, spanLen };
        if (!bestPair) {
          bestPair = current;
          continue;
        }
        if (current.distance !== bestPair.distance) {
          if (current.distance < bestPair.distance) bestPair = current;
          continue;
        }
        if (current.spanLen > bestPair.spanLen) bestPair = current;
      }
    }
    // 规则：能确定 before+after 的同序配对时，高亮 [before.from, after.to)（含 contextAfter needle 全文）。
    if (bestPair) {
      return finalizeAnchorRangeWithContextAfter(doc, descriptor, { from: bestPair.from, to: bestPair.to });
    }
  }
  if (beforeContextCandidates.length > 0 && afterContextCandidates.length > 0) {
    for (const before of beforeContextCandidates) {
      for (const after of afterContextCandidates) {
        if (after.from <= before.to) continue;
        const spanFrom = before.from;
        const spanTo = after.to;
        const spanLen = spanTo - spanFrom;
        // 过大跨度通常是误配（同词远距离复现），限制在合理窗口内。
        if (spanLen <= 0 || spanLen > 2600) continue;
        rawCandidates.push({
          from: spanFrom,
          to: spanTo,
          distance: Math.abs(spanFrom - baseFrom),
          needle: "context-pair-span",
        });
      }
    }
  }

  const variantCandidates = [
    { from: baseFrom, to: baseTo },
    { from: baseFrom + 1, to: baseTo + 1 },
    { from: baseFrom - 1, to: baseTo - 1 },
  ].map((range) => ({
    from: range.from,
    to: range.to,
    distance: Math.abs(range.from - baseFrom),
    needle: "offset",
  }));
  rawCandidates.push(...variantCandidates);

  const scored: Array<{ from: number; to: number; score: number; distance: number }> = [];
  for (const candidate of rawCandidates) {
    if (!Number.isFinite(candidate.from) || !Number.isFinite(candidate.to)) continue;
    if (candidate.from < 0 || candidate.to <= candidate.from || candidate.to > docSize) continue;
    const range = { from: Math.floor(candidate.from), to: Math.floor(candidate.to) };
    const aroundBefore = normalizeAnchorProbeText(
      doc.textBetween(Math.max(0, range.from - 260), range.from, " ", " "),
    );
    const aroundAfter = normalizeAnchorProbeText(
      doc.textBetween(range.to, Math.min(docSize, range.to + 220), " ", " "),
    );
    const body = normalizeAnchorProbeText(doc.textBetween(range.from, range.to, " ", " "));
    const beforeHit = beforeNeedles.some((needle) => aroundBefore.includes(needle) || needle.includes(aroundBefore));
    const afterHitInBody = afterNeedles.some((needle) => body.includes(needle) || needle.includes(body));
    const afterHitInWindow = afterNeedles.some((needle) => aroundAfter.includes(needle) || needle.includes(aroundAfter));
    const afterHit = afterHitInBody || afterHitInWindow;
    const selfHit = expandNeedleCandidates(searchText).some((needle) => body.includes(needle) || needle.includes(body));
    const offsetHit = rangeLooksLikeAnchorMatch(
      doc,
      range,
      descriptor.contextAfter || descriptor.contextBefore || searchText,
    );
    const isContextSpan = candidate.needle === "context-pair-span";
    const pairBonus = beforeHit && afterHit ? 12 : 0;
    const spanBonus = isContextSpan && beforeHit && afterHit ? 8 : 0;
    const score = pairBonus + spanBonus + (afterHit ? 6 : 0) + (beforeHit ? 4 : 0) + (selfHit ? 3 : 0) + (offsetHit ? 2 : 0);
    scored.push({ ...range, score, distance: Math.abs(range.from - baseFrom) });
  }

  if (scored.length === 0) return null;
  const winner = scored.reduce((best, current) => {
    if (current.score !== best.score) return current.score > best.score ? current : best;
    if (current.distance !== best.distance) return current.distance < best.distance ? current : best;
    const lenCur = current.to - current.from;
    const lenBest = best.to - best.from;
    return lenCur > lenBest ? current : best;
  });
  if (winner.score <= 0) return null;
  return finalizeAnchorRangeWithContextAfter(doc, descriptor, { from: winner.from, to: winner.to });
}

function rangeLooksLikeAnchorMatch(doc: PMNode, range: { from: number; to: number }, searchText: string): boolean {
  const docSize = doc.content.size;
  if (range.from < 0 || range.to <= range.from || range.to > docSize) return false;
  const actual = normalizeAnchorProbeText(doc.textBetween(range.from, range.to, " ", " "));
  if (actual.length < 2) return false;
  for (const needle of expandNeedleCandidates(searchText)) {
    if (needle.length < 2) continue;
    if (actual.includes(needle) || needle.includes(actual)) return true;
  }
  return false;
}

function buildContextHitReport(
  doc: PMNode,
  range: { from: number; to: number },
  contextBeforeRaw: string,
  contextAfterRaw: string,
): {
  beforeHit: boolean;
  afterHit: boolean;
  beforeNeedles: string[];
  afterNeedles: string[];
  beforeWindow: string;
  afterWindow: string;
} {
  const docSize = doc.content.size;
  const beforeNeedles = expandNeedleCandidates(contextBeforeRaw);
  const afterNeedles = expandNeedleCandidates(contextAfterRaw);
  const beforeWindow = normalizeAnchorProbeText(
    doc.textBetween(Math.max(0, range.from - 520), range.from, " ", " "),
  );
  const afterWindow = normalizeAnchorProbeText(
    doc.textBetween(range.to, Math.min(docSize, range.to + 360), " ", " "),
  );
  const beforeHit = beforeNeedles.some((needle) => beforeWindow.includes(needle) || needle.includes(beforeWindow));
  const afterHit = afterNeedles.some((needle) => afterWindow.includes(needle) || needle.includes(afterWindow));
  return {
    beforeHit,
    afterHit,
    beforeNeedles,
    afterNeedles,
    beforeWindow,
    afterWindow,
  };
}

function findRangeByDescriptor(
  doc: PMNode,
  descriptor: MilkdownTaskAnchor["descriptor"] | undefined,
  searchText: string,
): { from: number; to: number } | null {
  return findBestAnchorRange(doc, descriptor, searchText);
}

function buildTaskAnchorDecorationSet(
  doc: PMNode,
  anchors: MilkdownTaskAnchor[] | undefined,
  selectedKey: string | null | undefined,
): DecorationSet {
  try {
    if (!anchors?.length) return DecorationSet.empty;
    const decos: Decoration[] = [];
    const docMax = Math.max(1, doc.content.size);
    for (const anchor of anchors) {
      const descriptorRange = findRangeByDescriptor(doc, anchor.descriptor, anchor.searchText);
      let range = descriptorRange
        ?? (anchor.range && rangeLooksLikeAnchorMatch(doc, anchor.range, anchor.searchText)
          ? anchor.range
          : findRequirementHighlightRange(doc, anchor.searchText));
      if (!range) continue;
      range = finalizeAnchorRangeWithContextAfter(doc, anchor.descriptor, range) ?? range;
      const safeFrom = Math.min(Math.max(1, Math.floor(range.from)), docMax);
      const safeTo = Math.min(Math.max(1, Math.floor(range.to)), docMax);
      if (!Number.isFinite(safeFrom) || !Number.isFinite(safeTo) || safeTo <= safeFrom) continue;
      for (const marker of anchor.markers) {
        const isSelected = Boolean(selectedKey && marker.taskId === selectedKey);
        const cls = isSelected
          ? "app-milkdown-task-anchor-highlight app-milkdown-task-anchor-highlight--selected"
          : "app-milkdown-task-anchor-highlight";
        decos.push(Decoration.inline(
          safeFrom,
          safeTo,
          { class: cls },
          { taskId: marker.taskId, anchorKey: anchor.key, anchorRange: { from: safeFrom, to: safeTo } },
        ));
      }
    }
    if (!decos.length) return DecorationSet.empty;
    return DecorationSet.create(doc, decos);
  } catch {
    // 任何锚点计算异常都不应影响正文渲染，降级为“无高亮”。
    return DecorationSet.empty;
  }
}

const taskReqHighlightStateKey = new PluginKey<{ decos: DecorationSet }>("wise-task-req-highlight");

function createWiseTaskRequirementHighlightPlugin(
  anchorsRef: RefObject<MilkdownTaskAnchor[] | undefined>,
  selectedKeyRef: RefObject<string | null | undefined>,
): ReturnType<typeof $prose> {
  return $prose(() =>
    new Plugin<{ decos: DecorationSet }>({
      key: taskReqHighlightStateKey,
      state: {
        init: (_cfg, state) => ({
          decos: buildTaskAnchorDecorationSet(state.doc, anchorsRef.current, selectedKeyRef.current),
        }),
        apply(tr, pluginState, _oldState, newState) {
          if (tr.getMeta(TASK_REQ_HL_REFRESH) === true) {
            return {
              decos: buildTaskAnchorDecorationSet(
                newState.doc,
                anchorsRef.current,
                selectedKeyRef.current,
              ),
            };
          }
          return { decos: pluginState.decos.map(tr.mapping, newState.doc) };
        },
      },
      props: {
        decorations(state) {
          return taskReqHighlightStateKey.getState(state)?.decos ?? DecorationSet.empty;
        },
      },
    }),
  );
}

/** 在 ProseMirror EditorView 已注入 ctx 后再执行；未就绪时返回 false（不抛 MilkdownError）。 */
function runWithEditorView(editor: Editor, fn: (view: EditorView) => void): boolean {
  try {
    editor.action((ctx) => {
      fn(ctx.get(editorViewCtx));
    });
    return true;
  } catch {
    return false;
  }
}

function dispatchTaskRequirementHighlightRefresh(editor: Editor) {
  runWithEditorView(editor, (view) => {
    view.dispatch(view.state.tr.setMeta(TASK_REQ_HL_REFRESH, true));
  });
}

function buildTaskAnchorFocusDecorationSet(
  doc: PMNode,
  range: { from: number; to: number } | null | undefined,
): DecorationSet {
  if (!range) return DecorationSet.empty;
  const docMax = Math.max(1, doc.content.size);
  const from = Math.min(Math.max(1, Math.floor(range.from)), docMax);
  const to = Math.min(Math.max(1, Math.floor(range.to)), docMax);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return DecorationSet.empty;
  return DecorationSet.create(doc, [
    Decoration.inline(from, to, {
      class: "app-milkdown-task-anchor-focus-highlight",
    }),
  ]);
}

const taskReqFocusStateKey = new PluginKey<{ decos: DecorationSet }>("wise-task-req-focus");

function createWiseTaskRequirementFocusPlugin(
  focusRangeRef: RefObject<{ from: number; to: number } | null>,
): ReturnType<typeof $prose> {
  return $prose(() =>
    new Plugin<{ decos: DecorationSet }>({
      key: taskReqFocusStateKey,
      state: {
        init: (_cfg, state) => ({
          decos: buildTaskAnchorFocusDecorationSet(state.doc, focusRangeRef.current),
        }),
        apply(tr, pluginState, _oldState, newState) {
          if (tr.getMeta(TASK_REQ_FOCUS_REFRESH) === true) {
            return {
              decos: buildTaskAnchorFocusDecorationSet(newState.doc, focusRangeRef.current),
            };
          }
          return { decos: pluginState.decos.map(tr.mapping, newState.doc) };
        },
      },
      props: {
        decorations(state) {
          return taskReqFocusStateKey.getState(state)?.decos ?? DecorationSet.empty;
        },
      },
    }),
  );
}

function dispatchTaskRequirementFocusRefresh(editor: Editor) {
  runWithEditorView(editor, (view) => {
    view.dispatch(view.state.tr.setMeta(TASK_REQ_FOCUS_REFRESH, true));
  });
}

function blockElementFromDocPos(view: EditorView, pos: number): HTMLElement | null {
  try {
    const max = Math.max(0, view.state.doc.content.size);
    const inner = Math.min(Math.max(1, pos + 1), max);
    const domAt = view.domAtPos(inner);
    let n: globalThis.Node | null = domAt.node;
    if (n.nodeType === globalThis.Node.TEXT_NODE) {
      n = n.parentElement;
    }
    const el = n instanceof HTMLElement ? n : null;
    if (!el) return null;
    const block = el.closest("li, p, h1, h2, h3, h4, h5, h6, blockquote");
    return block instanceof HTMLElement ? block : el;
  } catch {
    return null;
  }
}

type AnchorLayout = {
  key: string;
  top: number;
  left: number;
  markers: MilkdownTaskAnchorMarker[];
  selected: boolean;
};

function sameAnchorLayouts(a: AnchorLayout[], b: AnchorLayout[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const la = a[i];
    const lb = b[i];
    if (!la || !lb) return false;
    if (la.key !== lb.key) return false;
    if (la.selected !== lb.selected) return false;
    if (Math.abs(la.top - lb.top) > 1) return false;
    if (Math.abs(la.left - lb.left) > 1) return false;
    if (la.markers.length !== lb.markers.length) return false;
    for (let j = 0; j < la.markers.length; j += 1) {
      const ma = la.markers[j];
      const mb = lb.markers[j];
      if (!ma || !mb) return false;
      if (ma.taskId !== mb.taskId || ma.label !== mb.label) return false;
    }
  }
  return true;
}

function computeAnchorLayouts(
  editor: Editor,
  anchors: MilkdownTaskAnchor[],
  hostEl: HTMLElement,
  selectedKey: string | null | undefined,
): AnchorLayout[] {
  const layouts: AnchorLayout[] = [];
  const markerByTaskId = new Map<string, MilkdownTaskAnchorMarker>();
  for (const anchor of anchors) {
    for (const marker of anchor.markers) {
      markerByTaskId.set(marker.taskId, marker);
    }
  }
  const hostRect = hostEl.getBoundingClientRect();
  const ok = runWithEditorView(editor, (view) => {
    const pluginState = taskReqHighlightStateKey.getState(view.state);
    const decos = pluginState?.decos.find(undefined, undefined, (spec) => {
      if (!spec || typeof spec !== "object") return false;
      const taskId = (spec as { taskId?: unknown }).taskId;
      return typeof taskId === "string" && taskId.length > 0;
    }) ?? [];
    const seen = new Set<string>();
    const grouped = new Map<string, AnchorLayout>();
    for (const deco of decos) {
      const taskId = (deco.spec as { taskId?: string }).taskId;
      if (!taskId || seen.has(taskId)) continue;
      const marker = markerByTaskId.get(taskId);
      if (!marker) continue;
      seen.add(taskId);
      const startCoords = view.coordsAtPos(deco.from);
      const top = Math.round(startCoords.top - hostRect.top - 11);
      const left = Math.round(startCoords.left - hostRect.left - 2);
      const anchorRange = (deco.spec as { anchorRange?: { from?: number; to?: number } }).anchorRange;
      const rangeFrom = Number(anchorRange?.from ?? deco.from);
      const rangeTo = Number(anchorRange?.to ?? deco.to);
      const groupKey = `${Math.floor(rangeFrom)}:${Math.floor(rangeTo)}`;
      const existing = grouped.get(groupKey);
      if (existing) {
        existing.markers.push(marker);
        existing.markers.sort((a, b) => a.taskId.localeCompare(b.taskId));
        if (selectedKey && taskId === selectedKey) existing.selected = true;
      } else {
        grouped.set(groupKey, {
          key: groupKey,
          top,
          left: Math.max(2, left),
          markers: [marker],
          selected: Boolean(selectedKey && taskId === selectedKey),
        });
      }
    }
    layouts.push(...grouped.values());
    layouts.sort((a, b) => a.key.localeCompare(b.key));
  });
  if (!ok) return [];
  return layouts;
}

function collectResolvedAnchorRanges(editor: Editor): Record<string, { from: number; to: number }> {
  const out: Record<string, { from: number; to: number }> = {};
  runWithEditorView(editor, (view) => {
    const pluginState = taskReqHighlightStateKey.getState(view.state);
    const decos = pluginState?.decos.find(undefined, undefined, (spec) => {
      if (!spec || typeof spec !== "object") return false;
      const taskId = (spec as { taskId?: unknown }).taskId;
      return typeof taskId === "string" && taskId.length > 0;
    }) ?? [];
    for (const deco of decos) {
      const taskId = (deco.spec as { taskId?: string }).taskId;
      if (!taskId || out[taskId]) continue;
      out[taskId] = { from: deco.from, to: deco.to };
    }
  });
  return out;
}

export const MilkdownEditor = forwardRef<MilkdownEditorHandle, MilkdownEditorProps>(({
  text,
  onChange,
  floatingToolbar = true,
  taskAnchors,
  selectedRequirementAnchorKey = null,
  onTaskAnchorMarkerClick,
  onResolvedTaskAnchorIdsChange,
  onTaskAnchorRangesChange,
  onToolbarSplitSelection,
}, ref) => {
  const [instanceKey, setInstanceKey] = useState(0);
  const lastInternalTextRef = useRef(text);
  const initialTextRef = useRef(text);
  const crepeRef = useRef<Crepe | null>(null);
  const onToolbarSplitSelectionRef = useRef(onToolbarSplitSelection);
  onToolbarSplitSelectionRef.current = onToolbarSplitSelection;
  const onResolvedTaskAnchorIdsChangeRef = useRef(onResolvedTaskAnchorIdsChange);
  onResolvedTaskAnchorIdsChangeRef.current = onResolvedTaskAnchorIdsChange;
  const onTaskAnchorRangesChangeRef = useRef(onTaskAnchorRangesChange);
  onTaskAnchorRangesChangeRef.current = onTaskAnchorRangesChange;
  const enableWiseToolbarSplit = Boolean(onToolbarSplitSelection) && floatingToolbar;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [previewSrc, setPreviewSrc] = useMilkdownImageDblClickPreview(hostRef, instanceKey);
  const [anchorLayouts, setAnchorLayouts] = useState<AnchorLayout[]>([]);
  const rafMeasureRef = useRef<number | null>(null);
  const focusRangeClearTimerRef = useRef<number | null>(null);
  const lastReportedRangesRef = useRef<Record<string, { from: number; to: number }> | undefined>(undefined);
  /** `crepe.create()` 完成后递增，用于在 editorView 就绪后挂载 DOM 观察器。 */
  const [crepeReadyGeneration, setCrepeReadyGeneration] = useState(0);
  const scheduleMeasureAnchorsRef = useRef<() => void>(() => {});
  const taskAnchorsRef = useRef(taskAnchors);
  taskAnchorsRef.current = taskAnchors;
  const selectedRequirementKeyRef = useRef<string | null>(null);
  selectedRequirementKeyRef.current = selectedRequirementAnchorKey ?? null;
  const focusRangeRef = useRef<{ from: number; to: number } | null>(null);
  const taskRequirementHighlightPlugin = useMemo(
    () => createWiseTaskRequirementHighlightPlugin(taskAnchorsRef, selectedRequirementKeyRef),
    [],
  );
  const taskRequirementFocusPlugin = useMemo(
    () => createWiseTaskRequirementFocusPlugin(focusRangeRef),
    [],
  );

  const clearFocusRange = useCallback((editor: Editor) => {
    if (focusRangeClearTimerRef.current != null) {
      window.clearTimeout(focusRangeClearTimerRef.current);
      focusRangeClearTimerRef.current = null;
    }
    focusRangeRef.current = null;
    dispatchTaskRequirementFocusRefresh(editor);
  }, []);

  const applyFocusRange = useCallback((
    editor: Editor,
    range: { from: number; to: number },
    options?: { autoClearMs?: number },
  ) => {
    if (focusRangeClearTimerRef.current != null) {
      window.clearTimeout(focusRangeClearTimerRef.current);
      focusRangeClearTimerRef.current = null;
    }
    focusRangeRef.current = range;
    dispatchTaskRequirementFocusRefresh(editor);
    if (options?.autoClearMs && options.autoClearMs > 0) {
      focusRangeClearTimerRef.current = window.setTimeout(() => {
        focusRangeRef.current = null;
        dispatchTaskRequirementFocusRefresh(editor);
        focusRangeClearTimerRef.current = null;
      }, options.autoClearMs);
    }
  }, []);

  useEffect(() => {
    if (text !== lastInternalTextRef.current) {
      initialTextRef.current = text;
      lastInternalTextRef.current = text;
      setInstanceKey((prev) => prev + 1);
    }
  }, [text]);

  const handleChange = useCallback((markdown: string) => {
    if (markdown === lastInternalTextRef.current) {
      return;
    }
    lastInternalTextRef.current = markdown;
    onChange?.(markdown);
  }, [onChange]);
  const handleChangeRef = useRef(handleChange);
  handleChangeRef.current = handleChange;

  const scheduleMeasureAnchors = useCallback(() => {
    if (!taskAnchors?.length) {
      setAnchorLayouts([]);
      if (lastReportedRangesRef.current && Object.keys(lastReportedRangesRef.current).length > 0) {
        lastReportedRangesRef.current = {};
        onTaskAnchorRangesChangeRef.current?.({});
      }
      return;
    }
    if (rafMeasureRef.current != null) {
      cancelAnimationFrame(rafMeasureRef.current);
    }
    rafMeasureRef.current = requestAnimationFrame(() => {
      rafMeasureRef.current = null;
      const crepe = crepeRef.current;
      const host = hostRef.current;
      if (!crepe || !host) return;
      const layouts = computeAnchorLayouts(crepe.editor, taskAnchors, host, selectedRequirementAnchorKey ?? null);
      setAnchorLayouts((prev) => (sameAnchorLayouts(prev, layouts) ? prev : layouts));
      onResolvedTaskAnchorIdsChangeRef.current?.(
        layouts.flatMap((layout) => layout.markers.map((marker) => marker.taskId)),
      );
      const ranges = collectResolvedAnchorRanges(crepe.editor);
      if (!sameResolvedAnchorRanges(lastReportedRangesRef.current, ranges)) {
        lastReportedRangesRef.current = ranges;
        onTaskAnchorRangesChangeRef.current?.(ranges);
      }
    });
  }, [taskAnchors, selectedRequirementAnchorKey]);

  useEffect(() => {
    scheduleMeasureAnchorsRef.current = scheduleMeasureAnchors;
  }, [scheduleMeasureAnchors]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let cancelled = false;
    const initialText = initialTextRef.current;

    const crepe = new Crepe({
      root,
      defaultValue: initialText.trim().length > 0 ? initialText : MILKDOWN_EMPTY_DOCUMENT_MARKDOWN,
      ...(floatingToolbar ? {} : { features: { [CrepeFeature.Toolbar]: false } }),
      featureConfigs: enableWiseToolbarSplit
        ? {
            [CrepeFeature.Toolbar]: {
              buildToolbar: (builder) => {
                builder.getGroup("function").addItem("wise-split-selection", {
                  icon: WISE_SPLIT_TOOLBAR_ICON,
                  active: () => false,
                  onRun: () => {
                    onToolbarSplitSelectionRef.current?.();
                  },
                });
              },
            },
          }
        : undefined,
    });

    crepe.editor.use(taskRequirementHighlightPlugin);
    crepe.editor.use(taskRequirementFocusPlugin);

    crepe.on((listenerApi) => {
      listenerApi.markdownUpdated((_ctx, markdown) => {
        handleChangeRef.current(markdown);
      });
    });

    void (async () => {
      try {
        await crepe.create();
      } catch {
        return;
      }
      if (cancelled) {
        await crepe.destroy().catch(() => undefined);
        return;
      }
      crepeRef.current = crepe;
      setCrepeReadyGeneration((g) => g + 1);
      requestAnimationFrame(() => {
        scheduleMeasureAnchorsRef.current();
        dispatchTaskRequirementHighlightRefresh(crepe.editor);
        annotateCrepeToolbarButtons();
      });
    })();

    return () => {
      cancelled = true;
      if (crepeRef.current === crepe) {
        crepeRef.current = null;
      }
      void crepe.destroy();
    };
  }, [
    enableWiseToolbarSplit,
    floatingToolbar,
    instanceKey,
    taskRequirementFocusPlugin,
    taskRequirementHighlightPlugin,
  ]);

  useEffect(() => () => {
    if (focusRangeClearTimerRef.current != null) {
      window.clearTimeout(focusRangeClearTimerRef.current);
    }
  }, []);

  useLayoutEffect(() => {
    scheduleMeasureAnchors();
  }, [instanceKey, crepeReadyGeneration, scheduleMeasureAnchors, taskAnchors, selectedRequirementAnchorKey]);

  useLayoutEffect(() => {
    const crepe = crepeRef.current;
    if (!crepe) return;
    /** 与 crepe.create 完成后的首帧错开，避免 ctx 尚未挂上 editorView。 */
    const raf = requestAnimationFrame(() => {
      dispatchTaskRequirementHighlightRefresh(crepe.editor);
    });
    return () => cancelAnimationFrame(raf);
  }, [taskAnchors, selectedRequirementAnchorKey, crepeReadyGeneration]);

  /** 异步加载拆分结果时，首帧 doc 可能尚未与 taskAnchors 对齐；延迟再刷一次装饰与测量。 */
  useEffect(() => {
    if (!taskAnchors?.length) return;
    const crepe = crepeRef.current;
    if (!crepe) return;
    const tid = window.setTimeout(() => {
      dispatchTaskRequirementHighlightRefresh(crepe.editor);
      scheduleMeasureAnchors();
    }, 220);
    return () => window.clearTimeout(tid);
  }, [taskAnchors, crepeReadyGeneration, scheduleMeasureAnchors]);

  useEffect(() => {
    if (!taskAnchors?.length) {
      setAnchorLayouts([]);
      return;
    }
    const ro = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => scheduleMeasureAnchors())
      : null;
    const host = hostRef.current;
    if (host) ro?.observe(host);

    const crepe = crepeRef.current;
    let disconnectDom: (() => void) | undefined;
    let retryRaf: number | null = null;
    let retryCount = 0;
    const maxDomRetries = 30;

    const attachDomObserver = () => {
      if (!crepe) return;
      const attached = runWithEditorView(crepe.editor, (view) => {
        const dom = view.dom;
        if (!(dom instanceof Node)) {
          if (retryCount < maxDomRetries) {
            retryCount += 1;
            retryRaf = requestAnimationFrame(attachDomObserver);
          }
          return;
        }
        const mo = new MutationObserver(() => scheduleMeasureAnchors());
        mo.observe(dom, { subtree: true, characterData: true, childList: true });
        disconnectDom = () => {
          mo.disconnect();
        };
      });
      if (!attached && retryCount < maxDomRetries) {
        retryCount += 1;
        retryRaf = requestAnimationFrame(attachDomObserver);
      }
    };

    if (crepe) {
      attachDomObserver();
    }

    const t = window.setTimeout(scheduleMeasureAnchors, 120);

    return () => {
      if (retryRaf != null) {
        cancelAnimationFrame(retryRaf);
      }
      ro?.disconnect();
      disconnectDom?.();
      window.clearTimeout(t);
    };
  }, [instanceKey, crepeReadyGeneration, scheduleMeasureAnchors, taskAnchors, selectedRequirementAnchorKey]);

  const runCommand = useCallback((runner: (editor: Editor) => void) => {
    const crepe = crepeRef.current;
    if (!crepe) return;
    try {
      runner(crepe.editor);
    } catch {
      // editorView / commands 尚未就绪或实例已切换
    }
  }, []);

  const runHistoryCommand = useCallback((kind: "undo" | "redo"): boolean => {
    let handled = false;
    runCommand((editor) => {
      const ok = runWithEditorView(editor, (view) => {
        handled = kind === "undo"
          ? undo(view.state, view.dispatch)
          : redo(view.state, view.dispatch);
      });
      if (!ok) handled = false;
    });
    return handled;
  }, [runCommand]);

  const isEditorFocused = useCallback((): boolean => {
    const root = rootRef.current;
    const host = hostRef.current;
    const boundary = host ?? root;
    if (!boundary) return false;
    const active = document.activeElement;
    if (active && boundary.contains(active)) return true;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    const inAnchor = Boolean(anchorNode && boundary.contains(anchorNode));
    const inFocus = Boolean(focusNode && boundary.contains(focusNode));
    return inAnchor || inFocus;
  }, []);

  useEffect(() => {
    function handleUndoRedoShortcut(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || !isEditorFocused()) return;
      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        if (runHistoryCommand("redo")) {
          event.preventDefault();
        }
        return;
      }
      if (key === "z") {
        if (runHistoryCommand("undo")) {
          event.preventDefault();
        }
        return;
      }
      if (key === "y") {
        if (runHistoryCommand("redo")) {
          event.preventDefault();
        }
      }
    }

    document.addEventListener("keydown", handleUndoRedoShortcut, { capture: true });
    return () => {
      document.removeEventListener("keydown", handleUndoRedoShortcut, { capture: true });
    };
  }, [isEditorFocused, runHistoryCommand]);

  useImperativeHandle(ref, () => ({
    getSelectedMarkdown: (): string | null => {
      const crepe = crepeRef.current;
      if (!crepe) return null;
      try {
        let out: string | null = null;
        crepe.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const { from, to } = view.state.selection;
          if (from === to) {
            out = null;
            return;
          }
          const md = getMarkdown({ from, to })(ctx);
          const t = md.trim();
          out = t.length > 0 ? md : null;
        });
        return out;
      } catch {
        return null;
      }
    },
    getSelectedPlainText: (): string | null => {
      const crepe = crepeRef.current;
      if (!crepe) return null;
      try {
        let out: string | null = null;
        crepe.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const { from, to } = view.state.selection;
          if (from === to) {
            out = null;
            return;
          }
          const text = collapseWs(view.state.doc.textBetween(from, to, " ", " "));
          out = text.length > 0 ? text : null;
        });
        return out;
      } catch {
        return null;
      }
    },
    getSelectedAnchorDraft: () => {
      const crepe = crepeRef.current;
      if (!crepe) return null;
      try {
        let out: {
          from: number;
          to: number;
          text: string;
          contextBefore: string;
          contextAfter: string;
        } | null = null;
        crepe.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const { from, to } = view.state.selection;
          if (from === to) {
            out = null;
            return;
          }
          const text = collapseWs(view.state.doc.textBetween(from, to, " ", " ")).trim();
          if (!text) {
            out = null;
            return;
          }
          const CONTEXT_WINDOW = 64;
          const beforeStart = Math.max(0, from - CONTEXT_WINDOW);
          const afterEnd = Math.min(view.state.doc.content.size, to + CONTEXT_WINDOW);
          const contextBefore = collapseWs(view.state.doc.textBetween(beforeStart, from, " ", " ")).trim();
          const contextAfter = collapseWs(view.state.doc.textBetween(to, afterEnd, " ", " ")).trim();
          out = {
            from: Math.floor(from),
            to: Math.floor(to),
            text,
            contextBefore,
            contextAfter,
          };
        });
        return out;
      } catch {
        return null;
      }
    },
    undo: () => {
      runHistoryCommand("undo");
    },
    redo: () => {
      runHistoryCommand("redo");
    },
    insertImage: (payload) => {
      runCommand((editor) => editor.action((ctx) => {
        ctx.get(commandsCtx).call(insertImageCommand.key, payload);
      }));
    },
    toggleStrong: () => runCommand((editor) => editor.action((ctx) => {
      ctx.get(commandsCtx).call(toggleStrongCommand.key);
    })),
    toggleEmphasis: () => runCommand((editor) => editor.action((ctx) => {
      ctx.get(commandsCtx).call(toggleEmphasisCommand.key);
    })),
    toggleInlineCode: () => runCommand((editor) => editor.action((ctx) => {
      ctx.get(commandsCtx).call(toggleInlineCodeCommand.key);
    })),
    wrapBlockquote: () => runCommand((editor) => editor.action((ctx) => {
      ctx.get(commandsCtx).call(wrapInBlockquoteCommand.key);
    })),
    wrapBulletList: () => runCommand((editor) => editor.action((ctx) => {
      ctx.get(commandsCtx).call(wrapInBulletListCommand.key);
    })),
    wrapOrderedList: () => runCommand((editor) => editor.action((ctx) => {
      ctx.get(commandsCtx).call(wrapInOrderedListCommand.key);
    })),
    wrapHeading: (level: number) => runCommand((editor) => editor.action((ctx) => {
      ctx.get(commandsCtx).call(wrapInHeadingCommand.key, level);
    })),
    createCodeBlock: () => runCommand((editor) => editor.action((ctx) => {
      ctx.get(commandsCtx).call(createCodeBlockCommand.key);
    })),
    insertHr: () => runCommand((editor) => editor.action((ctx) => {
      ctx.get(commandsCtx).call(insertHrCommand.key);
    })),
    toggleLink: (href: string) => runCommand((editor) => editor.action((ctx) => {
      ctx.get(commandsCtx).call(toggleLinkCommand.key, { href });
    })),
    scrollToRequirementSnippet: (searchText: string) => {
      const snippet = searchText.trim();
      if (!snippet) return;
      const maxAttempts = 30;
      const attemptScroll = (attempt: number) => {
        const crepe = crepeRef.current;
        if (!crepe) return;
        const scrolled = runWithEditorView(crepe.editor, (view) => {
          const highlightRange = findRequirementHighlightRange(view.state.doc, snippet);
          if (highlightRange && highlightRange.to > highlightRange.from) {
            const docMax = Math.max(1, view.state.doc.content.size);
            const safeFrom = Math.min(Math.max(1, Math.floor(highlightRange.from)), docMax);
            const safeTo = Math.min(Math.max(1, Math.floor(highlightRange.to)), docMax);
            if (safeTo > safeFrom) {
              applyFocusRange(crepe.editor, { from: safeFrom, to: safeTo });
            }
          }
          const pos = findTextblockStartForNeedle(view.state.doc, snippet);
          if (pos == null) return;
          const blockEl = blockElementFromDocPos(view, pos);
          blockEl?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        if (!scrolled && attempt < maxAttempts) {
          requestAnimationFrame(() => attemptScroll(attempt + 1));
        }
      };
      requestAnimationFrame(() => attemptScroll(0));
    },
    scrollToDocPosition: (from: number) => {
      const target = Math.floor(Number(from));
      if (!Number.isFinite(target) || target < 0) return;
      const maxAttempts = 30;
      const attemptScroll = (attempt: number) => {
        const crepe = crepeRef.current;
        if (!crepe) return;
        const scrolled = runWithEditorView(crepe.editor, (view) => {
          const max = Math.max(1, view.state.doc.content.size);
          const candidates = [target, target + 1, target - 1]
            .map((pos) => Math.min(Math.max(1, pos), max));
          for (const pos of candidates) {
            const blockEl = blockElementFromDocPos(view, pos);
            if (!blockEl) continue;
            blockEl.scrollIntoView({ behavior: "smooth", block: "center" });
            break;
          }
        });
        if (!scrolled && attempt < maxAttempts) {
          requestAnimationFrame(() => attemptScroll(attempt + 1));
        }
      };
      requestAnimationFrame(() => attemptScroll(0));
    },
    highlightDocRange: (from: number, to: number) => {
      const rawFrom = Math.floor(Number(from));
      const rawTo = Math.floor(Number(to));
      if (!Number.isFinite(rawFrom) || !Number.isFinite(rawTo) || rawTo <= rawFrom) return;
      runCommand((editor) => {
        const ok = runWithEditorView(editor, (view) => {
          const docMax = Math.max(1, view.state.doc.content.size);
          const safeFrom = Math.min(Math.max(1, rawFrom), docMax);
          const safeTo = Math.min(Math.max(1, rawTo), docMax);
          if (safeTo <= safeFrom) return;
          applyFocusRange(editor, { from: safeFrom, to: safeTo });
          blockElementFromDocPos(view, safeFrom)?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        if (!ok) return;
      });
    },
    highlightTaskAnchorRange: (anchor, fallbackSearchText) => {
      let mode: "semantic" | "fallback" | "none" = "none";
      const rawFrom = Math.floor(Number(anchor.from));
      const rawTo = Math.floor(Number(anchor.to));
      runCommand((editor) => {
        const ok = runWithEditorView(editor, (view) => {
          const docMax = Math.max(1, view.state.doc.content.size);
          const semantic = findRangeByDescriptor(
            view.state.doc,
            {
              from: rawFrom,
              to: rawTo,
              textHash: anchor.textHash ?? "",
              contextBefore: anchor.contextBefore ?? "",
              contextAfter: anchor.contextAfter ?? "",
            },
            fallbackSearchText ?? "",
          );
          const byRange = Number.isFinite(rawFrom) && Number.isFinite(rawTo) && rawTo > rawFrom
            ? resolveDocRangeFromVisibleOffsets(view.state.doc, rawFrom, rawTo)
            : null;
          const fallbackHint = anchor.contextAfter || anchor.contextBefore || fallbackSearchText || "";
          const byRangeValid = Boolean(
            byRange
            && byRange.to > byRange.from
            && rangeLooksLikeAnchorMatch(view.state.doc, byRange, fallbackHint),
          );
          const resolved = semantic ?? (byRangeValid ? byRange : null);
          if (semantic) mode = "semantic";
          else if (byRangeValid) mode = "fallback";
          const candidate = resolved;
          if (!candidate) return;
          const safeFrom = Math.min(Math.max(1, Math.floor(candidate.from)), docMax);
          const safeTo = Math.min(Math.max(1, Math.floor(candidate.to)), docMax);
          if (safeTo <= safeFrom) return;
          const contextReport = buildContextHitReport(
            view.state.doc,
            { from: safeFrom, to: safeTo },
            anchor.contextBefore ?? "",
            anchor.contextAfter ?? "",
          );
          const selectedText = normalizeAnchorProbeText(
            view.state.doc.textBetween(safeFrom, safeTo, " ", " "),
          );
          console.groupCollapsed(
            `[Wise Anchor Debug] ${anchor.textHash || "anchor"} mode=${mode} range=${safeFrom}-${safeTo}`,
          );
          console.info("contextBefore 命中", contextReport.beforeHit, contextReport.beforeNeedles);
          console.info("contextAfter 命中", contextReport.afterHit, contextReport.afterNeedles);
          console.info("命中区间文本", selectedText);
          console.info("区间前窗口", contextReport.beforeWindow);
          console.info("区间后窗口", contextReport.afterWindow);
          console.info("fallbackSearchText", fallbackSearchText ?? "");
          console.groupEnd();
          applyFocusRange(editor, { from: safeFrom, to: safeTo });
          blockElementFromDocPos(view, safeFrom)?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        if (!ok) return;
      });
      return mode;
    },
    clearRequirementFocusHighlight: () => {
      const crepe = crepeRef.current;
      if (!crepe) return;
      clearFocusRange(crepe.editor);
    },
  }), [applyFocusRange, clearFocusRange, runCommand, runHistoryCommand]);

  const showAnchors = Boolean(taskAnchors?.length);

  return (
    <div ref={hostRef} className="app-milkdown-anchor-host" key={instanceKey}>
      {previewSrc ? (
        <MilkdownImagePreview src={previewSrc} onClose={() => setPreviewSrc(null)} />
      ) : null}
      <div ref={rootRef} className="app-milkdown-viewer app-milkdown-viewer--crepe" />
      {showAnchors ? (
        <div className="app-milkdown-task-anchor-overlay" aria-hidden={false}>
          {anchorLayouts.map((layout) => (
            <div
              key={layout.key}
              className={[
                "app-milkdown-task-anchor-group",
                layout.selected ? "app-milkdown-task-anchor-group--selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ top: layout.top, left: layout.left }}
            >
              {layout.markers.map((marker, index) => (
                <button
                  key={marker.taskId}
                  type="button"
                  className="app-milkdown-task-anchor-badge"
                  style={{ zIndex: index + 1 }}
                  aria-label={`定位到任务 ${marker.label}`}
                  title={`定位到任务 ${marker.taskId}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onTaskAnchorMarkerClick?.(marker.taskId)}
                >
                  {marker.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
});
MilkdownEditor.displayName = "MilkdownEditor";

