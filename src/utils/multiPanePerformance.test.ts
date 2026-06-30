import { describe, expect, test } from "bun:test";
import {
  IN_MEMORY_COMPANION_SESSION_MESSAGES_MAX,
  IN_MEMORY_GLOBAL_MESSAGES_BUDGET,
} from "../constants/claudeMessageListWindow";
import {
  resolveCompanionDiskLoadStaggerMs,
  resolveCompanionDiskTranscriptTailLines,
  resolveCompanionMessageListWindow,
  resolveCompanionPaneRenderDecision,
  resolveCompanionSessionMessagesMax,
  resolveGlobalMessagesBudget,
  shouldLazyMountMultiPaneExtraCells,
  shouldUseOffscreenRunningShell,
  type CompanionPaneRenderInput,
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

describe("resolveCompanionPaneRenderDecision", () => {
  const base: CompanionPaneRenderInput = {
    paneCount: 4,
    hasSession: true,
    isRunning: true,
    isActivePane: false,
    inView: true,
    mounted: true,
    hasQuestionRequest: false,
  };

  test("REGRESSION: visible running companion in 3+ panes keeps full chat (message list + composer)", () => {
    // 这是用户报告的 bug：3+ 屏在屏窗格发消息后看不到消息列表与输入框。
    const decision = resolveCompanionPaneRenderDecision(base);
    expect(decision.useOffscreenRunningShell).toBe(false);
    expect(decision.deferHeavySubtree).toBe(false);
  });

  test("REGRESSION: visible running companion with pending question keeps full chat (so question is answerable)", () => {
    const decision = resolveCompanionPaneRenderDecision({ ...base, hasQuestionRequest: true });
    expect(decision.useOffscreenRunningShell).toBe(false);
    expect(decision.deferHeavySubtree).toBe(false);
  });

  test("offscreen running companion in 3+ panes downgrades to lightweight shell", () => {
    const decision = resolveCompanionPaneRenderDecision({ ...base, inView: false });
    expect(decision.useOffscreenRunningShell).toBe(true);
    expect(decision.deferHeavySubtree).toBe(true);
  });

  test("offscreen running companion with pending question bypasses shell but still defers heavy subtree", () => {
    const decision = resolveCompanionPaneRenderDecision({
      ...base,
      inView: false,
      hasQuestionRequest: true,
    });
    expect(decision.useOffscreenRunningShell).toBe(false);
    expect(decision.deferHeavySubtree).toBe(true);
  });

  test("two-pane mode never downgrades (lazy disabled)", () => {
    const decision = resolveCompanionPaneRenderDecision({ ...base, paneCount: 2, inView: false });
    expect(decision.useOffscreenRunningShell).toBe(false);
    expect(decision.deferHeavySubtree).toBe(false);
  });

  test("idle companion never uses the running shell", () => {
    const decision = resolveCompanionPaneRenderDecision({ ...base, inView: false, isRunning: false });
    expect(decision.useOffscreenRunningShell).toBe(false);
    expect(decision.deferHeavySubtree).toBe(false);
  });

  test("active companion pane is never downgraded even when offscreen", () => {
    const decision = resolveCompanionPaneRenderDecision({ ...base, inView: false, isActivePane: true });
    expect(decision.useOffscreenRunningShell).toBe(false);
  });

  test("unmounted offscreen running companion does not defer (nothing mounted yet)", () => {
    const decision = resolveCompanionPaneRenderDecision({ ...base, inView: false, mounted: false });
    expect(decision.useOffscreenRunningShell).toBe(true);
    expect(decision.deferHeavySubtree).toBe(false);
  });
});
