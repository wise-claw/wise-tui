import { describe, expect, test, beforeEach } from "bun:test";
import {
  buildFeedbackLoopSystemPromptBlock,
  collectFeedbackLoopHabitsForRepository,
  dedupeFeedbackLoopHabits,
  mergeAppendSystemPromptParts,
} from "./sessionFeedbackLoopSystemPrompt";
import { archiveFeedbackLoopHistory } from "./sessionFeedbackLoopHistoryStore";
import { saveSessionFeedbackLoopState } from "./sessionFeedbackLoopStore";
import { createInitialFeedbackLoopState } from "../utils/sessionFeedbackLoop";

function mockStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

describe("sessionFeedbackLoopSystemPrompt", () => {
  beforeEach(() => {
    const local = mockStorage();
    const session = mockStorage();
    Object.defineProperty(globalThis, "localStorage", { value: local, configurable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: session, configurable: true });
  });

  test("mergeAppendSystemPromptParts joins non-empty parts", () => {
    expect(mergeAppendSystemPromptParts("A", "", "  ", "B")).toBe("A\n\nB");
    expect(mergeAppendSystemPromptParts(undefined, null)).toBeUndefined();
  });

  test("dedupeFeedbackLoopHabits preserves order and caps count", () => {
    expect(
      dedupeFeedbackLoopHabits(["a", " a ", "b", "a", "c", "d", "e", "f", "g"], 6),
    ).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  test("buildFeedbackLoopSystemPromptBlock includes guidance footer", () => {
    const block = buildFeedbackLoopSystemPromptBlock(["先定位再 Read"]);
    expect(block).toContain("【反馈神经网 · 工具使用习惯】");
    expect(block).toContain("1. 先定位再 Read");
    expect(block).toContain("以任务目标为准");
  });

  test("collectFeedbackLoopHabitsForRepository merges session and history", () => {
    const state = createInitialFeedbackLoopState("tab-1");
    state.cycles.push({
      cycleIndex: 1,
      startedAt: Date.now(),
      baselineTurnCount: 0,
      optimizationPromptSentAt: Date.now(),
      comparison: {
        improved: true,
        overallScore: 5,
        speedScore: 4,
        efficiencyScore: 3,
        qualityScore: 2,
        summary: "ok",
        deltas: [{ label: "工具/轮", improved: true, before: 2, after: 1, delta: -1 }],
      },
    });
    saveSessionFeedbackLoopState(state);

    archiveFeedbackLoopHistory({
      state: createInitialFeedbackLoopState("other"),
      repositoryPath: "/repo/a",
      repositoryName: "a",
    });

    const habits = collectFeedbackLoopHabitsForRepository({
      repositoryPath: "/repo/a",
      sessionId: "tab-1",
    });
    expect(habits.length).toBeGreaterThan(0);
    expect(habits.some((h) => h.includes("Read") || h.includes("探索"))).toBe(true);
  });
});
