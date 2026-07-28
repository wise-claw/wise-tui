import { describe, expect, test } from "bun:test";
import {
  clampWorkspaceSidebarRowPreviewLimit,
  normalizeWorkspaceSidebarRowPreviewLimit,
  WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT_DEFAULT,
} from "./workspaceSidebarLayout";

describe("workspaceSidebarLayout", () => {
  test("normalizeWorkspaceSidebarRowPreviewLimit clamps out-of-range values", () => {
    expect(normalizeWorkspaceSidebarRowPreviewLimit(99)).toBe(10);
    expect(normalizeWorkspaceSidebarRowPreviewLimit(1)).toBe(2);
    expect(normalizeWorkspaceSidebarRowPreviewLimit("8")).toBe(8);
    expect(normalizeWorkspaceSidebarRowPreviewLimit(undefined)).toBe(
      WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT_DEFAULT,
    );
  });

  test("clampWorkspaceSidebarRowPreviewLimit floors and bounds", () => {
    expect(clampWorkspaceSidebarRowPreviewLimit(5.9)).toBe(5);
    expect(clampWorkspaceSidebarRowPreviewLimit(2)).toBe(2);
    expect(clampWorkspaceSidebarRowPreviewLimit(10)).toBe(10);
  });
});
