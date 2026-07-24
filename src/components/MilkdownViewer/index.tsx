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
import { uploadConfig } from "@milkdown/kit/plugin/upload";
import { getMarkdown } from "@milkdown/utils";
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
import { Milkdown, MilkdownProvider, useEditor, useInstance } from "@milkdown/react";
import { Crepe, CrepeFeature } from "@milkdown/crepe";
import { nord } from "@milkdown/theme-nord";
import "@milkdown/theme-nord/style.css";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/nord.css";
import { annotateCrepeToolbarButtons } from "../../utils/crepeToolbarTitles";
import {
  isTaskListItemActive,
  toggleTaskListItemChecked,
  wrapTaskListItem,
} from "./milkdownTaskListCommands";
import { sameResolvedAnchorRanges } from "../../utils/anchorStability";
import { collectResolvedAnchorRanges, computeAnchorLayouts, sameAnchorLayouts, type AnchorLayout } from "./anchorLayout";
import {
  buildContextHitReport,
  buildSelectedAnchorDraft,
  findRangeByDescriptor,
  findRequirementHighlightRange,
  findTextblockStartForNeedle,
  rangeLooksLikeAnchorMatch,
  resolveDocRangeFromVisibleOffsets,
} from "./anchorRanges";
import { collapseWs, normalizeAnchorProbeText } from "./anchorText";
import {
  createWiseTaskRequirementFocusPlugin,
  createWiseTaskRequirementHighlightPlugin,
  dispatchTaskRequirementFocusRefresh,
  dispatchTaskRequirementHighlightRefresh,
} from "./anchorPlugins";
import { blockElementFromDocPos, runWithEditorView } from "./editorView";
import type { AnchorRange, MilkdownTaskAnchor } from "./types";
import "./index.css";

