import { describe, expect, test } from "bun:test";
import {
  IN_MEMORY_COMPANION_SESSION_MESSAGES_MAX,
  IN_MEMORY_GLOBAL_MESSAGES_BUDGET,
} from "../constants/claudeMessageListWindow";
import {
  resolveCompanionDiskLoadStaggerMs,
  resolveCompanionDiskTranscriptTailLines,
  resolveCompanionMessageListWindow,
  resolveCompanionSessionMessagesMax,
  resolveGlobalMessagesBudget,
  shouldLazyMountMultiPaneExtraCells,
  shouldUseOffscreenRunningShell,
} from "./multiPanePerformance";

describe("multiPanePerformance", () => {
  test("lazy mount only when pane count exceeds 2", () => {
    expect(shouldLazyMountMultiPaneExtraCells(1)).toBe(false);
    expect(shouldLazyMountMultiPaneExtraCells(2)).toBe(false);
    expect(shouldLazyMountMultiPaneExtraCells(4)).toBe(true);
    expect(shouldLazyMountMultiPaneExtraCells(8)).toBe(true);
  });

  test("offscreen running shell only when pane count exceeds 2", () => {
    expect(shouldUseOffscreenRunningShell(2)).toBe(false);
    expect(shouldUseOffscreenRunningShell(4)).toBe(true);
    expect(shouldUseOffscreenRunningShell(8)).toBe(true);
  });

  test("companion per-session cap shrinks as pane count grows", () => {
    expect(resolveCompanionSessionMessagesMax(1)).toBe(IN_MEMORY_COMPANION_SESSION_MESSAGES_MAX);
    const forSeven = resolveCompanionSessionMessagesMax(7);
    expect(forSeven).toBeLessThan(IN_MEMORY_COMPANION_SESSION_MESSAGES_MAX);
    expect(forSeven).toBeGreaterThanOrEqual(6);
  });

  test("global budget scales with companion count but stays capped", () => {
    expect(resolveGlobalMessagesBudget(0)).toBe(IN_MEMORY_GLOBAL_MESSAGES_BUDGET);
    expect(resolveGlobalMessagesBudget(7)).toBeGreaterThan(IN_MEMORY_GLOBAL_MESSAGES_BUDGET);
    expect(resolveGlobalMessagesBudget(30)).toBe(256);
  });

  test("companion disk tail lines shrink with more companions", () => {
    const solo = resolveCompanionDiskTranscriptTailLines(1);
    const many = resolveCompanionDiskTranscriptTailLines(7);
    expect(many).toBeLessThan(solo);
    expect(many).toBeGreaterThanOrEqual(72);
  });

  test("companion message list window shrinks for 6/8 panes", () => {
    const four = resolveCompanionMessageListWindow(4);
    const six = resolveCompanionMessageListWindow(6);
    const eight = resolveCompanionMessageListWindow(8);
    expect(six.initialVisible).toBeLessThan(four.initialVisible);
    expect(eight.initialVisible).toBeLessThanOrEqual(six.initialVisible);
  });

  test("companion disk load is staggered by index", () => {
    expect(resolveCompanionDiskLoadStaggerMs(0)).toBeLessThan(resolveCompanionDiskLoadStaggerMs(3));
  });
});
