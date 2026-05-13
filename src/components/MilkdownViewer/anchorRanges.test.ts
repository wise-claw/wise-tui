import { describe, expect, test } from "bun:test";
import { Schema, type Node as PMNode } from "@milkdown/kit/prose/model";
import { expandNeedleCandidates, normalizeAnchorProbeText, textblockHayIncludesNeedle } from "./anchorText";
import {
  buildSelectedAnchorDraft,
  findBestAnchorRange,
  findRequirementHighlightRange,
  findTextblockStartForNeedle,
  rangeLooksLikeAnchorMatch,
  resolveDocRangeFromVisibleOffsets,
} from "./anchorRanges";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    code_block: { content: "text*", group: "block", code: true },
    text: { group: "inline" },
  },
});

function docFromBlocks(blocks: Array<string | { code: string }>): PMNode {
  return schema.node("doc", null, blocks.map((block) => {
    if (typeof block === "string") {
      return schema.node("paragraph", null, block ? schema.text(block) : undefined);
    }
    return schema.node("code_block", null, block.code ? schema.text(block.code) : undefined);
  }));
}

describe("anchor text helpers", () => {
  test("normalizes Markdown syntax into comparable prose", () => {
    expect(normalizeAnchorProbeText("## Title\n- **Ship** [docs](https://x.test)")).toBe("Title Ship docs");
  });

  test("adds line-level candidates for multi-line requirements", () => {
    expect(expandNeedleCandidates("first line\nsecond line")).toContain("second line");
  });

  test("matches textblocks after stripping visible list glyphs", () => {
    expect(textblockHayIncludesNeedle("- Implement anchors", "Implement anchors")).toBe(true);
    expect(textblockHayIncludesNeedle("12. Implement anchors", "Implement anchors")).toBe(true);
  });
});

describe("anchor range helpers", () => {
  test("finds a highlight range inside a matching textblock and ignores code blocks", () => {
    const doc = docFromBlocks([
      { code: "Implement anchors" },
      "Intro text",
      "- Implement anchors in the editor",
    ]);
    const range = findRequirementHighlightRange(doc, "Implement anchors");
    expect(range).not.toBeNull();
    expect(doc.textBetween(range!.from, range!.to, " ", " ")).toBe("Implement anchors");
  });

  test("resolves textblock start for matching prose", () => {
    const doc = docFromBlocks(["First", "Second anchor"]);
    const pos = findTextblockStartForNeedle(doc, "Second anchor");
    expect(pos).toBe(7);
  });

  test("pairs contextBefore and contextAfter into a semantic span", () => {
    const doc = docFromBlocks(["Prelude before context middle body after context trailer"]);
    const descriptor = {
      from: 1,
      to: 10,
      textHash: "hash",
      contextBefore: "before context",
      contextAfter: "after context",
    };
    const range = findBestAnchorRange(doc, descriptor, "middle body");
    expect(range).not.toBeNull();
    expect(doc.textBetween(range!.from, range!.to, " ", " ")).toBe("before context middle body after context");
  });

  test("maps visible offsets back to ProseMirror document positions", () => {
    const doc = docFromBlocks(["Alpha", "Beta"]);
    const range = resolveDocRangeFromVisibleOffsets(doc, 5, 9);
    expect(range).toEqual({ from: 8, to: 12 });
    expect(doc.textBetween(range!.from, range!.to, " ", " ")).toBe("Beta");
  });

  test("validates cached ranges against normalized anchor text", () => {
    const doc = docFromBlocks(["Ship editor anchors"]);
    expect(rangeLooksLikeAnchorMatch(doc, { from: 1, to: 20 }, "Ship editor anchors")).toBe(true);
    expect(rangeLooksLikeAnchorMatch(doc, { from: 1, to: 5 }, "unrelated")).toBe(false);
  });

  test("builds selection anchor draft with surrounding context", () => {
    const doc = docFromBlocks(["Before selected text after"]);
    const draft = buildSelectedAnchorDraft(doc, 8, 21);
    expect(draft).toEqual({
      from: 8,
      to: 21,
      text: "selected text",
      contextBefore: "Before",
      contextAfter: "after",
    });
  });
});
