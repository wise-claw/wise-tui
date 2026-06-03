import { describe, expect, test } from "bun:test";
import { REPOSITORY_TREE_DEPTH_INDENT_PX, repositoryTreeDepthIndentPx } from "./repositoryTreeLayout";

describe("repositoryTreeDepthIndentPx", () => {
  test("scales indent by depth", () => {
    expect(repositoryTreeDepthIndentPx(0)).toBe(0);
    expect(repositoryTreeDepthIndentPx(2)).toBe(2 * REPOSITORY_TREE_DEPTH_INDENT_PX);
  });

  test("clamps negative depth to zero", () => {
    expect(repositoryTreeDepthIndentPx(-1)).toBe(0);
  });
});
