import { describe, expect, test } from "bun:test";
import { extractComposerAttachmentPathsFromText } from "./readComposerImage";

describe("extractComposerAttachmentPathsFromText", () => {
  test("parses 附图 @ absolute paths from user bubble text", () => {
    const text =
      "你好\n\n附图：@/Users/sjl/.wise/composer-images/wise/281aed2b-e313-48aa-874c-0484ceaaf5c3-image.png";
    expect(extractComposerAttachmentPathsFromText(text)).toEqual([
      "/Users/sjl/.wise/composer-images/wise/281aed2b-e313-48aa-874c-0484ceaaf5c3-image.png",
    ]);
  });
});
