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

/** @ 指派后续英文词（如 Claude Code）；不含 CJK，避免把正文「你好」吞进提及。 */
const AT_MENTION_CONTINUATION_WORD = /[A-Za-z0-9._-]/;

function normalizeComposerPlain(plain: string): string {
  return plain.replace(/\u200B/g, "");
}

function isSlashCommandToken(token: string): boolean {
  if (!token.startsWith("/")) return false;
  if ((token.match(/\//g) ?? []).length !== 1) return false;
  return true;
}

function findSlashHighlightRangesInLine(
  line: string,
  lineStartOffset: number,
): ComposerHighlightRange[] {
  const ranges: ComposerHighlightRange[] = [];
  let pos = 0;
  while (pos < line.length) {
    while (pos < line.length && (line[pos] === " " || line[pos] === "\t")) pos += 1;
    if (pos >= line.length) break;
    const tokenStart = pos;
    while (pos < line.length && line[pos] !== " " && line[pos] !== "\t") pos += 1;
    const token = line.slice(tokenStart, pos);
    if (!isSlashCommandToken(token)) continue;
    ranges.push({
      start: lineStartOffset + tokenStart,
      end: lineStartOffset + pos,
      kind: "slash",
    });
  }
  return ranges;
}

function findAtHighlightRange(text: string, atIndex: number): ComposerHighlightRange | null {
  let end = atIndex + 1;
  while (end < text.length && /\S/u.test(text[end]!)) end += 1;

  while (end < text.length && text[end] === " ") {
    const wordStart = end + 1;
    if (wordStart >= text.length || text[wordStart] === "/") break;
    let wordEnd = wordStart;
    while (wordEnd < text.length && AT_MENTION_CONTINUATION_WORD.test(text[wordEnd]!)) wordEnd += 1;
    if (wordEnd === wordStart) break;
    end = wordEnd;
  }

  if (end <= atIndex + 1) return null;
  return { start: atIndex, end, kind: "at" };
}

/** 扫描纯文本中的 @ 指派与 / 指令 token（与 composer 发送语义对齐，仅做视觉高亮）。 */
export function findComposerHighlightRanges(plain: string): ComposerHighlightRange[] {
  const text = normalizeComposerPlain(plain);
  const ranges: ComposerHighlightRange[] = [];
  const occupied = new Array<boolean>(text.length).fill(false);

  let lineStart = 0;
  for (let i = 0; i <= text.length; i += 1) {
    if (i < text.length && text[i] !== "\n") continue;
    for (const range of findSlashHighlightRangesInLine(text.slice(lineStart, i), lineStart)) {
      ranges.push(range);
      for (let j = range.start; j < range.end; j += 1) occupied[j] = true;
    }
    lineStart = i + 1;
  }

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch !== "@" && ch !== "＠") continue;
    if (occupied[i]) continue;

    const range = findAtHighlightRange(text, i);
    if (!range) continue;
    ranges.push(range);
    for (let j = range.start; j < range.end; j += 1) occupied[j] = true;
  }

  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  return ranges;
}

type PlainTextDoc = ComposerProseMirrorEditor["state"]["doc"];

function decorationAttrsForKind(kind: ComposerHighlightKind): DecorationAttrs {
  if (kind === "at") {
    return {
      class: "app-composer-token-highlight app-composer-token-highlight--at",
      style: "color: var(--ant-purple-5, #9254de); font-weight: 500;",
    };
  }
  return {
    class: "app-composer-token-highlight app-composer-token-highlight--slash",
    style: "color: var(--ant-cyan-6, #13c2c2); font-weight: 500;",
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

export function ensureComposerTokenHighlightPlugin(editor: unknown): Plugin | null {
  if (!editor || typeof editor !== "object") return null;
  const typed = editor as ComposerEditorWithState;
  if (
    !typed.state?.reconfigure ||
    !typed.view?.updateState ||
    !Array.isArray(typed.state.plugins)
  ) {
    return null;
  }
  const existing = typed.state.plugins.find(
    (plugin) => plugin.spec.key === COMPOSER_TOKEN_HIGHLIGHT_KEY,
  );
  if (existing) return existing;

  const plugin = createComposerTokenHighlightPlugin();
  const nextState = typed.state.reconfigure({
    plugins: [...typed.state.plugins, plugin],
  });
  typed.view.updateState(nextState);
  return plugin;
}

/** @deprecated 使用 ensureComposerTokenHighlightPlugin */
export function attachComposerTokenHighlightPlugin(editor: unknown): Plugin | null {
  return ensureComposerTokenHighlightPlugin(editor);
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
