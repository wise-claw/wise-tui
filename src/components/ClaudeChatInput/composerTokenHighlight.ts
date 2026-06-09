import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node } from "@tiptap/pm/model";
import { Decoration, DecorationSet, type DecorationAttrs } from "@tiptap/pm/view";
import type { ComposerProseMirrorEditor } from "./composer-trigger-anchor";
import { plainOffsetToProseMirrorPos } from "./composer-trigger-anchor";

export type ComposerHighlightKind = "at" | "slash";

export interface ComposerHighlightRange {
  start: number;
  end: number;
  kind: ComposerHighlightKind;
}

const COMPOSER_TOKEN_HIGHLIGHT_KEY = new PluginKey<DecorationSet>("wise-composer-token-highlight");

function normalizeComposerPlain(plain: string): string {
  return plain.replace(/\u200B/g, "");
}

/** 扫描纯文本中的 @ 指派与 / 指令 token（与 composer 发送语义对齐，仅做视觉高亮）。 */
export function findComposerHighlightRanges(plain: string): ComposerHighlightRange[] {
  const text = normalizeComposerPlain(plain);
  const ranges: ComposerHighlightRange[] = [];
  const occupied = new Array<boolean>(text.length).fill(false);

  const slashRe = /(?<![:/])\/(\S+)/g;
  for (const match of text.matchAll(slashRe)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    ranges.push({ start, end, kind: "slash" });
    for (let i = start; i < end; i += 1) occupied[i] = true;
  }

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch !== "@" && ch !== "＠") continue;
    if (occupied[i]) continue;

    let end = i + 1;
    while (end < text.length && /\S/u.test(text[end]!)) end += 1;

    while (end < text.length && text[end] === " ") {
      const wordStart = end + 1;
      if (wordStart >= text.length || text[wordStart] === "/") break;
      let wordEnd = wordStart;
      while (wordEnd < text.length && /[\w.-]/u.test(text[wordEnd]!)) wordEnd += 1;
      if (wordEnd === wordStart) break;
      end = wordEnd;
    }

    if (end <= i + 1) continue;
    ranges.push({ start: i, end, kind: "at" });
    for (let j = i; j < end; j += 1) occupied[j] = true;
  }

  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  return ranges;
}

type PlainTextDoc = ComposerProseMirrorEditor["state"]["doc"];

function decorationAttrsForKind(kind: ComposerHighlightKind): DecorationAttrs {
  return {
    class:
      kind === "at"
        ? "app-composer-token-highlight app-composer-token-highlight--at"
        : "app-composer-token-highlight app-composer-token-highlight--slash",
  };
}

export function buildComposerTokenDecorationSet(doc: PlainTextDoc): DecorationSet {
  const plain = normalizeComposerPlain(doc.textBetween(0, doc.content.size, "\n"));
  if (!plain) return DecorationSet.empty;

  const editorLike = { state: { doc } } as ComposerProseMirrorEditor;
  const decos: Decoration[] = [];

  for (const range of findComposerHighlightRanges(plain)) {
    const from = plainOffsetToProseMirrorPos(editorLike, range.start);
    const to = plainOffsetToProseMirrorPos(editorLike, range.end);
    if (to <= from) continue;
    decos.push(Decoration.inline(from, to, decorationAttrsForKind(range.kind)));
  }

  return decos.length > 0 ? DecorationSet.create(doc as Node, decos) : DecorationSet.empty;
}

export function createComposerTokenHighlightPlugin(): Plugin {
  return new Plugin({
    key: COMPOSER_TOKEN_HIGHLIGHT_KEY,
    state: {
      init: (_, { doc }) => buildComposerTokenDecorationSet(doc),
      apply(tr, set) {
        if (tr.docChanged) {
          return buildComposerTokenDecorationSet(tr.doc);
        }
        return set;
      },
    },
    props: {
      decorations(state) {
        return COMPOSER_TOKEN_HIGHLIGHT_KEY.getState(state) ?? DecorationSet.empty;
      },
    },
  });
}

type ComposerEditorWithState = {
  state: {
    plugins: readonly Plugin[];
    reconfigure: (config: { plugins: readonly Plugin[] }) => unknown;
  };
  view: {
    updateState: (state: unknown) => void;
  };
};

export function attachComposerTokenHighlightPlugin(editor: unknown): Plugin | null {
  if (!editor || typeof editor !== "object") return null;
  const typed = editor as ComposerEditorWithState;
  if (
    !typed.state?.reconfigure ||
    !typed.view?.updateState ||
    !Array.isArray(typed.state.plugins)
  ) {
    return null;
  }
  if (typed.state.plugins.some((plugin) => plugin.spec.key === COMPOSER_TOKEN_HIGHLIGHT_KEY)) {
    return null;
  }
  const plugin = createComposerTokenHighlightPlugin();
  const nextState = typed.state.reconfigure({
    plugins: [...typed.state.plugins, plugin],
  });
  typed.view.updateState(nextState);
  return plugin;
}

export function detachComposerTokenHighlightPlugin(editor: unknown, plugin: Plugin | null): void {
  if (!plugin || !editor || typeof editor !== "object") return;
  const typed = editor as ComposerEditorWithState;
  if (!typed.state?.reconfigure || !typed.view?.updateState) return;
  const nextState = typed.state.reconfigure({
    plugins: typed.state.plugins.filter((item) => item !== plugin),
  });
  typed.view.updateState(nextState);
}
