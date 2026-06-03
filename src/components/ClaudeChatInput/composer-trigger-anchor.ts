/** Semi AIChatInput 底层 Tiptap / ProseMirror 的最小类型面（用于 @ / 弹出框锚点）。 */
export type ComposerProseMirrorView = {
  coordsAtPos: (
    pos: number,
    side?: number,
  ) => { left: number; top: number; bottom: number; right: number };
  domAtPos: (pos: number) => { node: Node; offset: number };
};

export type ComposerProseMirrorEditor = {
  state: {
    doc: {
      content: { size: number };
      textBetween: (from: number, to: number, blockSeparator?: string) => string;
    };
  };
  view: ComposerProseMirrorView;
};

/** 从 Semi `getEditor()` 返回值上解析 ProseMirror `view`（结构因版本而异）。 */
export function resolveComposerProseMirrorView(editor: unknown): ComposerProseMirrorView | null {
  if (!editor || typeof editor !== "object") return null;
  const view = (editor as { view?: unknown }).view;
  if (!view || typeof view !== "object") return null;
  const v = view as ComposerProseMirrorView;
  if (typeof v.coordsAtPos !== "function" || typeof v.domAtPos !== "function") return null;
  return v;
}

/**
 * 与 `doc.textBetween(0, pos, "\\n")` 对齐：plainOffset 表示「该下标字符之前」的插入点。
 * 不能用「首个 len >= target」二分，否则 offset 0 会落在文档头而非首字前。
 */
export function plainOffsetToProseMirrorPos(
  editor: ComposerProseMirrorEditor,
  plainOffset: number,
): number {
  const doc = editor.state.doc;
  const target = Math.max(0, Math.floor(plainOffset));
  const size = doc.content.size;
  let lo = 0;
  let hi = size;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.textBetween(0, mid, "\n").length > target) hi = mid - 1;
    else lo = mid;
  }
  return lo;
}

function caretRectFromProseMirrorView(view: ComposerProseMirrorView, pos: number): DOMRect | null {
  try {
    const domPos = view.domAtPos(pos);
    const range = document.createRange();
    if (domPos.node.nodeType === Node.TEXT_NODE) {
      const len = domPos.node.textContent?.length ?? 0;
      const off = Math.min(domPos.offset, len);
      range.setStart(domPos.node, off);
      range.setEnd(domPos.node, off);
    } else {
      const el = domPos.node as HTMLElement;
      const child = el.childNodes[domPos.offset] ?? el.firstChild;
      if (child?.nodeType === Node.TEXT_NODE) {
        range.setStart(child, 0);
        range.setEnd(child, 0);
      } else if (child) {
        range.selectNodeContents(child);
        range.collapse(true);
      } else {
        range.selectNodeContents(el);
        range.collapse(true);
      }
    }
    const rect = range.getBoundingClientRect();
    if (rect.height > 0 || rect.width > 0) return rect;
  } catch {
    /* fall through */
  }
  try {
    const coords = view.coordsAtPos(pos, 1);
    const w = Math.max(1, coords.right - coords.left);
    const h = Math.max(1, coords.bottom - coords.top);
    return new DOMRect(coords.left, coords.top, w, h);
  } catch {
    return null;
  }
}

/** 取纯文本某偏移处字符左缘在视口中的锚点矩形（用于 @ / 弹出框定位）。 */
export function getComposerEditorCaretRectAtPlainOffset(
  editor: ComposerProseMirrorEditor,
  plainOffset: number,
): DOMRect | null {
  try {
    const pos = plainOffsetToProseMirrorPos(editor, plainOffset);
    return caretRectFromProseMirrorView(editor.view, pos);
  } catch {
    return null;
  }
}

const SLASH_POPOVER_WIDTH_PX = 480;

/** 相对 `positionRoot`（composer shell）的 absolute 定位，避免 fixed + 祖先 contain 导致 left 偏移。 */
export function computeSlashPopoverPlacement(
  positionRoot: HTMLElement,
  caretRect: DOMRect,
  popoverWidth = SLASH_POPOVER_WIDTH_PX,
): { left: number; bottom: number } {
  const root = positionRoot.getBoundingClientRect();
  let left = caretRect.left - root.left;
  const maxLeft = Math.max(0, root.width - popoverWidth);
  left = Math.min(Math.max(0, left), maxLeft);
  const bottom = root.bottom - caretRect.top + 4;
  return { left, bottom };
}
