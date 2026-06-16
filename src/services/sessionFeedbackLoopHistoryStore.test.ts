import { beforeEach, describe, expect, test } from "bun:test";
import {
  archiveFeedbackLoopHistory,
  compareWithHistoryAverage,
  listFeedbackLoopHistory,
} from "./sessionFeedbackLoopHistoryStore";
import { createInitialFeedbackLoopState } from "../utils/sessionFeedbackLoop";

function mockLocalStorage(): void {
  const store: Record<string, string> = {};
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const key of Object.keys(store)) delete store[key];
      },
    },
    configurable: true,
  });
}

describe("sessionFeedbackLoopHistoryStore", () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  test("archives and lists by repository", () => {
    const state = createInitialFeedbackLoopState("sess-a", 3);
    state.phase = "completed";
    state.completionReason = "converged";
    archiveFeedbackLoopHistory({
      state,
      repositoryPath: "/tmp/wise",
      repositoryName: "wise",
    });
    const rows = listFeedbackLoopHistory("/tmp/wise");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.repositoryPath).toBe("/tmp/wise");
  });

  test("compareWithHistoryAverage computes delta", () => {
    const avg = compareWithHistoryAverage(
      [
        {
          id: "1",
          sessionId: "s",
          repositoryPath: "/r",
          completedAt: 1,
          cycleCount: 1,
          maxCycles: 3,
          finalOverallScore: 10,
          improvedCycles: 1,
          finalSummary: "",
          habits: [],
          trend: [],
        },
        {
          id: "2",
          sessionId: "s2",
          repositoryPath: "/r",
          completedAt: 2,
          cycleCount: 1,
          maxCycles: 3,
          finalOverallScore: 6,
          improvedCycles: 0,
          finalSummary: "",
          habits: [],
          trend: [],
        },
      ],
      12,
    );
    expect(avg.average).toBe(8);
    expect(avg.delta).toBe(4);
  });
});
