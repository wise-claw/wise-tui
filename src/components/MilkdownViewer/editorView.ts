import { Editor, editorViewCtx } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";

/** Run only after ProseMirror EditorView is installed in ctx; return false instead of throwing MilkdownError. */
export function runWithEditorView(editor: Editor, fn: (view: EditorView) => void): boolean {
  try {
    editor.action((ctx) => {
      fn(ctx.get(editorViewCtx));
    });
    return true;
  } catch {
    return false;
  }
}

export function blockElementFromDocPos(view: EditorView, pos: number): HTMLElement | null {
  try {
    const max = Math.max(0, view.state.doc.content.size);
    const inner = Math.min(Math.max(1, pos + 1), max);
    const domAt = view.domAtPos(inner);
    let n: globalThis.Node | null = domAt.node;
    if (n.nodeType === globalThis.Node.TEXT_NODE) {
      n = n.parentElement;
    }
    const el = n instanceof HTMLElement ? n : null;
    if (!el) return null;
    const block = el.closest("li, p, h1, h2, h3, h4, h5, h6, blockquote");
    return block instanceof HTMLElement ? block : el;
  } catch {
    return null;
  }
}
