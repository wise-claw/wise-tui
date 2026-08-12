import { describe, expect, test } from "bun:test";
import { Schema, type Node } from "prosemirror-model";
import {
  docPositionToPlainOffset,
  plainOffsetToDocPosition,
  tiptapDocPlainText,
} from "./tiptapPlainPosition";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    hard_break: { inline: true, group: "inline", selectable: false },
    heading: { attrs: { level: { default: 1 } }, content: "inline*", group: "block", defining: true },
    bullet_list: { content: "list_item+", group: "block" },
    list_item: { content: "paragraph block*", defining: true },
  },
  marks: {},
});

function docOf(json: Record<string, unknown>): Node {
  return schema.nodeFromJSON(json as never);
}

const PARA = (text: string) => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : [],
});
const LIST = (...items: string[]) => ({
  type: "bullet_list",
  content: items.map((t) => ({ type: "list_item", content: [PARA(t)] })),
});

describe("tiptapDocPlainText", () => {
  test("joins paragraphs with single newline", () => {
    expect(tiptapDocPlainText(docOf({ type: "doc", content: [PARA("a"), PARA("b")] }))).toBe("a\nb");
  });

  test("keeps empty leading block separator semantics", () => {
    expect(tiptapDocPlainText(docOf({ type: "doc", content: [PARA(""), PARA("a")] }))).toBe("\na");
  });

  test("list items flatten to newline separated text", () => {
    expect(tiptapDocPlainText(docOf({ type: "doc", content: [LIST("a", "b")] }))).toBe("a\nb");
  });

  test("hard breaks contribute no plain chars", () => {
    expect(
      tiptapDocPlainText(
        docOf({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "a" }, { type: "hard_break" }, { type: "text", text: "b" }],
            },
          ],
        }),
      ),
    ).toBe("ab");
  });
});

describe("plainOffsetToDocPosition", () => {
  function assertRoundTrip(json: Record<string, unknown>, expectedPlain: string) {
    const doc = docOf(json);
    expect(tiptapDocPlainText(doc)).toBe(expectedPlain);
    for (let offset = 0; offset <= expectedPlain.length; offset += 1) {
      const pos = plainOffsetToDocPosition(doc, offset);
      expect(pos).toBeGreaterThanOrEqual(0);
      expect(pos).toBeLessThanOrEqual(doc.content.size);
      // 映射后的位置再算回 plain 偏移必须不小于目标偏移（落在文本内时严格相等）。
      const back = docPositionToPlainOffset(doc, pos);
      expect(back).toBeGreaterThanOrEqual(offset);
    }
  }

  test("two paragraphs round-trip", () => {
    assertRoundTrip({ type: "doc", content: [PARA("hello"), PARA("world")] }, "hello\nworld");
  });

  test("empty leading paragraph round-trip", () => {
    assertRoundTrip({ type: "doc", content: [PARA(""), PARA("abc")] }, "\nabc");
  });

  test("list items round-trip", () => {
    assertRoundTrip({ type: "doc", content: [LIST("a", "b")] }, "a\nb");
  });

  test("heading + paragraph round-trip", () => {
    assertRoundTrip(
      { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "H" }] }, PARA("p")] },
      "H\np",
    );
  });

  test("text cursor lands exactly inside text node", () => {
    const doc = docOf({ type: "doc", content: [PARA("hello"), PARA("world")] });
    expect(plainOffsetToDocPosition(doc, 0)).toBe(0);
    expect(plainOffsetToDocPosition(doc, 5)).toBe(6);
    expect(plainOffsetToDocPosition(doc, 6)).toBe(8);
    expect(plainOffsetToDocPosition(doc, 7)).toBe(9);
  });

  test("out-of-range offsets clamp to doc end", () => {
    const doc = docOf({ type: "doc", content: [PARA("abc")] });
    expect(plainOffsetToDocPosition(doc, 99)).toBe(doc.content.size);
    expect(plainOffsetToDocPosition(doc, -1)).toBe(0);
  });
});
