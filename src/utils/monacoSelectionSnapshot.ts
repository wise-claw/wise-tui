import type { editor, Selection } from "monaco-editor";
import { clampMonacoSelectionToolbarPosition } from "./clampMonacoSelectionToolbarPosition";
import type { MonacoSelectionToolbarViewportPosition } from "./monacoSelectionToolbarPosition";

export interface MonacoSelectionSnapshot {
  top: number;
  left: number;
  selectedText: string;
  startLine: number;
  endLine: number;
  startChar: number;
  endChar: number;
}

function normalizeSelectionRange(selection: Selection): {
  startLine: number;
  endLine: number;
  startChar: number;
  endChar: number;
} {
  const backward =
    selection.endLineNumber < selection.startLineNumber
    || (selection.endLineNumber === selection.startLineNumber
      && selection.endColumn < selection.startColumn);
  return {
    startLine: backward ? selection.endLineNumber : selection.startLineNumber,
    endLine: backward ? selection.startLineNumber : selection.endLineNumber,
    startChar: backward ? selection.endColumn : selection.startColumn,
    endChar: backward ? selection.startColumn : selection.endColumn,
  };
}

function resolveToolbarAnchor(
  codeEditor: editor.IStandaloneCodeEditor,
  selection: Selection,
): MonacoSelectionToolbarViewportPosition | null {
  const anchor = codeEditor.getScrolledVisiblePosition({
    lineNumber: selection.endLineNumber,
    column: selection.endColumn,
  });
  if (!anchor) return null;
  const dom = codeEditor.getDomNode();
  if (!dom) return null;
  const rect = dom.getBoundingClientRect();
  // EditorOption.lineHeight 枚举值为 75（monaco-editor 源码 super(75, 'lineHeight', ...)），
  // 用数值常量避免在模块顶层运行时 import monaco-editor 命名空间（否则无 window 的测试环境加载即崩溃）。
  const lineHeight = codeEditor.getOption(75 as editor.EditorOption) as number;
  return clampMonacoSelectionToolbarPosition({
    top: rect.top + anchor.top + lineHeight + 4,
    left: rect.left + anchor.left,
  });
}

/** 从单个 Monaco 编辑器读取可用于「添加到聊天」工具条的选区快照。 */
export function readMonacoSelectionSnapshot(
  codeEditor: editor.IStandaloneCodeEditor,
): MonacoSelectionSnapshot | null {
  const selection = codeEditor.getSelection();
  const model = codeEditor.getModel();
  if (!selection || selection.isEmpty() || !model) return null;

  const selectedText = model.getValueInRange(selection);
  if (!selectedText.trim()) return null;

  const position = resolveToolbarAnchor(codeEditor, selection);
  if (!position) return null;

  const range = normalizeSelectionRange(selection);
  return {
    top: position.top,
    left: position.left,
    selectedText,
    ...range,
  };
}

/** 在多个编辑器中选取当前有非空选区的一个（后者优先）。 */
export function readMonacoSelectionSnapshotFromEditors(
  editors: Array<editor.IStandaloneCodeEditor | null | undefined>,
): MonacoSelectionSnapshot | null {
  let last: MonacoSelectionSnapshot | null = null;
  for (const editor of editors) {
    if (!editor) continue;
    const snapshot = readMonacoSelectionSnapshot(editor);
    if (snapshot) last = snapshot;
  }
  return last;
}

export function formatMonacoSelectionPreview(text: string, maxLen = 72): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return `${oneLine.slice(0, maxLen)}…`;
}
