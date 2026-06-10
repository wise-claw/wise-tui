import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import type { MarkType, Node, Schema } from "@tiptap/pm/model";
import { Decoration, DecorationSet, type DecorationAttrs } from "@tiptap/pm/view";
import type { ComposerProseMirrorEditor } from "./composer-trigger-anchor";
import { normalizeComposerEditorPlain } from "./composer-plain-utils";

export type ComposerHighlightKind = "at" | "slash";

export interface ComposerHighlightRange {
  start: number;
  end: number;
  kind: ComposerHighlightKind;
}

const COMPOSER_TOKEN_HIGHLIGHT_KEY = new PluginKey<DecorationSet>("wise-composer-token-highlight");
export const COMPOSER_HIGHLIGHT_SYNC_META = "wise-composer-highlight-sync";
const COMPOSER_HIGHLIGHT_MARK_SYNC_KEY = new PluginKey("wise-composer-highlight-mark-sync");

/** @ 指派后续英文词（如 Claude Code）；不含 CJK，避免把正文「你好」吞进提及。 */
const AT_MENTION_CONTINUATION_WORD = /[A-Za-z0-9._-]/;

function normalizeComposerPlain(plain: string): string {
  return normalizeComposerEditorPlain(plain);
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

function highlightPlainOffsetToDocPos(doc: PlainTextDoc, plainOffset: number): number {
  const target = Math.max(0, Math.floor(plainOffset));
  const size = doc.content.size;
  let lo = 0;
  let hi = size;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const normalizedLen = normalizeComposerPlain(doc.textBetween(0, mid, "\n")).length;
    if (normalizedLen > target) hi = mid - 1;
    else lo = mid;
  }
  return lo;
}

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
  const plain = docToHighlightPlain(doc);
  if (!plain) return DecorationSet.empty;

  const decos: Decoration[] = [];

  for (const range of findComposerHighlightRanges(plain)) {
    const from = highlightPlainOffsetToDocPos(doc, range.start);
    const to = highlightPlainOffsetToDocPos(doc, range.end);
    if (to <= from) continue;
    decos.push(Decoration.inline(from, to, decorationAttrsForKind(range.kind)));
  }

  return decos.length > 0 ? DecorationSet.create(doc as Node, decos) : DecorationSet.empty;
}

export function docToHighlightPlain(doc: PlainTextDoc): string {
  return normalizeComposerPlain(doc.textBetween(0, doc.content.size, "\n"));
}

function readHighlightMarkTypes(schema: Schema): {
  at: MarkType | null;
  slash: MarkType | null;
} {
  return {
    at: schema.marks.wiseComposerAtHighlight ?? null,
    slash: schema.marks.wiseComposerSlashHighlight ?? null,
  };
}

function docHasAnyHighlightMark(
  doc: Node,
  atType: MarkType,
  slashType: MarkType,
): boolean {
  let found = false;
  doc.descendants((node) => {
    if (!node.isText) return;
    if (node.marks.some((mark) => mark.type === atType || mark.type === slashType)) {
      found = true;
      return false;
    }
    return undefined;
  });
  return found;
}

function rangeHasExpectedMark(
  doc: Node,
  range: ComposerHighlightRange,
  atType: MarkType,
  slashType: MarkType,
): boolean {
  const expected = range.kind === "at" ? atType : slashType;
  const from = highlightPlainOffsetToDocPos(doc, range.start);
  const to = highlightPlainOffsetToDocPos(doc, range.end);
  if (to <= from) return false;

  let ok = true;
  doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    if (!node.marks.some((mark) => mark.type === expected)) {
      ok = false;
      return false;
    }
    return undefined;
  });
  return ok;
}

function composerHighlightMarksInSync(
  doc: Node,
  schema: Schema,
): boolean {
  const { at: atType, slash: slashType } = readHighlightMarkTypes(schema);
  if (!atType || !slashType) return true;

  const plain = docToHighlightPlain(doc);
  if (!plain.includes("@") && !plain.includes("＠") && !plain.includes("/")) {
    return !docHasAnyHighlightMark(doc, atType, slashType);
  }

  const desired = findComposerHighlightRanges(plain);
  if (desired.length === 0) {
    return !docHasAnyHighlightMark(doc, atType, slashType);
  }

  return desired.every((range) => rangeHasExpectedMark(doc, range, atType, slashType));
}

