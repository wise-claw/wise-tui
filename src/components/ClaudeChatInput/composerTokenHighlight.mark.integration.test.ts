import { describe, expect, test } from "bun:test";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import {
  createComposerHighlightMarkSyncPlugin,
  docToHighlightPlain,
  syncComposerHighlightMarksOnEditor,
} from "./composerTokenHighlight";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { group: "inline" },
  },
  marks: {
    wiseComposerAtHighlight: {
      parseDOM: [{ tag: "span.app-composer-token-highlight--at" }],
      toDOM: () => [
        "span",
        { class: "app-composer-token-highlight app-composer-token-highlight--at" },
        0,
      ],
    },
    wiseComposerSlashHighlight: {
      parseDOM: [{ tag: "span.app-composer-token-highlight--slash" }],
      toDOM: () => [
        "span",
        { class: "app-composer-token-highlight app-composer-token-highlight--slash" },
        0,
      ],
    },
  },
});

function docFromPlain(plain: string) {
  return schema.node("doc", null, [
    schema.node("paragraph", null, plain ? [schema.text(plain)] : []),
  ]);
}

function applyWithHighlightSync(state: EditorState, tr: EditorState["tr"]) {
  const plugin = createComposerHighlightMarkSyncPlugin();
  const next = state.apply(tr);
  const appended = plugin.spec.appendTransaction?.([tr], state, next);
  return appended ? next.apply(appended) : next;
}

function docHasAtHighlightMark(state: EditorState): boolean {
  const atType = schema.marks.wiseComposerAtHighlight;
  let found = false;
  state.doc.descendants((node) => {
    if (!node.isText) return;
    if (node.marks.some((mark) => mark.type === atType)) {
      found = true;
      return false;
    }
    return undefined;
  });
  return found;
}

describe("composer highlight mark sync", () => {
  test("applies @ mark and keeps it after inserting trailing body text", () => {
    let state = EditorState.create({
      doc: docFromPlain("@终端01"),
      plugins: [createComposerHighlightMarkSyncPlugin()],
    });
    const bootstrapTr = state.tr.insertText(" ", state.doc.content.size - 1);
    state = applyWithHighlightSync(state, bootstrapTr);
    expect(docHasAtHighlightMark(state)).toBe(true);

    const insertPos = state.doc.content.size - 1;
    state = applyWithHighlightSync(state, state.tr.insertText("你好", insertPos));

    expect(docToHighlightPlain(state.doc)).toBe("@终端01 你好");
    expect(docHasAtHighlightMark(state)).toBe(true);
  });

  test("syncComposerHighlightMarksOnEditor repairs marks after plain setContent", () => {
    let state = EditorState.create({
      doc: docFromPlain("@终端01 你好"),
      plugins: [createComposerHighlightMarkSyncPlugin()],
    });
    expect(docHasAtHighlightMark(state)).toBe(false);

    const editor = {
      get state() {
        return state;
      },
      view: {
        get state() {
          return state;
        },
        dispatch(tr: ReturnType<EditorState["tr"]["setMeta"]>) {
          state = state.apply(tr);
        },
      },
    };
    syncComposerHighlightMarksOnEditor(editor);
    expect(docHasAtHighlightMark(state)).toBe(true);
  });
});
