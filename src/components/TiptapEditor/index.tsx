import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu as BubbleMenuComponent } from "@tiptap/react/menus";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { fileToBase64, TiptapToolbar } from "./toolbar";
import { SlashPopover, type ComposerPlainSurface } from "../ClaudeChatInput/slash-popover";
import {
  detectAtSlashTrigger,
  isAtSlashTriggerSuppressedByPaste,
  PASTE_TRIGGER_SUPPRESS_MS,
} from "../ClaudeChatInput/composer-plain-utils";
import type { TriggerInfo } from "../ClaudeChatInput/slash-trigger";
import type { SessionExecutionEngine } from "../../constants/sessionExecutionEngine";
import {
  applyTiptapPlainEdit,
  docPositionToPlainOffset,
  tiptapDocPlainText,
} from "../../utils/tiptapPlainPosition";
import {
  collectClipboardImageRefs,
  isLikelyImagePaste,
  safeGetData,
  type ClipboardImageRefs,
} from "../../utils/collectClipboardImageFiles";
import {
  fetchRemoteImageAsDataUrl,
  readLocalImageAsDataUrl,
  readSystemClipboardImage,
} from "../../services/pastedImageRefs";
import { buildTiptapExtensions, toggleTaskItemChecked } from "./extensions";
import {
  collectResolvedAnchorRanges,
  createWiseDecorationsPlugin,
  refreshWiseDecorations,
} from "./decorations";
import type { TiptapAnchorRange, TiptapSelectedAnchorDraft, TiptapTaskAnchor } from "./types";
import "./index.css";

/** 兼容旧 MilkdownEditor 的选区/定位语义，供宿主调用。 */
export interface TiptapEditorHandle {
  getSelectedMarkdown: () => string | null;
  getSelectedPlainText: () => string | null;
  getSelectedAnchorDraft: () => TiptapSelectedAnchorDraft | null;
  undo: () => void;
  redo: () => void;
  insertImage: (payload: { src: string; alt?: string; title?: string }) => void;
  toggleStrong: () => void;
  toggleEmphasis: () => void;
  toggleInlineCode: () => void;
  wrapBlockquote: () => void;
  wrapBulletList: () => void;
  wrapOrderedList: () => void;
  wrapTaskList: () => void;
  toggleTaskListItemChecked: () => boolean;
  isTaskListItemActive: () => boolean;
  wrapHeading: (level: number) => void;
  createCodeBlock: () => void;
  insertHr: () => void;
  toggleLink: (href: string) => void;
  scrollToRequirementSnippet: (searchText: string) => void;
  scrollToDocPosition: (from: number) => void;
  highlightDocRange: (from: number, to: number) => void;
  highlightTaskAnchorRange: (
    anchor: {
      from: number;
      to: number;
      textHash: string;
      contextBefore: string;
      contextAfter: string;
    },
    fallbackSearchText?: string,
  ) => "semantic" | "fallback" | "none";
  clearRequirementFocusHighlight: () => void;
}

export interface TiptapEditorProps {
  text: string;
  readonly?: boolean;
  onChange?: (markdown: string) => void;
  /**
   * 启用 @ 提及（终端 / 工作流 / 文件）与 / 命令补全（与会话输入框同款）。
   * 提供 repositoryPath 后支持仓库文件搜索与 slash 目录；employees / teams 为空时仅展示文件与命令。
   */
  mentionSuggestions?: TiptapMentionSuggestions;
  /** 是否显示顶部固定工具栏（语雀风格），默认 true。 */
  toolbar?: boolean;
  /** 是否启用选区气泡工具栏，默认 true。 */
  floatingToolbar?: boolean;
  /** 紧凑排版（表单内小尺寸字段）。 */
  compact?: boolean;
  placeholder?: string;
  taskAnchors?: TiptapTaskAnchor[];
  selectedRequirementAnchorKey?: string | null;
  onTaskAnchorMarkerClick?: (taskId: string) => void;
  onResolvedTaskAnchorIdsChange?: (taskIds: string[]) => void;
  onTaskAnchorRangesChange?: (ranges: Record<string, TiptapAnchorRange>) => void;
  /** 选中文本时出现在工具栏末尾；由宿主实现（如「拆分选中」）。 */
  onToolbarSplitSelection?: () => void;
  /** 兼容旧 MilkdownEditor 的 blockEdit 开关（tiptap 无需该行为，接受并忽略）。 */
  blockEdit?: boolean;
}

