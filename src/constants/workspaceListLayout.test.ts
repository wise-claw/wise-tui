import { describe, expect, test } from "bun:test";
import {
  clampWorkspaceListVisibleRows,
  formatWorkspaceListVisibleRowsLabel,
  isWorkspaceListVisibleRowsUnlimited,
  normalizeWorkspaceListVisibleRows,
  workspaceListContentMaxHeightPx,
  WORKSPACE_LIST_VISIBLE_ROWS_DEFAULT,
  WORKSPACE_LIST_VISIBLE_ROWS_UNLIMITED,
} from "./workspaceListLayout";

describe("workspaceListLayout", () => {
  test("normalizeWorkspaceListVisibleRows clamps out-of-range values", () => {
    expect(normalizeWorkspaceListVisibleRows(99)).toBe(12);
    expect(normalizeWorkspaceListVisibleRows(1)).toBe(2);
    expect(normalizeWorkspaceListVisibleRows("6")).toBe(6);
    expect(normalizeWorkspaceListVisibleRows(undefined)).toBe(WORKSPACE_LIST_VISIBLE_ROWS_DEFAULT);
  });

  test("normalizeWorkspaceListVisibleRows accepts unlimited sentinel", () => {
    expect(normalizeWorkspaceListVisibleRows(0)).toBe(WORKSPACE_LIST_VISIBLE_ROWS_UNLIMITED);
    expect(normalizeWorkspaceListVisibleRows("0")).toBe(WORKSPACE_LIST_VISIBLE_ROWS_UNLIMITED);
    expect(isWorkspaceListVisibleRowsUnlimited(0)).toBe(true);
    expect(formatWorkspaceListVisibleRowsLabel(0)).toBe("不限");
  });

  test("workspaceListContentMaxHeightPx scales by row height", () => {
    expect(workspaceListContentMaxHeightPx(5)).toBe(28 * 5);
    expect(workspaceListContentMaxHeightPx(0)).toBeNull();
    expect(clampWorkspaceListVisibleRows(5)).toBe(5);
    expect(clampWorkspaceListVisibleRows(0)).toBe(0);
  });
});
