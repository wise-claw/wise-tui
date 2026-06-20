import type { editor, IDisposable, Selection } from "monaco-editor";

/** 无按键移动时，超过此行数视为触控板惯性滚动误选。 */
export const ACCIDENTAL_MIN_LINE_SPAN = 2;
/** 无按键移动时，超此字符数视为误选（单行长按拖拽除外）。 */
export const ACCIDENTAL_MIN_CHAR_COUNT = 80;
/** 滚轮/scroll 后短时间内仍视为滚动上下文。 */
const WHEEL_SELECTION_GUARD_MS = 200;

export function selectionLineSpan(selection: Selection): number {
  return Math.abs(selection.endLineNumber - selection.startLineNumber) + 1;
}

export function isAccidentalBlockSelection(
  editor: editor.IStandaloneCodeEditor,
  selection: Selection,
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
  // 等价于 setSelection(Selection.fromPositions(anchor, anchor))：把光标收到锚点，清空误选区。
  // 用 setPosition 避免 import monaco-editor 命名空间（无 window 的测试环境加载即崩溃）。
  editor.setPosition(selection.getStartPosition());
}

function shouldCollapseSelection(
  editor: editor.IStandaloneCodeEditor,
  selection: Selection,
  options: { duringScroll: boolean },
): boolean {
  if (selection.isEmpty()) return false;
  // 触控板滚动期间：任何非空选区都视为误选（保留按住主键拖拽的正常选择）。
  if (options.duringScroll) return true;
  return isAccidentalBlockSelection(editor, selection);
}

function hasNonEmptySelection(editor: editor.IStandaloneCodeEditor): boolean {
  const selection = editor.getSelection();
  return Boolean(selection && !selection.isEmpty());
}

/**
 * macOS 触控板惯性滚动时，Monaco 常在未按住鼠标键的情况下拉出大块选区。
 * 在滚轮 / scroll / 无按键移动时收起意外选区，保留正常拖拽选择。
 */
export function installMonacoTrackpadSelectionGuard(
  editor: editor.IStandaloneCodeEditor,
): IDisposable {
  let primaryButtonDown = false;
  /** 用户通过按住主键拖拽形成的选区；松键后移动鼠标不应被误杀。 */
  let userOwnedSelection = false;
  let lastScrollAt = 0;
  const disposables: IDisposable[] = [];

  const markScroll = () => {
    lastScrollAt = Date.now();
  };

  const isDuringScroll = () => Date.now() - lastScrollAt < WHEEL_SELECTION_GUARD_MS;

  const maybeCollapseAccidentalSelection = (duringScroll: boolean) => {
    if (primaryButtonDown || userOwnedSelection) return;
    const selection = editor.getSelection();
    if (!selection || !shouldCollapseSelection(editor, selection, { duringScroll })) return;
    collapseSelectionToAnchor(editor);
  };

  disposables.push(
    editor.onMouseDown((e) => {
      primaryButtonDown = e.event.leftButton;
      if (primaryButtonDown) {
        userOwnedSelection = false;
      }
    }),
    editor.onMouseUp(() => {
      const wasSelecting = primaryButtonDown;
      primaryButtonDown = false;
      if (wasSelecting) {
        userOwnedSelection = hasNonEmptySelection(editor);
      }
    }),
    editor.onMouseMove(() => {
      if (primaryButtonDown || userOwnedSelection) return;
      if (isDuringScroll()) {
        maybeCollapseAccidentalSelection(true);
        return;
      }
      // 部分触控板手势不会触发 wheel，但仍会拉出大块选区。
      const selection = editor.getSelection();
      if (selection && isAccidentalBlockSelection(editor, selection)) {
        collapseSelectionToAnchor(editor);
      }
    }),
    editor.onDidChangeCursorSelection((e) => {
      if (primaryButtonDown) {
        userOwnedSelection = hasNonEmptySelection(editor);
        return;
      }
      if (e.source === "mouse" || e.source === "keyboard") {
        userOwnedSelection = hasNonEmptySelection(editor);
        return;
      }
      if (userOwnedSelection) return;
      if (!isDuringScroll()) return;
      maybeCollapseAccidentalSelection(true);
    }),
  );

  const dom = editor.getDomNode();
  const onWheel = () => {
    markScroll();
    maybeCollapseAccidentalSelection(true);
  };
  const onScroll = () => {
    markScroll();
    maybeCollapseAccidentalSelection(true);
  };

  dom?.addEventListener("wheel", onWheel, { passive: true, capture: true });
  dom?.addEventListener("scroll", onScroll, { passive: true, capture: true });

  return {
    dispose: () => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
      dom?.removeEventListener("wheel", onWheel, true);
      dom?.removeEventListener("scroll", onScroll, true);
    },
  };
}
