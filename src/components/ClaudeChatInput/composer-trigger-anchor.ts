/** Semi AIChatInput 底层 Tiptap / ProseMirror 的最小类型面（用于 @ / 弹出框锚点）。 */
export type ComposerProseMirrorView = {
  coordsAtPos: (
    pos: number,
    side?: number,
  ) => { left: number; top: number; bottom: number; right: number };
  domAtPos: (pos: number) => { node: Node; offset: number };
};

export type ComposerProseMirrorEditor = {
  getText?: (opts?: { blockSeparator?: string }) => string;
  state: {
    doc: {
      content: { size: number };
      textBetween: (from: number, to: number, blockSeparator?: string) => string;
    };
    selection?: {
      from: number;
      to?: number;
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
type ComposerFocusableEditor = ComposerProseMirrorEditor & {
  chain?: () => {
    setTextSelection: (pos: number) => { focus: () => { run: () => void } };
    focus: (pos?: number) => { run: () => void };
  };
};

/** 在纯文本偏移处聚焦并放置光标（与 `plainOffsetToProseMirrorPos` 对齐）。 */
/** Semi `AIChatInput` ref：`focusEditor` 要求 `FocusPosition`，与可选参数签名不结构兼容，故用宽松入参。 */
export function focusComposerAtPlainOffset(
  aiChat: { getEditor?: () => unknown; focusEditor?: unknown } | null,
  plainOffset: number,
): void {
  if (!aiChat) return;
  const focusEditor = aiChat.focusEditor as ((pos?: number | string) => void) | undefined;
  const raw = aiChat.getEditor?.();
  if (!raw || typeof raw !== "object") {
    focusEditor?.();
    return;
  }
  try {
    const editor = raw as ComposerFocusableEditor;
    const pmPos = plainOffsetToProseMirrorPos(editor, plainOffset);
    if (editor.chain) {
      editor.chain().setTextSelection(pmPos).focus().run();
      return;
    }
    focusEditor?.(pmPos);
  } catch {
    focusEditor?.();
  }
}

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

export type SlashPopoverViewport = {
  width: number;
  height: number;
};

/**
 * Portal 宿主须仍处在 Ant Design css-var 作用域内（勿挂到裸 `document.body`，
 * 否则 `--ant-color-*` 失效，弹层背景会变成透明）。
 * 同时选尽量靠上的节点，避免落在会话区 overflow/contain / Monaco 裁切层里。
 */
export function resolveSlashPopoverPortalRoot(anchor: HTMLElement | null): HTMLElement {
  if (typeof document === "undefined") {
    throw new Error("resolveSlashPopoverPortalRoot requires document");
  }
  const fromAnchor =
    anchor?.closest<HTMLElement>(".ant-app") ??
    anchor?.closest<HTMLElement>("[class*='css-var-']") ??
    null;
  return (
    fromAnchor ??
    document.querySelector<HTMLElement>(".ant-app") ??
    document.querySelector<HTMLElement>("[class*='css-var-']") ??
    document.getElementById("root") ??
    document.body
  );
}

/** 从仍持有 Ant token 的节点读取不透明底色，写入 portal 节点作硬兜底。 */
export function resolveSlashPopoverOpaqueBackground(from: HTMLElement | null): string {
  if (!from || typeof getComputedStyle !== "function") {
    return "#ffffff";
  }
  const cs = getComputedStyle(from);
  const token = cs.getPropertyValue("--ant-color-bg-container").trim();
  if (token) return token;
  const solid = cs.backgroundColor?.trim();
  if (solid && solid !== "transparent" && solid !== "rgba(0, 0, 0, 0)") {
    return solid;
  }
  return "#ffffff";
}

/**
 * `position: fixed` 的视口坐标。
 * 与 `resolveSlashPopoverPortalRoot` 搭配：避开会话区 overflow，同时保住主题变量。
 * 水平方向优先夹在 composer shell 内，再夹入视口。
 */
export function computeSlashPopoverPlacement(
  positionRoot: HTMLElement,
  caretRect: DOMRect,
  popoverWidth = SLASH_POPOVER_WIDTH_PX,
  viewport?: SlashPopoverViewport,
): { left: number; bottom: number } {
  const root = positionRoot.getBoundingClientRect();
  const vw =
    viewport?.width ??
    (typeof window !== "undefined" ? window.innerWidth : Math.max(root.right, popoverWidth));
  const vh =
    viewport?.height ??
    (typeof window !== "undefined" ? window.innerHeight : Math.max(root.bottom, 1));

  const maxInRoot = root.left + Math.max(0, root.width - popoverWidth);
  let left = Math.min(Math.max(root.left, caretRect.left), maxInRoot);
  left = Math.min(Math.max(0, left), Math.max(0, vw - popoverWidth));

  const bottom = vh - caretRect.top + 4;
  return { left, bottom };
}