function buildComposerHighlightMarkSyncTransaction(
  state: EditorState,
): import("@tiptap/pm/state").Transaction | null {
  const { doc, schema } = state;
  const { at: atType, slash: slashType } = readHighlightMarkTypes(schema);
  if (!atType || !slashType) return null;
  if (composerHighlightMarksInSync(doc, schema)) return null;

  const plain = docToHighlightPlain(doc);
  const desired = findComposerHighlightRanges(plain);

  const markOps: Array<{ from: number; to: number; mark: ReturnType<MarkType["create"]> }> = [];
  for (const range of desired) {
    const from = highlightPlainOffsetToDocPos(doc, range.start);
    const to = highlightPlainOffsetToDocPos(doc, range.end);
    if (to <= from) continue;
    markOps.push({
      from,
      to,
      mark: range.kind === "at" ? atType.create() : slashType.create(),
    });
  }

  if (markOps.length === 0) {
    if (desired.length === 0 && docHasAnyHighlightMark(doc, atType, slashType)) {
      let tr = state.tr;
      tr.removeMark(0, doc.content.size, atType);
      tr.removeMark(0, doc.content.size, slashType);
      if (!tr.steps.length) return null;
      tr.setMeta(COMPOSER_HIGHLIGHT_SYNC_META, true);
      tr.setMeta("addToHistory", false);
      return tr;
    }
    return null;
  }

  let tr = state.tr;
  tr.removeMark(0, doc.content.size, atType);
  tr.removeMark(0, doc.content.size, slashType);

  for (const op of markOps) {
    tr.addMark(op.from, op.to, op.mark);
  }

  if (!tr.steps.length) return null;

  tr.setMeta(COMPOSER_HIGHLIGHT_SYNC_META, true);
  tr.setMeta("addToHistory", false);
  return tr;
}

/** 主动把 @ / 指令 mark 写回编辑器（setContent 跳过后、Semi 零宽字符整理后仍需调用）。 */
export function syncComposerHighlightMarksOnEditor(editor: unknown): void {
  if (!editor || typeof editor !== "object") return;
  const typed = editor as {
    state?: ComposerProseMirrorEditor["state"];
    view?: {
      dispatch: (tr: import("@tiptap/pm/state").Transaction) => void;
      state?: ComposerProseMirrorEditor["state"];
    };
    dispatch?: (tr: import("@tiptap/pm/state").Transaction) => void;
  };

  const state = (typed.view?.state ?? typed.state) as EditorState | undefined;
  const dispatch = typed.view?.dispatch ?? typed.dispatch;
  if (!state || !dispatch) return;

  const tr = buildComposerHighlightMarkSyncTransaction(state);
  if (!tr) return;
  dispatch(tr);
}

/** 在 doc 变更后把 @ / 指令范围写成 ProseMirror mark（DOM 内真实 span，输入后续字不会丢）。 */
export function createComposerHighlightMarkSyncPlugin(): Plugin {
  return new Plugin({
    key: COMPOSER_HIGHLIGHT_MARK_SYNC_KEY,
    appendTransaction(transactions, _oldState, newState) {
      if (transactions.some((tr) => tr.getMeta(COMPOSER_HIGHLIGHT_SYNC_META))) return null;

      const docChanged = transactions.some((tr) => tr.docChanged);
      const { at: atType, slash: slashType } = readHighlightMarkTypes(newState.schema);
      const marksMissing =
        Boolean(atType && slashType) && !composerHighlightMarksInSync(newState.doc, newState.schema);

      if (!docChanged && !marksMissing) return null;

      return buildComposerHighlightMarkSyncTransaction(newState);
    },
  });
}

/** @deprecated Decoration 路径在 Semi 输入下不可靠；保留供测试。 */
export function createComposerTokenHighlightPlugin(): Plugin {
  return new Plugin({
    key: COMPOSER_TOKEN_HIGHLIGHT_KEY,
    props: {
      /** 每次绘制直接从 doc 计算，避免 plugin state 与 Semi appendTransaction 不同步导致 span 消失。 */
      decorations(state) {
        return buildComposerTokenDecorationSet(state.doc);
      },
    },
  });
}

type ComposerEditorWithState = {
  state: {
    plugins: readonly Plugin[];
    reconfigure: (config: { plugins: readonly Plugin[] }) => unknown;
    tr: unknown;
  };
  view: {
    updateState: (state: unknown) => void;
    dispatch: (tr: unknown) => void;
  };
};

/** 强制 ProseMirror 重绘装饰（勿 reconfigure，以免破坏 Tiptap 扩展链）。 */
export function refreshComposerTokenHighlights(editor: unknown): void {
  if (!editor || typeof editor !== "object") return;
  const typed = editor as {
    view?: { dispatch: (tr: unknown) => void; state: { tr: unknown } };
  };
  if (!typed.view?.dispatch || !typed.view.state?.tr) return;
  try {
    typed.view.dispatch(typed.view.state.tr);
  } catch {
    /* ignore dispatch errors */
  }
}

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
