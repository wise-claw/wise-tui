import { describe, expect, test } from "bun:test";
import {
  IN_MEMORY_COMPANION_SESSION_MESSAGES_MAX,
  IN_MEMORY_GLOBAL_MESSAGES_BUDGET,
} from "../constants/claudeMessageListWindow";
import {
  resolveCompanionSessionMessagesMax,
  resolveGlobalMessagesBudget,
  shouldLazyMountMultiPaneExtraCells,
} from "./multiPanePerformance";

describe("multiPanePerformance", () => {
  test("lazy mount only when pane count exceeds 2", () => {
    expect(shouldLazyMountMultiPaneExtraCells(1)).toBe(false);
    expect(shouldLazyMountMultiPaneExtraCells(2)).toBe(false);
    expect(shouldLazyMountMultiPaneExtraCells(4)).toBe(true);
    expect(shouldLazyMountMultiPaneExtraCells(8)).toBe(true);
  });

  test("companion per-session cap shrinks as pane count grows", () => {
    expect(resolveCompanionSessionMessagesMax(1)).toBe(IN_MEMORY_COMPANION_SESSION_MESSAGES_MAX);
    const forSeven = resolveCompanionSessionMessagesMax(7);
    expect(forSeven).toBeLessThan(IN_MEMORY_COMPANION_SESSION_MESSAGES_MAX);
    expect(forSeven).toBeGreaterThanOrEqual(8);
  });

  test("global budget scales with companion count but stays capped", () => {
    expect(resolveGlobalMessagesBudget(0)).toBe(IN_MEMORY_GLOBAL_MESSAGES_BUDGET);
    expect(resolveGlobalMessagesBudget(7)).toBeGreaterThan(IN_MEMORY_GLOBAL_MESSAGES_BUDGET);
    expect(resolveGlobalMessagesBudget(30)).toBe(384);
  });
});
