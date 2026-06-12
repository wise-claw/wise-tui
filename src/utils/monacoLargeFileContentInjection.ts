import type { editor as MonacoEditorNamespace } from "monaco-editor";
import { runWhenIdle } from "./deferIdle";

export function scheduleMonacoLargeFileContentInjection(
  editor: MonacoEditorNamespace.IStandaloneCodeEditor,
  content: string,
  onReady?: () => void,
): () => void {
  return runWhenIdle(
    () => {
      const model = editor.getModel();
      if (!model) return;
      if (model.getValue() !== content) {
        model.setValue(content);
      }
      onReady?.();
    },
    { timeoutMs: 0 },
  );
}
