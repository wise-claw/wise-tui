import { describe, expect, test } from "bun:test";
import {
  REPOSITORY_TREE_CHEVRON_COLUMN_PX,
  REPOSITORY_TREE_DEPTH_INDENT_PX,
  repositoryTreeDepthIndentPx,
  repositoryTreeFileDepthIndentPx,
} from "./repositoryTreeLayout";

describe("repositoryTreeDepthIndentPx", () => {
  test("scales indent by depth", () => {
    expect(repositoryTreeDepthIndentPx(0)).toBe(0);
    expect(repositoryTreeDepthIndentPx(2)).toBe(2 * REPOSITORY_TREE_DEPTH_INDENT_PX);
  });

  test("clamps negative depth to zero", () => {
    expect(repositoryTreeDepthIndentPx(-1)).toBe(0);
  });
});

describe("repositoryTreeFileDepthIndentPx", () => {
  test("aligns file icon with parent folder icon column", () => {
    const parentFolderIconLeft =
      repositoryTreeDepthIndentPx(1) + REPOSITORY_TREE_CHEVRON_COLUMN_PX;
    expect(repositoryTreeFileDepthIndentPx(2)).toBe(parentFolderIconLeft);
  });

  test("root file aligns with root folder icon column", () => {
    expect(repositoryTreeFileDepthIndentPx(0)).toBe(REPOSITORY_TREE_CHEVRON_COLUMN_PX);
    expect(repositoryTreeFileDepthIndentPx(1)).toBe(REPOSITORY_TREE_CHEVRON_COLUMN_PX);
  });
});
