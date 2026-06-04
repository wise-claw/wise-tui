import type { editor, ISelection, IDisposable } from "monaco-editor";
import { Selection } from "monaco-editor";

const ACCIDENTAL_MIN_LINE_SPAN = 3;
const ACCIDENTAL_MIN_CHAR_COUNT = 120;

function selectionLineSpan(selection: ISelection): number {
  return Math.abs(selection.endLineNumber - selection.startLineNumber) + 1;
}

function isAccidentalBlockSelection(
  editor: editor.IStandaloneCodeEditor,
  selection: ISelection,
): boolean {
  if (selection.isEmpty()) return false;
  if (selectionLineSpan(selection) >= ACCIDENTAL_MIN_LINE_SPAN) return true;
  const model = editor.getModel();
  if (!model) return false;
  return model.getValueInRange(selection).length >= ACCIDENTAL_MIN_CHAR_COUNT;
}

function collapseSelectionToAnchor(editor: editor.IStandaloneCodeEditor): void {
  const selection = editor.getSelection();
  if (!selection || selection.isEmpty()) return;
  const anchor = selection.getStartPosition();
  editor.setSelection(Selection.fromPositions(anchor, anchor));
}

/**
 * macOS 触控板惯性滚动时，Monaco 常在未按住鼠标键的情况下拉出大块选区。
 * 在滚轮 / 无按键移动时收起「意外」的多行选区，保留正常拖拽选择。
 */
export function installMonacoTrackpadSelectionGuard(
  editor: editor.IStandaloneCodeEditor,
): IDisposable {
  let primaryButtonDown = false;
  const disposables: IDisposable[] = [];

  disposables.push(
    editor.onMouseDown((e) => {
      primaryButtonDown = e.event.leftButton;
    }),
    editor.onMouseUp(() => {
      primaryButtonDown = false;
    }),
    editor.onMouseMove((e) => {
      if (primaryButtonDown || (e.event.buttons & 1) !== 0) return;
      const selection = editor.getSelection();
      if (!selection || !isAccidentalBlockSelection(editor, selection)) return;
      collapseSelectionToAnchor(editor);
    }),
  );

  const dom = editor.getDomNode();
  const onWheel = () => {
    if (primaryButtonDown) return;
    const selection = editor.getSelection();
    if (!selection || !isAccidentalBlockSelection(editor, selection)) return;
    collapseSelectionToAnchor(editor);
  };
  dom?.addEventListener("wheel", onWheel, { passive: true });

  return {
    dispose: () => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
      dom?.removeEventListener("wheel", onWheel);
    },
  };
}