export interface TiptapMentionSuggestions {
  repositoryPath: string | null;
  employees?: Array<{ id: string; name: string }>;
  teams?: Array<{ id: string; name: string }>;
  /** 当前会话执行引擎：决定 `/` 补全展示哪套内置命令（与会话输入框一致）。 */
  sessionExecutionEngine?: SessionExecutionEngine;
  /** @ 终端可用的执行引擎（与会话输入框一致）；缺省时仅展示 Claude。 */
  codexAvailable?: boolean;
  cursorAvailable?: boolean;
  geminiAvailable?: boolean;
  opencodeAvailable?: boolean;
  qoderAvailable?: boolean;
}

function collapseWs(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function caretRect(ed: Editor): DOMRect | null {
  try {
    const coords = ed.view.coordsAtPos(ed.state.selection.from);
    return new DOMRect(coords.left, coords.top, coords.right - coords.left, coords.bottom - coords.top);
  } catch {
    return null;
  }
}

function clampPos(pos: number, max: number): number {
  return Math.min(Math.max(1, pos), max);
}

function blockElementFromDocPos(editor: Editor, pos: number): HTMLElement | null {
  const max = Math.max(1, editor.state.doc.content.size);
  const safe = clampPos(Math.floor(pos), max);
  try {
    const dom = editor.view.domAtPos(safe).node;
    const el = dom instanceof HTMLElement ? dom : dom.parentElement;
    return el ?? null;
  } catch {
    return null;
  }
}

function scrollBlockIntoView(editor: Editor, pos: number): void {
  blockElementFromDocPos(editor, pos)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

interface MarkdownStorage {
  getMarkdown: () => string;
  serializer: {
    serialize: (fragment: unknown) => string;
  };
}

function markdownStorage(editor: Editor): MarkdownStorage {
  return (editor.storage as unknown as { markdown: MarkdownStorage }).markdown;
}

async function insertImageFiles(editor: Editor, files: File[]): Promise<void> {
  const imageFiles = files.filter((file) => file.type.startsWith("image/"));
  if (imageFiles.length === 0) return;
  const chain = editor.chain().focus();
  for (const file of imageFiles) {
    const src = await fileToBase64(file);
    chain.setImage({ src, alt: file.name || "" });
  }
  chain.run();
}

/** 远端 URL / 本地路径兜底：转 base64 插入；远端下载失败时保留原 URL（保存阶段再兜底落盘）。 */
async function insertPastedImageRefs(editor: Editor, refs: ClipboardImageRefs): Promise<void> {
  const entries: Array<{ src: string; alt: string }> = [];
  for (const url of refs.remoteUrls) {
    const dataUrl = await fetchRemoteImageAsDataUrl(url);
    entries.push(dataUrl ? { src: dataUrl, alt: "" } : { src: url, alt: "" });
  }
  for (const path of refs.localPaths) {
    const dataUrl = await readLocalImageAsDataUrl(path);
    if (dataUrl) entries.push({ src: dataUrl, alt: "" });
  }
  if (entries.length === 0) return;
  const chain = editor.chain().focus();
  for (const entry of entries) {
    chain.setImage({ src: entry.src, alt: entry.alt });
  }
  chain.run();
}

export const TiptapEditor = forwardRef<TiptapEditorHandle, TiptapEditorProps>(({
  text,
  onChange,
  mentionSuggestions,
  readonly = false,
  toolbar = true,
  floatingToolbar = true,
  compact = false,
  placeholder = "写点什么…",
  taskAnchors,
  selectedRequirementAnchorKey = null,
  onTaskAnchorMarkerClick,
  onResolvedTaskAnchorIdsChange,
  onTaskAnchorRangesChange,
  onToolbarSplitSelection,
}, ref) => {
  const editorRef = useRef<Editor | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastEmittedMarkdownRef = useRef<string | null>(null);
  const applyingExternalRef = useRef(false);
  const mentionSuggestionsRef = useRef<TiptapMentionSuggestions | undefined>(mentionSuggestions);
  mentionSuggestionsRef.current = mentionSuggestions;
  const plainSurfaceRef = useRef<ComposerPlainSurface | null>(null);
  const triggerRectCacheRef = useRef<{ key: string; rect: DOMRect | null } | null>(null);
  const suppressTriggerUntilRef = useRef(0);
  const [mentionTrigger, setMentionTrigger] = useState<TriggerInfo>({
    mode: null,
    query: "",
    rect: null,
  });

  const taskAnchorsRef = useRef<TiptapTaskAnchor[] | undefined>(taskAnchors);
  taskAnchorsRef.current = taskAnchors;
  const selectedKeyRef = useRef<string | null>(selectedRequirementAnchorKey);
  selectedKeyRef.current = selectedRequirementAnchorKey;
  const onMarkerClickRef = useRef(onTaskAnchorMarkerClick);
  onMarkerClickRef.current = onTaskAnchorMarkerClick;
  const onResolvedIdsRef = useRef(onResolvedTaskAnchorIdsChange);
  onResolvedIdsRef.current = onResolvedTaskAnchorIdsChange;
  const onRangesRef = useRef(onTaskAnchorRangesChange);
  onRangesRef.current = onTaskAnchorRangesChange;
  const focusRangeRef = useRef<TiptapAnchorRange | null>(null);

  const lastResolvedIdsRef = useRef<string[] | null>(null);
  const lastRangesRef = useRef<string | null>(null);

  /** 按光标前的纯文本重算 @ / 命令触发状态（与会话输入框同款规则）。 */
  const refreshMentionTrigger = useCallback(() => {
    const ed = editorRef.current;
    if (!ed || !mentionSuggestionsRef.current) {
      setMentionTrigger((prev) =>
        prev.mode === null && prev.query === "" ? prev : { mode: null, query: "", rect: null },
      );
      return;
    }
    const plainUpToCursor = ed.state.doc.textBetween(0, ed.state.selection.from, "\n");
    if (isAtSlashTriggerSuppressedByPaste(suppressTriggerUntilRef.current, Date.now())) {
      setMentionTrigger((prev) =>
        prev.mode === null && prev.query === "" ? prev : { mode: null, query: "", rect: null },
      );
      return;
    }
    const detected = detectAtSlashTrigger(plainUpToCursor, plainUpToCursor.length);
    if (!detected) {
      setMentionTrigger((prev) =>
        prev.mode === null && prev.query === "" ? prev : { mode: null, query: "", rect: null },
      );
      return;
    }
    const rectKey = `${detected.mode}:${detected.triggerStart}`;
    if (triggerRectCacheRef.current?.key !== rectKey) {
      triggerRectCacheRef.current = { key: rectKey, rect: caretRect(ed) };
    }
    const cachedRect = triggerRectCacheRef.current?.rect ?? null;
    setMentionTrigger((prev) => {
      if (prev.mode === detected.mode && prev.query === detected.query) return prev;
      return { mode: detected.mode, query: detected.query, rect: cachedRect };
    });
  }, []);

  const reportAnchorResults = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !taskAnchorsRef.current?.length) {
      if (lastResolvedIdsRef.current !== null && lastResolvedIdsRef.current.length > 0) {
        lastResolvedIdsRef.current = [];
        onResolvedIdsRef.current?.([]);
      }
      if (lastRangesRef.current !== null && lastRangesRef.current !== "{}") {
        lastRangesRef.current = "{}";
        onRangesRef.current?.({});
      }
      return;
    }
    const { resolvedIds, ranges } = collectResolvedAnchorRanges(
      editor.state.doc,
      taskAnchorsRef.current,
    );
    const nextIds = resolvedIds;
    const nextRangesJson = JSON.stringify(ranges);
    if (
      lastResolvedIdsRef.current === null
      || nextIds.length !== lastResolvedIdsRef.current.length
      || nextIds.some((id, index) => id !== lastResolvedIdsRef.current?.[index])
    ) {
      lastResolvedIdsRef.current = nextIds;
      onResolvedIdsRef.current?.(nextIds);
    }
    if (lastRangesRef.current === null || lastRangesRef.current !== nextRangesJson) {
      lastRangesRef.current = nextRangesJson;
      onRangesRef.current?.(ranges);
    }
  }, []);

  const decorationsPlugin = useMemo(
    () =>
      createWiseDecorationsPlugin({
        getAnchors: () => taskAnchorsRef.current ?? [],
        getSelectedKey: () => selectedKeyRef.current,
        getFocusRange: () => focusRangeRef.current,
        onMarkerClick: (taskId) => onMarkerClickRef.current?.(taskId),
      }),
    [],
  );
  const editor = useEditor({
    extensions: buildTiptapExtensions({ placeholder, decorationsPlugin }),
    content: text,
    editable: !readonly,
    editorProps: {
      handlePaste() {
        // 粘贴是整块插入：内容里的邮箱 / 路径 / 单斜杠除法不应误开 @ / 命令补全。
        suppressTriggerUntilRef.current = Date.now() + PASTE_TRIGGER_SUPPRESS_MS;
        return false;
      },
      handleDrop(_view, event) {
        const ed = editorRef.current;
        if (!ed) return false;
        const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
          file.type.startsWith("image/"),
        );
        if (files.length === 0) return false;
        event.preventDefault();
        const coords = ed.view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (coords) {
          ed.chain().focus().setTextSelection(coords.pos).run();
        }
        void insertImageFiles(ed, files);
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      refreshMentionTrigger();
      const markdown = markdownStorage(ed).getMarkdown();
      if (applyingExternalRef.current) return;
      if (markdown === lastEmittedMarkdownRef.current) return;
      lastEmittedMarkdownRef.current = markdown;
      onChangeRef.current?.(markdown);
      reportAnchorResults();
    },
    onSelectionUpdate: () => {
      refreshMentionTrigger();
    },
    onCreate: ({ editor: ed }) => {
      editorRef.current = ed;
      lastEmittedMarkdownRef.current = markdownStorage(ed).getMarkdown();
      requestAnimationFrame(() => {
        refreshWiseDecorations(ed);
        reportAnchorResults();
      });
    },
  });

  plainSurfaceRef.current = {
    anchorEl: () => editorRef.current?.view.dom ?? null,
    resolveTriggerAnchorRect: () => {
      const ed = editorRef.current;
      return ed ? caretRect(ed) : null;
    },
    getPlain: () => {
      const ed = editorRef.current;
      return ed ? tiptapDocPlainText(ed.state.doc) : "";
    },
    getCursor: () => {
      const ed = editorRef.current;
      return ed ? docPositionToPlainOffset(ed.state.doc, ed.state.selection.from) : 0;
    },
    setPlainAndCursor: (plain: string) => {
      const ed = editorRef.current;
      if (ed) applyTiptapPlainEdit(ed, plain);
    },
    focus: () => {
      editorRef.current?.commands.focus();
    },
  };

  useEffect(() => {
    return () => {
      editorRef.current = null;
    };
  }, []);

  /**
   * 容器 capture 阶段拦截图片粘贴（与 Claude 输入区同款模式，WKWebView 下最稳）：
   * 覆盖截图/复制图片文件、files 兜底、text/html data URL、网页复制图片的远端 URL、
   * 以及 Finder 复制图片文件的 file:// 路径。命中任一图片引用即拦截，避免只落下 URL 文本。
   * ProseMirror 自身 handlePaste 在部分 webview 拿不到 clipboardData，这里统一接管。
   */
  const handlePastedImageRefs = useCallback((event: ClipboardEvent) => {
    const ed = editorRef.current;
    const host = hostRef.current;
    if (!ed || !host) return false;
    const target = event.target;
    if (target instanceof Node) {
      const contentEl = host.querySelector(".tiptap.ProseMirror");
      if (contentEl && !contentEl.contains(target)) return false;
    }
    const refs = collectClipboardImageRefs(event.clipboardData);

    if (refs.files.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      void insertImageFiles(ed, refs.files);
      return true;
    }

    const data = event.clipboardData;
    const hasFallbackRefs = refs.remoteUrls.length > 0 || refs.localPaths.length > 0;
    const hasText =
      data != null
      && (safeGetData(data, "text/plain") !== "" || safeGetData(data, "text/html") !== "");
    const imageHint = data != null && isLikelyImagePaste(data);

    // WKWebView 下 DOM 拿不到图片数据（截屏、网页复制图片）时，从系统剪贴板直接读图兜底。
    // 普通文本粘贴（hasText 且有内容）不探测，避免每次粘贴都做一次原生调用。
    const shouldProbeSystem = hasFallbackRefs || imageHint || !hasText;
    if (hasFallbackRefs || imageHint) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (shouldProbeSystem) {
      const plain = data ? safeGetData(data, "text/plain") : "";
      void readSystemClipboardImage().then((dataUrl) => {
        const edNow = editorRef.current;
        if (!edNow) return;
        if (dataUrl) {
          edNow.chain().focus().setImage({ src: dataUrl, alt: "" }).run();
          return;
        }
        if (hasFallbackRefs) {
          void insertPastedImageRefs(edNow, refs);
          return;
        }
        // 系统剪贴板里其实没有图片（可能只复制了图片 URL 文本），补回原文本。
        if (plain && (imageHint || !data)) {
          edNow.chain().focus().insertContent(plain).run();
        }
      });
    }
    return hasFallbackRefs || imageHint;
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || readonly) return;
    const onPasteCapture = (e: ClipboardEvent) => {
      handlePastedImageRefs(e);
    };
    host.addEventListener("paste", onPasteCapture, true);
    return () => host.removeEventListener("paste", onPasteCapture, true);
  }, [readonly, handlePastedImageRefs]);

  /** readonly 切换时同步编辑器可编辑状态。 */
  useEffect(() => {
    editor?.setEditable(!readonly);
  }, [editor, readonly]);

  /** 外部受控文本同步：仅当与当前文档 Markdown 不同时重置。 */
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const current = markdownStorage(ed).getMarkdown();
    if (current === text) return;
    applyingExternalRef.current = true;
    lastEmittedMarkdownRef.current = text;
    ed.commands.setContent(text, { emitUpdate: false });
    applyingExternalRef.current = false;
    focusRangeRef.current = null;
    requestAnimationFrame(() => {
      refreshWiseDecorations(ed);
      reportAnchorResults();
    });
  }, [text, reportAnchorResults]);

  /** 锚点/高亮状态变化时刷新装饰。 */
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    refreshWiseDecorations(ed);
    reportAnchorResults();
  }, [taskAnchors, selectedRequirementAnchorKey, reportAnchorResults]);

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const handleUpdate = () => reportAnchorResults();
    ed.on("update", handleUpdate);
    return () => {
      ed.off("update", handleUpdate);
    };
  }, [reportAnchorResults]);

  const applyFocusRange = useCallback((range: TiptapAnchorRange) => {
    const ed = editorRef.current;
    if (!ed) return;
    focusRangeRef.current = range;
    refreshWiseDecorations(ed);
  }, []);

  useImperativeHandle(ref, () => ({
    getSelectedMarkdown: (): string | null => {
      const ed = editorRef.current;
      if (!ed) return null;
      try {
        const { from, to } = ed.state.selection;
        if (from === to) return null;
        const md = markdownStorage(ed).serializer.serialize(ed.state.selection.content().content);
        const trimmed = md.trim();
        return trimmed.length > 0 ? md : null;
      } catch {
        return null;
      }
    },
    getSelectedPlainText: (): string | null => {
      const ed = editorRef.current;
      if (!ed) return null;
      try {
        const { from, to } = ed.state.selection;
        if (from === to) return null;
        const textValue = collapseWs(ed.state.doc.textBetween(from, to, " ", " "));
        return textValue.length > 0 ? textValue : null;
      } catch {
        return null;
      }
    },
    getSelectedAnchorDraft: () => {
      const ed = editorRef.current;
      if (!ed) return null;
      try {
        const { from, to } = ed.state.selection;
        if (from === to) return null;
        const doc = ed.state.doc;
        const textValue = collapseWs(doc.textBetween(from, to, " ", " "));
        if (!textValue) return null;
        const max = Math.max(1, doc.content.size);
        return {
          from,
          to,
          text: textValue,
          contextBefore: doc.textBetween(Math.max(1, from - 140), from, " ", " "),
          contextAfter: doc.textBetween(to, Math.min(max, to + 140), " ", " "),
        };
      } catch {
        return null;
      }
    },
    undo: () => {
      editorRef.current?.chain().focus().undo().run();
    },
    redo: () => {
      editorRef.current?.chain().focus().redo().run();
    },
    insertImage: (payload) => {
      editorRef.current?.chain().focus().setImage(payload).run();
    },
    toggleStrong: () => {
      editorRef.current?.chain().focus().toggleBold().run();
    },
    toggleEmphasis: () => {
      editorRef.current?.chain().focus().toggleItalic().run();
    },
    toggleInlineCode: () => {
      editorRef.current?.chain().focus().toggleCode().run();
    },
    wrapBlockquote: () => {
      editorRef.current?.chain().focus().toggleBlockquote().run();
    },
    wrapBulletList: () => {
      editorRef.current?.chain().focus().toggleBulletList().run();
    },
    wrapOrderedList: () => {
      editorRef.current?.chain().focus().toggleOrderedList().run();
    },
    wrapTaskList: () => {
      editorRef.current?.chain().focus().toggleTaskList().run();
    },
    toggleTaskListItemChecked: () => {
      const ed = editorRef.current;
      return ed ? toggleTaskItemChecked(ed) : false;
    },
    isTaskListItemActive: () => Boolean(editorRef.current?.isActive("taskItem")),
    wrapHeading: (level) => {
      if (level < 1 || level > 6) return;
      editorRef.current
        ?.chain()
        .focus()
        .toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 })
        .run();
    },
    createCodeBlock: () => {
      editorRef.current?.chain().focus().toggleCodeBlock().run();
    },
    insertHr: () => {
      editorRef.current?.chain().focus().setHorizontalRule().run();
    },
    toggleLink: (href) => {
      editorRef.current?.chain().focus().extendMarkRange("link").setLink({ href }).run();
    },
    scrollToRequirementSnippet: (searchText) => {
      const snippet = searchText.trim();
      const ed = editorRef.current;
      if (!snippet || !ed) return;
      const max = Math.max(1, ed.state.doc.content.size);
      let found = false;
      ed.state.doc.descendants((node, pos) => {
        if (found || !node.isTextblock) return false;
        const textValue = node.textBetween(0, node.content.size, " ", " ");
        const index = textValue.indexOf(snippet);
        if (index >= 0) {
          const abs = clampPos(pos + 1 + index, max);
          const end = Math.min(max, abs + snippet.length);
          applyFocusRange({ from: abs, to: end > abs ? end : abs + 1 });
          scrollBlockIntoView(ed, abs);
          found = true;
          return false;
        }
        return true;
      });
    },
    scrollToDocPosition: (from) => {
      const target = Math.floor(Number(from));
      const ed = editorRef.current;
      if (!Number.isFinite(target) || target < 0 || !ed) return;
      scrollBlockIntoView(ed, target);
    },
    highlightDocRange: (from, to) => {
      const rawFrom = Math.floor(Number(from));
      const rawTo = Math.floor(Number(to));
      const ed = editorRef.current;
      if (!Number.isFinite(rawFrom) || !Number.isFinite(rawTo) || rawTo <= rawFrom || !ed) return;
      const max = Math.max(1, ed.state.doc.content.size);
      const safeFrom = clampPos(rawFrom, max);
      const safeTo = clampPos(rawTo, max);
      if (safeTo <= safeFrom) return;
      applyFocusRange({ from: safeFrom, to: safeTo });
      scrollBlockIntoView(ed, safeFrom);
    },
    highlightTaskAnchorRange: (anchor, fallbackSearchText) => {
      const ed = editorRef.current;
      if (!ed) return "none";
      const max = Math.max(1, ed.state.doc.content.size);
      const rawFrom = Math.floor(Number(anchor.from));
      const rawTo = Math.floor(Number(anchor.to));
      const from = Number.isFinite(rawFrom) ? clampPos(rawFrom, max) : null;
      const to = Number.isFinite(rawTo) ? clampPos(rawTo, max) : null;
      if (from != null && to != null && to > from) {
        applyFocusRange({ from, to });
        scrollBlockIntoView(ed, from);
        return "semantic";
      }
      const hint = (fallbackSearchText ?? anchor.contextAfter ?? anchor.contextBefore ?? "").trim();
      if (hint) {
        let hitPos: number | null = null;
        ed.state.doc.descendants((node, pos) => {
          if (hitPos != null || !node.isTextblock) return false;
          const textValue = node.textBetween(0, node.content.size, " ", " ");
          const index = textValue.indexOf(hint);
          if (index >= 0) {
            hitPos = clampPos(pos + 1 + index, max);
            return false;
          }
          return true;
        });
        if (hitPos != null) {
          applyFocusRange({ from: hitPos, to: Math.min(max, hitPos + Math.max(1, hint.length)) });
          scrollBlockIntoView(ed, hitPos);
          return "fallback";
        }
      }
      return "none";
    },
    clearRequirementFocusHighlight: () => {
      focusRangeRef.current = null;
      const ed = editorRef.current;
      if (ed) refreshWiseDecorations(ed);
    },
  }), [applyFocusRange, reportAnchorResults]);

  const showToolbar = !readonly && toolbar;
  const showBubble = !readonly && floatingToolbar && editor != null;

  return (
    <div
      ref={hostRef}
      className={[
        "app-tiptap-editor",
        compact ? "app-tiptap-editor--compact" : "",
        readonly ? "app-tiptap-editor--readonly" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {showToolbar && editor ? (
        <TiptapToolbar editor={editor} onSplitSelection={onToolbarSplitSelection} />
      ) : null}
      <div className="app-tiptap-editor__stage">
        <div className="app-tiptap-editor__paper">
          <EditorContent editor={editor} className="app-tiptap-editor__content" />
        </div>
      </div>
      {showBubble ? (
        <BubbleMenuComponent
          editor={editor}
          className="app-tiptap-bubble-menu"
          shouldShow={({
            editor: ed,
            state,
          }: {
            editor: { isEditable: boolean };
            state: { selection: { from: number; to: number } };
          }) => {
            if (ed.isEditable === false) return false;
            const { from, to } = state.selection;
            return from !== to;
          }}
        >
          <button
            type="button"
            className="app-tiptap-bubble-menu__btn"
            aria-label="加粗"
            title="加粗"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <b>B</b>
          </button>
          <button
            type="button"
            className="app-tiptap-bubble-menu__btn"
            aria-label="斜体"
            title="斜体"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <i>I</i>
          </button>
          <button
            type="button"
            className="app-tiptap-bubble-menu__btn"
            aria-label="删除线"
            title="删除线"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <s>S</s>
          </button>
          <button
            type="button"
            className="app-tiptap-bubble-menu__btn"
            aria-label="行内代码"
            title="行内代码"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            {"</>"}
          </button>
        </BubbleMenuComponent>
      ) : null}
      {mentionSuggestions ? (
        <SlashPopover
          surfaceRef={plainSurfaceRef}
          trigger={mentionTrigger}
          onDismiss={() => setMentionTrigger({ mode: null, query: "", rect: null })}
          onSelect={() => {}}
          repositoryPath={mentionSuggestions.repositoryPath ?? undefined}
          employeeOptions={mentionSuggestions.employees ?? []}
          teamOptions={mentionSuggestions.teams ?? []}
          codexAvailable={mentionSuggestions.codexAvailable ?? false}
          cursorAvailable={mentionSuggestions.cursorAvailable ?? false}
          geminiAvailable={mentionSuggestions.geminiAvailable ?? false}
          opencodeAvailable={mentionSuggestions.opencodeAvailable ?? false}
          qoderAvailable={mentionSuggestions.qoderAvailable ?? false}
          sessionExecutionEngine={mentionSuggestions.sessionExecutionEngine}
          zIndex={12000}
        />
      ) : null}
    </div>
  );
});
TiptapEditor.displayName = "TiptapEditor";

/** 只读内容展示：语雀风格居中纸张排版，内容不贴边，图片靠左。 */
export function TiptapViewer({ text, className }: { text: string; className?: string }) {
  return (
    <div className={["app-tiptap-viewer", className].filter(Boolean).join(" ")}>
      <TiptapEditor text={text} readonly toolbar={false} floatingToolbar={false} />
    </div>
  );
}

export type { TiptapTaskAnchor, TiptapAnchorRange, TiptapTaskAnchorMarker } from "./types";
