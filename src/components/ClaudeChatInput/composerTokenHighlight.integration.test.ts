import { describe, expect, test } from "bun:test";
import { Schema } from "@tiptap/pm/model";
import {
  buildComposerTokenDecorationSet,
  findComposerHighlightRanges,
} from "./composerTokenHighlight";

const paragraphDocSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { group: "inline" },
  },
});

function docFromPlain(plain: string) {
  return paragraphDocSchema.node("doc", null, [
    paragraphDocSchema.node("paragraph", null, [paragraphDocSchema.text(plain)]),
  ]);
}

describe("buildComposerTokenDecorationSet", () => {
  test("maps CJK @ mention to inline decoration spans after trailing body text", () => {
    const plain = "@终端01 你好";
    expect(findComposerHighlightRanges(plain)).toEqual([{ start: 0, end: 5, kind: "at" }]);

    const doc = docFromPlain(plain);
    const decos = buildComposerTokenDecorationSet(doc).find(0, doc.content.size);
    expect(decos.length).toBe(1);
    expect(decos[0]!.from).toBeLessThan(decos[0]!.to);
  });

  test("still decorates @ mention when body text is adjacent without space", () => {
    const plain = "@终端01你好";
    const doc = docFromPlain(plain);
    const decos = buildComposerTokenDecorationSet(doc).find(0, doc.content.size);
    expect(decos.length).toBe(1);
  });
});
