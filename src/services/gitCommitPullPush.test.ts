import { describe, expect, it, mock, beforeEach } from "bun:test";
import type { GitStatusResponse, GitStatusSummaryResponse } from "../types";

const gitStatus = mock(async (_path: string): Promise<GitStatusResponse> => makeStatus());
const gitStageAll = mock(async (_path: string) => undefined);
const gitCommit = mock(async (_path: string, _message: string) => "abc");
const gitPull = mock(async (_path: string) => undefined);
const gitPush = mock(async (_path: string) => undefined);

mock.module("./git", () => ({
  gitStatus,
  gitStageAll,
  gitCommit,
  gitPull,
  gitPush,
}));

const {
  commitPullPushRepository,
  hasUnpushedCommits,
  hasUpstreamTracking,
  hasWorkingTreeChanges,
  needsGitSyncWork,
  needsGitSyncWorkFromSummary,
  needsPublishBranch,
} = await import("./gitCommitPullPush");

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
    expect(needsGitSyncWork(makeStatus({ ahead: 1, upstream: "origin/master" }))).toBe(true);
    expect(needsGitSyncWorkFromSummary(makeSummary({ ahead: 1 }))).toBe(true);
  });

  it("detects missing upstream for new local branches", () => {
    expect(hasUpstreamTracking(makeStatus({ upstream: null }))).toBe(false);
    expect(hasUpstreamTracking(makeStatus({ upstream: "origin/feature" }))).toBe(true);
    expect(needsPublishBranch(makeStatus({ branch: "feature/x", upstream: null }))).toBe(true);
    expect(needsPublishBranch(makeStatus({ branch: "feature/x", upstream: "origin/feature/x" }))).toBe(
      false,
    );
    expect(needsPublishBranch(makeStatus({ branch: null, upstream: null }))).toBe(false);
  });

  it("treats unpublished local branches as syncable even when ahead is 0", () => {
    expect(needsGitSyncWork(makeStatus({ branch: "feature/new", ahead: 0, upstream: null }))).toBe(
      true,
    );
    expect(
      needsGitSyncWork(
        makeStatus({
          branch: "feature/new",
          ahead: 0,
          upstream: null,
          unstaged: [{ path: "a.ts", status: "M", additions: 1, deletions: 0 }],
        }),
      ),
    ).toBe(true);
  });
});

describe("commitPullPushRepository new local branch", () => {
  beforeEach(() => {
    gitStatus.mockReset();
    gitStageAll.mockReset();
    gitCommit.mockReset();
    gitPull.mockReset();
    gitPush.mockReset();
    gitStageAll.mockImplementation(async () => undefined);
    gitCommit.mockImplementation(async () => "abc");
    gitPull.mockImplementation(async () => undefined);
    gitPush.mockImplementation(async () => undefined);
  });

  it("skips pull and still pushes when branch has no upstream", async () => {
    gitStatus.mockImplementation(async () =>
      makeStatus({
        branch: "feature/new",
        upstream: null,
        ahead: 0,
        unstaged: [{ path: "a.ts", status: "M", additions: 1, deletions: 0 }],
      }),
    );

    const outcome = await commitPullPushRepository("/repo", "feat: change");

    expect(outcome).toBe("committed_and_pushed");
    expect(gitStageAll).toHaveBeenCalledTimes(1);
    expect(gitCommit).toHaveBeenCalledTimes(1);
    expect(gitPull).toHaveBeenCalledTimes(0);
    expect(gitPush).toHaveBeenCalledTimes(1);
  });

  it("still pulls then pushes when upstream exists", async () => {
    gitStatus.mockImplementation(async () =>
      makeStatus({
        branch: "feature/new",
        upstream: "origin/feature/new",
        ahead: 1,
      }),
    );

    const outcome = await commitPullPushRepository("/repo", "feat: change");

    expect(outcome).toBe("pushed_only");
    expect(gitCommit).toHaveBeenCalledTimes(0);
    expect(gitPull).toHaveBeenCalledTimes(1);
    expect(gitPush).toHaveBeenCalledTimes(1);
  });
});
