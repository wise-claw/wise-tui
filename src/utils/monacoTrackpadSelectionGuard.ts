import type { editor, IDisposable, Selection } from "monaco-editor";

/** 无按键移动时，超过此行数视为触控板惯性滚动误选。 */
export const ACCIDENTAL_MIN_LINE_SPAN = 2;
/** 无按键移动时，超此字符数视为误选（单行长按拖拽除外）。 */
export const ACCIDENTAL_MIN_CHAR_COUNT = 80;
/** 滚轮/scroll 后短时间内仍视为滚动上下文（覆盖触控板惯性）。 */
export const WHEEL_SELECTION_GUARD_MS = 450;
/** 按住主键拖拽超过此像素才视为用户主动框选。 */
export const INTENTIONAL_DRAG_THRESHOLD_PX = 4;

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

export function isIntentionalDragDistance(
  start: { x: number; y: number } | null,
  end: { x: number; y: number },
  thresholdPx = INTENTIONAL_DRAG_THRESHOLD_PX,
): boolean {
  if (!start) return false;
  return Math.hypot(end.x - start.x, end.y - start.y) >= thresholdPx;
}

function collapseSelectionToAnchor(editor: editor.IStandaloneCodeEditor): void {
  const selection = editor.getSelection();
  if (!selection || selection.isEmpty()) return;
  const pos = selection.getStartPosition();
  editor.setSelection({
    startLineNumber: pos.lineNumber,
    startColumn: pos.column,
    endLineNumber: pos.lineNumber,
    endColumn: pos.column,
  });
}

function hasSelectionModifiers(event: {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): boolean {
  return event.shiftKey || event.ctrlKey || event.metaKey || event.altKey;
}

/**
 * macOS 触控板惯性滚动时，Monaco 常在未按住鼠标键的情况下拉出大块选区。
 * 仅在「未形成用户确认选区」时收起误选，保留拖拽/键盘/双击等正常选择。
 */
export function installMonacoTrackpadSelectionGuard(
  editor: editor.IStandaloneCodeEditor,
): IDisposable {
  let primaryButtonDown = false;
  /** 用户已完成一次主动选择；滚动或惯性误触不应清除。 */
  let userCommittedSelection = false;
  let lastScrollAt = 0;
  let collapseScheduled = false;
  let collapsing = false;
  const disposables: IDisposable[] = [];

  const markScroll = () => {
    lastScrollAt = Date.now();
  };

  const isDuringScroll = () => Date.now() - lastScrollAt < WHEEL_SELECTION_GUARD_MS;

  const maybeCollapseAccidentalSelection = () => {
    if (collapsing || primaryButtonDown || userCommittedSelection) return;
    const selection = editor.getSelection();
    if (!selection || !isAccidentalBlockSelection(editor, selection)) return;
    collapsing = true;
    try {
      collapseSelectionToAnchor(editor);
    } finally {
      collapsing = false;
    }
  };

  const scheduleCollapse = () => {
    if (collapseScheduled || typeof requestAnimationFrame !== "function") {
      maybeCollapseAccidentalSelection();
      return;
    }
    collapseScheduled = true;
    requestAnimationFrame(() => {
      collapseScheduled = false;
      maybeCollapseAccidentalSelection();
    });
  };

  disposables.push(
    editor.onMouseDown((e) => {
      primaryButtonDown = e.event.leftButton;
      if (primaryButtonDown && !hasSelectionModifiers(e.event)) {
        userCommittedSelection = false;
      }
    }),
    editor.onMouseUp(() => {
      const wasSelecting = primaryButtonDown;
      primaryButtonDown = false;
      const selection = editor.getSelection();
      if (!wasSelecting || !selection || selection.isEmpty()) return;
      // 按住主键松手后的任何非空选区，都视为用户主动选择。
      userCommittedSelection = true;
    }),
    editor.onDidChangeCursorSelection((e) => {
      if (collapsing) return;

      if (e.selection.isEmpty()) {
        userCommittedSelection = false;
        return;
      }

      if (primaryButtonDown) return;

      if (e.source === "keyboard") {
        userCommittedSelection = true;
        return;
      }

      if (userCommittedSelection) return;

      // 未按键、未确认选区：触控板滚动等产生的 mouse 大块选区才清除。
      if (e.source === "mouse" && isAccidentalBlockSelection(editor, e.selection)) {
        scheduleCollapse();
        return;
      }

      if (isDuringScroll() && isAccidentalBlockSelection(editor, e.selection)) {
        scheduleCollapse();
      }
    }),
    editor.onDidScrollChange(() => {
      markScroll();
      scheduleCollapse();
    }),
  );

  const dom = editor.getDomNode();
  const onWheel = (event: WheelEvent) => {
    markScroll();
    if ((event.buttons & 1) === 0) {
      scheduleCollapse();
    }
  };
  const onScroll = () => {
    markScroll();
    scheduleCollapse();
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
