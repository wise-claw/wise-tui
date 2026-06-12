import type { editor as MonacoEditorNamespace } from "monaco-editor";
import { readMonacoSelectionSnapshot } from "./monacoSelectionSnapshot";

export interface MonacoSelectionToolbarViewportPosition {
  top: number;
  left: number;
}

/** 选区末端下方、相对视口的 fixed 定位锚点（用于悬浮「添加到聊天」条）。 */
export function resolveMonacoSelectionToolbarPosition(
  editor: MonacoEditorNamespace.IStandaloneCodeEditor,
): MonacoSelectionToolbarViewportPosition | null {
  const snapshot = readMonacoSelectionSnapshot(editor);
  if (!snapshot) return null;
  return { top: snapshot.top, left: snapshot.left };
}