export type { MilkdownTaskAnchor, MilkdownTaskAnchorMarker } from "./types";

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
  onTaskAnchorRangesChange?: (ranges: Record<string, AnchorRange>) => void;
  /** 选中文本时出现在 Crepe 浮动工具栏末尾；由宿主实现（如「拆分选中」）。 */
  onToolbarSplitSelection?: () => void;
  /** Disable Crepe block edit/slash provider for views that unmount immediately after submit. */
  blockEdit?: boolean;
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
  wrapTaskList: () => void;
  toggleTaskListItemChecked: () => boolean;
  isTaskListItemActive: () => boolean;
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
    wrapTaskList: () => {
      runCommand((editor) => wrapTaskListItem(editor));
    },
    toggleTaskListItemChecked: () => {
      let toggled = false;
      runCommand((editor) => {
        toggled = toggleTaskListItemChecked(editor);
      });
      return toggled;
    },
    isTaskListItemActive: () => {
      const editor = getInstance();
      if (!editor) return false;
      return isTaskListItemActive(editor);
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


export const MilkdownEditor = forwardRef<MilkdownEditorHandle, MilkdownEditorProps>(({
  text,
  onChange,
  readonly = false,
  floatingToolbar = true,
  taskAnchors,
  selectedRequirementAnchorKey = null,
  onTaskAnchorMarkerClick,
  onResolvedTaskAnchorIdsChange,
  onTaskAnchorRangesChange,
  onToolbarSplitSelection,
  blockEdit = true,
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
  const lastReportedRangesRef = useRef<Record<string, AnchorRange> | undefined>(undefined);
  /** `crepe.create()` 完成后递增，用于在 editorView 就绪后挂载 DOM 观察器。 */
  const [crepeReadyGeneration, setCrepeReadyGeneration] = useState(0);
  const scheduleMeasureAnchorsRef = useRef<() => void>(() => {});
  const taskAnchorsRef = useRef(taskAnchors);
  taskAnchorsRef.current = taskAnchors;
  const selectedRequirementKeyRef = useRef<string | null>(null);
  selectedRequirementKeyRef.current = selectedRequirementAnchorKey ?? null;
  const focusRangeRef = useRef<AnchorRange | null>(null);
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
    range: AnchorRange,
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

    const crepeFeatures = {
      ...(floatingToolbar ? {} : { [CrepeFeature.Toolbar]: false }),
      ...(blockEdit ? {} : { [CrepeFeature.BlockEdit]: false }),
    };
    const crepe = new Crepe({
      root,
      defaultValue: initialText.trim().length > 0 ? initialText : MILKDOWN_EMPTY_DOCUMENT_MARKDOWN,
      features: crepeFeatures,
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
      // 配置 upload handler：粘贴/拖入图片时直接转 base64，避免临时 blob URL
      crepe.editor.action((ctx) => {
        ctx.update(uploadConfig.key, (prev) => ({
          ...prev,
          uploader: async (files, schema) => {
            const imageFiles: File[] = [];
            for (let i = 0; i < files.length; i++) {
              const file = files.item(i);
              if (file && file.type.startsWith("image/")) imageFiles.push(file);
            }
            const nodes = await Promise.all(
              imageFiles.map(async (file) => {
                const buffer = await file.arrayBuffer();
                const bytes = new Uint8Array(buffer);
                let binary = "";
                for (let j = 0; j < bytes.length; j++) {
                  binary += String.fromCharCode(bytes[j]);
                }
                const base64 = btoa(binary);
                const src = `data:${file.type};base64,${base64}`;
                const nodeType = schema.nodes["image-block"] ?? schema.nodes["image"];
                if (!nodeType) return null;
                return nodeType.createAndFill({ src })!;
              }),
            );
            return nodes.filter(Boolean);
          },
        }));
      });
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
      void crepe.destroy().catch(() => undefined);
    };
  }, [
    enableWiseToolbarSplit,
    blockEdit,
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
    const host = hostRef.current;
    if (!host || crepeReadyGeneration === 0) return;
    let annotateRaf = 0;
    const annotateToolbarIfPresent = () => {
      if (!host.querySelector(".milkdown-toolbar")) return;
      if (annotateRaf) return;
      annotateRaf = requestAnimationFrame(() => {
        annotateRaf = 0;
        annotateCrepeToolbarButtons(host);
      });
    };
    const toolbarObserver = new MutationObserver(annotateToolbarIfPresent);
    toolbarObserver.observe(host, { childList: true, subtree: true });
    annotateToolbarIfPresent();
    return () => {
      toolbarObserver.disconnect();
      if (annotateRaf) cancelAnimationFrame(annotateRaf);
    };
  }, [crepeReadyGeneration, instanceKey]);

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
    function handleEditorShortcut(event: KeyboardEvent) {
      if (!isEditorFocused()) return;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
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
        return;
      }

      if (readonly) return;

      if (key === "t" && event.shiftKey && !event.altKey) {
        runCommand((editor) => wrapTaskListItem(editor));
        event.preventDefault();
        return;
      }

      if (key === "enter" && !event.shiftKey) {
        const crepe = crepeRef.current;
        if (crepe && toggleTaskListItemChecked(crepe.editor)) {
          event.preventDefault();
        }
      }
    }

    document.addEventListener("keydown", handleEditorShortcut, { capture: true });
    return () => {
      document.removeEventListener("keydown", handleEditorShortcut, { capture: true });
    };
  }, [isEditorFocused, readonly, runCommand, runHistoryCommand]);

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
          out = buildSelectedAnchorDraft(view.state.doc, from, to);
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
    wrapTaskList: () => runCommand((editor) => wrapTaskListItem(editor)),
    toggleTaskListItemChecked: () => {
      const crepe = crepeRef.current;
      if (!crepe) return false;
      return toggleTaskListItemChecked(crepe.editor);
    },
    isTaskListItemActive: () => {
      const crepe = crepeRef.current;
      if (!crepe) return false;
      return isTaskListItemActive(crepe.editor);
    },
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
