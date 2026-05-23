import { describe, expect, test } from "bun:test";
import {
  DEFAULT_LEFT_SIDEBAR_HUB_QUICK_ENTRIES,
  normalizeLeftSidebarHubQuickEntries,
} from "./leftSidebarHubQuickEntries";

describe("normalizeLeftSidebarHubQuickEntries", () => {
  test("defaults to mcp, skills, automation", () => {
    expect(normalizeLeftSidebarHubQuickEntries(undefined)).toEqual([
      ...DEFAULT_LEFT_SIDEBAR_HUB_QUICK_ENTRIES,
    ]);
  });

  test("filters unknown ids and preserves canonical order", () => {
    expect(
      normalizeLeftSidebarHubQuickEntries(["claude-plugins", "invalid", "mcp", "skills", "mcp"]),
    ).toEqual(["mcp", "skills", "claude-plugins"]);
  });
});
