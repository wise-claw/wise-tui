import type { editor } from "monaco-editor";

/** Wise 仓库文件编辑器等场景共用的 Monaco 选项（减轻触控板滚动误选等问题）。 */
export const WISE_MONACO_EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  stickyScroll: { enabled: false },
  fontSize: 13,
  lineNumbers: "on",
  automaticLayout: true,
  wordWrap: "on",
  tabSize: 2,
  scrollBeyondLastLine: false,
  dragAndDrop: false,
  selectOnLineNumbers: true,
  selectionClipboard: false,
  scrollbar: {
    /** 滚动事件留在编辑器内，减少 macOS 触控板滚动误触选区。 */
    alwaysConsumeMouseWheel: true,
    useShadows: false,
  },
};
