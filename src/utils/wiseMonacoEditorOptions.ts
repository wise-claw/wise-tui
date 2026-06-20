import type { editor } from "monaco-editor";

/**
 * Wise 仓库文件编辑器等场景共用的 Monaco 选项（减轻触控板滚动误选等问题）。
 *
 * 注意：不启用 `automaticLayout`。Monaco 的 automaticLayout 会持续轮询容器尺寸，
 * 多 tab 场景下每个实例都各自轮询，开销可观。改为由各编辑器宿主用 ResizeObserver
 * 仅在容器尺寸真正变化时调用 `editor.layout()`（见 RepositoryFileEditorTabSurface /
 * GitDiffMonacoPane）。非活跃 tab 不挂载编辑器，进一步避免无谓的布局计算。
 */
export const WISE_MONACO_EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  stickyScroll: { enabled: false },
  fontSize: 13,
  lineNumbers: "on",
  wordWrap: "on",
  tabSize: 2,
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  mouseWheelScrollSensitivity: 1,
  fastScrollSensitivity: 5,
  dragAndDrop: false,
  selectOnLineNumbers: true,
  selectionClipboard: false,
  scrollbar: {
    /** 滚动事件留在编辑器内，减少 macOS 触控板滚动误触选区。 */
    alwaysConsumeMouseWheel: true,
    useShadows: false,
  },
};
