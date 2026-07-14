import { describe, expect, test } from "bun:test";
import {
  clampWorkspaceListVisibleRows,
  normalizeWorkspaceListVisibleRows,
  workspaceListContentMaxHeightPx,
  WORKSPACE_LIST_VISIBLE_ROWS_DEFAULT,
} from "./workspaceListLayout";

describe("workspaceListLayout", () => {
  test("normalizeWorkspaceListVisibleRows clamps out-of-range values", () => {
    expect(normalizeWorkspaceListVisibleRows(99)).toBe(12);
    expect(normalizeWorkspaceListVisibleRows(1)).toBe(3);
    expect(normalizeWorkspaceListVisibleRows("6")).toBe(6);
    expect(normalizeWorkspaceListVisibleRows(undefined)).toBe(WORKSPACE_LIST_VISIBLE_ROWS_DEFAULT);
  });

  test("workspaceListContentMaxHeightPx scales by row height", () => {
    expect(workspaceListContentMaxHeightPx(5)).toBe(24 * 5);
    expect(clampWorkspaceListVisibleRows(5)).toBe(5);
  });
});
