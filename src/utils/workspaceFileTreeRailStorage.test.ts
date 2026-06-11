import { describe, expect, test } from "bun:test";
import {
  clampWorkspaceFileTreeRailWidthPx,
  readWorkspaceFileTreeRailWidthFromStorage,
  WORKSPACE_FILE_TREE_RAIL_DEFAULT_WIDTH_PX,
  WORKSPACE_FILE_TREE_RAIL_MAX_WIDTH_PX,
  WORKSPACE_FILE_TREE_RAIL_MIN_WIDTH_PX,
} from "./workspaceFileTreeRailStorage";

describe("workspaceFileTreeRailStorage", () => {
  test("clamps width into configured bounds", () => {
    expect(clampWorkspaceFileTreeRailWidthPx(50)).toBe(
      WORKSPACE_FILE_TREE_RAIL_MIN_WIDTH_PX,
    );
    expect(clampWorkspaceFileTreeRailWidthPx(999)).toBe(
      WORKSPACE_FILE_TREE_RAIL_MAX_WIDTH_PX,
    );
    expect(clampWorkspaceFileTreeRailWidthPx(240.6)).toBe(241);
  });

  test("falls back to default width when storage is unavailable", () => {
    expect(readWorkspaceFileTreeRailWidthFromStorage()).toBe(
      WORKSPACE_FILE_TREE_RAIL_DEFAULT_WIDTH_PX,
    );
  });
});
