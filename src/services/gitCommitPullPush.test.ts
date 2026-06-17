import { describe, expect, it } from "bun:test";
import {
  hasUnpushedCommits,
  hasWorkingTreeChanges,
  needsGitSyncWork,
  needsGitSyncWorkFromSummary,
} from "./gitCommitPullPush";
import type { GitStatusResponse, GitStatusSummaryResponse } from "../types";

function makeStatus(partial: Partial<GitStatusResponse> = {}): GitStatusResponse {
  return {
    staged: [],
    unstaged: [],
    branch: "master",
    additions: 0,
    deletions: 0,
    ahead: 0,
    behind: 0,
    upstream: null,
    ...partial,
  };
}

function makeSummary(partial: Partial<GitStatusSummaryResponse> = {}): GitStatusSummaryResponse {
  return {
    branch: "master",
    additions: 0,
    deletions: 0,
    ahead: 0,
    behind: 0,
    stagedCount: 0,
    unstagedCount: 0,
    ...partial,
  };
}

describe("gitCommitPullPush helpers", () => {
  it("detects working tree changes", () => {
    expect(hasWorkingTreeChanges(makeStatus())).toBe(false);
    expect(
      hasWorkingTreeChanges(
        makeStatus({ unstaged: [{ path: "a.ts", status: "M", additions: 1, deletions: 0 }] }),
      ),
    ).toBe(true);
  });

  it("detects unpushed commits", () => {
    expect(hasUnpushedCommits(makeStatus({ ahead: 0 }))).toBe(false);
    expect(hasUnpushedCommits(makeStatus({ ahead: 2 }))).toBe(true);
  });

  it("treats ahead-only repos as syncable", () => {
    expect(needsGitSyncWork(makeStatus({ ahead: 1 }))).toBe(true);
    expect(needsGitSyncWorkFromSummary(makeSummary({ ahead: 1 }))).toBe(true);
  });
});
