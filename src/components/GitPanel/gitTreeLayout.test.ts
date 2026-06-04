import { describe, expect, test } from "bun:test";
import {
  GIT_TREE_ARROW_COLUMN_PX,
  GIT_TREE_DEPTH_INDENT_PX,
  gitTreeDirPaddingLeftPx,
  gitTreeFilePaddingLeftPx,
} from "./gitTreeLayout";

describe("gitTreeDirPaddingLeftPx", () => {
  test("scales indent by depth only once per level", () => {
    expect(gitTreeDirPaddingLeftPx(0)).toBe(0);
    expect(gitTreeDirPaddingLeftPx(4)).toBe(4 * GIT_TREE_DEPTH_INDENT_PX);
  });
});

describe("gitTreeFilePaddingLeftPx", () => {
  test("aligns status badge with parent folder icon", () => {
    const parentIconLeft = gitTreeDirPaddingLeftPx(3) + GIT_TREE_ARROW_COLUMN_PX;
    expect(gitTreeFilePaddingLeftPx(4)).toBe(parentIconLeft);
  });

  test("root file aligns with root folder icon column", () => {
    expect(gitTreeFilePaddingLeftPx(0)).toBe(GIT_TREE_ARROW_COLUMN_PX);
    expect(gitTreeFilePaddingLeftPx(1)).toBe(GIT_TREE_ARROW_COLUMN_PX);
  });
});
