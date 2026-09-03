import { describe, expect, test } from "bun:test";
import {
  applyGitRepositoryStatsFromStatus,
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
    expect(getGitRepositoryStatsSnapshot("/repo/a")).toEqual({ additions: 0, deletions: 0, ahead: 0, behind: 0 });
    unsubA();
    unsubB();
    expect(getGitRepositoryStatsSnapshot("/repo/a")).toEqual({ additions: 0, deletions: 0, ahead: 0, behind: 0 });
    expect(genA).toBe(0);
    expect(genB).toBe(0);
  });

  test("bounds zero-consumer warm snapshots while preserving recent paths", () => {
    resetGitRepositoryStatsStoreForTests();
    for (let i = 0; i < 40; i += 1) {
      applyGitRepositoryStatsFromStatus(`/repo/${i}`, {
        additions: i + 1,
        deletions: 0,
        ahead: 0,
        behind: 0,
      });
    }
    expect(getGitRepositoryStatsSnapshot("/repo/0").additions).toBe(0);
    expect(getGitRepositoryStatsSnapshot("/repo/39").additions).toBe(40);
  });
});
