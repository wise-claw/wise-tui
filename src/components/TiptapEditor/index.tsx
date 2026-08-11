import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu as BubbleMenuComponent } from "@tiptap/react/menus";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { fileToBase64, TiptapToolbar } from "./toolbar";
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

function collapseWs(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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

export const TiptapEditor = forwardRef<TiptapEditorHandle, TiptapEditorProps>(({
  text,
  onChange,
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
      handlePaste(_view, event) {
        const ed = editorRef.current;
        if (!ed) return false;
        const items = Array.from(event.clipboardData?.items ?? []);
        const files = items
          .map((item) => item.getAsFile())
          .filter((file): file is File => file != null && file.type.startsWith("image/"));
        if (files.length === 0) return false;
        event.preventDefault();
        void insertImageFiles(ed, files);
        return true;
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
      const markdown = markdownStorage(ed).getMarkdown();
      if (applyingExternalRef.current) return;
      if (markdown === lastEmittedMarkdownRef.current) return;
      lastEmittedMarkdownRef.current = markdown;
      onChangeRef.current?.(markdown);
      reportAnchorResults();
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

  useEffect(() => {
    return () => {
      editorRef.current = null;
    };
  }, []);

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
