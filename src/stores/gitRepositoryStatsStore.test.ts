import { describe, expect, test } from "bun:test";
import {
  getGitRepositoryStatsGeneration,
  getGitRepositoryStatsSnapshot,
  resetGitRepositoryStatsStoreForTests,
  subscribeGitRepositoryStats,
} from "./gitRepositoryStatsStore";

describe("gitRepositoryStatsStore", () => {
  test("dedupes subscribers for the same repository path", () => {
    resetGitRepositoryStatsStoreForTests();
    let genA = 0;
    let genB = 0;
    const unsubA = subscribeGitRepositoryStats("/repo/a", () => {
      genA = getGitRepositoryStatsGeneration("/repo/a");
    });
    const unsubB = subscribeGitRepositoryStats("/repo/a", () => {
      genB = getGitRepositoryStatsGeneration("/repo/a");
    });
    expect(getGitRepositoryStatsSnapshot("/repo/a")).toEqual({ additions: 0, deletions: 0 });
    unsubA();
    unsubB();
    expect(getGitRepositoryStatsSnapshot("/repo/a")).toEqual({ additions: 0, deletions: 0 });
    expect(genA).toBe(0);
    expect(genB).toBe(0);
  });
});
