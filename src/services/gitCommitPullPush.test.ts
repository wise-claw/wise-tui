import { describe, expect, it, mock, beforeEach } from "bun:test";
import type { GitStatusResponse, GitStatusSummaryResponse } from "../types";

const gitStatus = mock(async (_path: string): Promise<GitStatusResponse> => makeStatus());
const gitCommitMessageContext = mock(async (_path: string) => "@@ -1 +1 @@\n-old\n+new");
const gitStageAll = mock(async (_path: string) => undefined);
const gitCommit = mock(async (_path: string, _message: string) => "abc");
const gitPull = mock(async (_path: string) => undefined);
const gitPush = mock(async (_path: string) => undefined);
mock.module("./git", () => ({
  gitStatus,
  gitCommitMessageContext,
  gitStageAll,
  gitCommit,
  gitPull,
  gitPush,
}));

const {
  aiCommitPullPushRepository,
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
    upstream: null,
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
    expect(needsPublishBranch(makeStatus({ branch: "(abc1234)", upstream: null }))).toBe(false);
  });

  it("treats unpublished local branches as syncable even when ahead is 0", () => {
    expect(needsGitSyncWork(makeStatus({ branch: "feature/new", ahead: 0, upstream: null }))).toBe(
      true,
    );
    expect(
      needsGitSyncWorkFromSummary(
        makeSummary({ branch: "feature/new", ahead: 0, upstream: null }),
      ),
    ).toBe(true);
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
    gitCommitMessageContext.mockReset();
    gitStageAll.mockReset();
    gitCommit.mockReset();
    gitPull.mockReset();
    gitPush.mockReset();
    gitStageAll.mockImplementation(async () => undefined);
    gitCommit.mockImplementation(async () => "abc");
    gitPull.mockImplementation(async () => undefined);
    gitPush.mockImplementation(async () => undefined);
    gitCommitMessageContext.mockImplementation(async () => "@@ -1 +1 @@\n-old\n+new");
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

  it("publishes branch-only without commit message when no local changes", async () => {
    gitStatus.mockImplementation(async () =>
      makeStatus({
        branch: "feature/new",
        upstream: null,
        ahead: 0,
      }),
    );

    const outcome = await commitPullPushRepository("/repo", "");

    expect(outcome).toBe("published");
    expect(gitCommit).toHaveBeenCalledTimes(0);
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

describe("aiCommitPullPushRepository execution engine", () => {
  beforeEach(() => {
    gitStatus.mockReset();
    gitCommitMessageContext.mockReset();
    gitStageAll.mockReset();
    gitCommit.mockReset();
    gitPull.mockReset();
    gitPush.mockReset();
    gitStageAll.mockImplementation(async () => undefined);
    gitCommit.mockImplementation(async () => "abc");
    gitPull.mockImplementation(async () => undefined);
    gitPush.mockImplementation(async () => undefined);
    gitCommitMessageContext.mockImplementation(async () => "@@ -1 +1 @@\n-old\n+new");
  });

  it("passes selected executionEngine to oneshot wait", async () => {
    gitStatus.mockImplementation(async () =>
      makeStatus({
        upstream: "origin/master",
        unstaged: [{ path: "a.ts", status: "M", additions: 1, deletions: 0 }],
      }),
    );
    const invokeEngine = mock(async (params: { executionEngine?: string; model?: string }) => {
      expect(params.executionEngine).toBe("codex");
      expect(params.model).toBeUndefined();
      return { success: false, outputLines: [], errorLines: [] };
    });

    await aiCommitPullPushRepository("/repo", {
      executionEngine: "codex",
      invokeEngine: invokeEngine as never,
    });

    expect(invokeEngine).toHaveBeenCalledTimes(1);
  });

  it("uses AI text when oneshot succeeds", async () => {
    gitStatus.mockImplementation(async () =>
      makeStatus({
        upstream: "origin/master",
        unstaged: [{ path: "a.ts", status: "M", additions: 1, deletions: 0 }],
      }),
    );
    const invokeEngine = mock(async () => ({
      success: true,
      outputLines: [
        JSON.stringify({
          type: "result",
          result: "fix: 润色提交信息",
        }),
      ],
      errorLines: [],
    }));

    await aiCommitPullPushRepository("/repo", {
      executionEngine: "claude",
      invokeEngine: invokeEngine as never,
    });

    expect(invokeEngine).toHaveBeenCalledTimes(1);
    expect(gitCommit.mock.calls[0]?.[1]).toBe("fix: 润色提交信息");
  });

  it("includes actual diff context and allows 45 seconds for the selected engine", async () => {
    gitStatus.mockImplementation(async () =>
      makeStatus({
        upstream: "origin/master",
        unstaged: [{ path: "a.ts", status: "M", additions: 1, deletions: 1 }],
      }),
    );
    const invokeEngine = mock(async (params: { prompt: string; timeoutMs?: number }) => {
      expect(params.prompt).toContain("@@ -1 +1 @@");
      expect(params.timeoutMs).toBe(45_000);
      return {
        success: true,
        outputLines: [JSON.stringify({ type: "result", result: "fix: 使用实际差异生成摘要" })],
        errorLines: [],
      };
    });

    await aiCommitPullPushRepository("/repo", { invokeEngine: invokeEngine as never });

    expect(gitCommitMessageContext).toHaveBeenCalledWith("/repo");
    expect(gitCommit.mock.calls[0]?.[1]).toBe("fix: 使用实际差异生成摘要");
  });

  it("reports malformed AI output and commits with the rule fallback", async () => {
    gitStatus.mockImplementation(async () =>
      makeStatus({
        upstream: "origin/master",
        unstaged: [{ path: "src/a.ts", status: "M", additions: 1, deletions: 0 }],
      }),
    );
    const onAiFallback = mock(() => undefined);
    const invokeEngine = mock(async () => ({
      success: true,
      outputLines: ["2"],
      errorLines: [],
    }));

    await aiCommitPullPushRepository("/repo", {
      invokeEngine: invokeEngine as never,
      onAiFallback,
    });

    expect(onAiFallback).toHaveBeenCalledTimes(1);
    expect(gitCommit.mock.calls[0]?.[1]).toBe("feat: 更新前端a相关逻辑");
  });

  it("falls back instead of aborting when the execution environment throws", async () => {
    gitStatus.mockImplementation(async () =>
      makeStatus({
        upstream: "origin/master",
        unstaged: [{ path: "a.ts", status: "M", additions: 1, deletions: 0 }],
      }),
    );
    const onAiFallback = mock(() => undefined);
    const invokeEngine = mock(async () => {
      throw new Error("Cursor ACP unavailable");
    });

    const outcome = await aiCommitPullPushRepository("/repo", {
      executionEngine: "cursor",
      invokeEngine: invokeEngine as never,
      onAiFallback,
    });

    expect(outcome).toBe("committed_and_pushed");
    expect(onAiFallback.mock.calls[0]?.[0]).toEqual({
      executionEngine: "cursor",
      reason: "Cursor ACP unavailable",
    });
    expect(gitCommit).toHaveBeenCalledTimes(1);
  });

  it("surfaces a readable Claude API failure returned on stdout", async () => {
    gitStatus.mockImplementation(async () =>
      makeStatus({
        upstream: "origin/master",
        unstaged: [{ path: "a.ts", status: "M", additions: 1, deletions: 0 }],
      }),
    );
    const onAiFallback = mock(() => undefined);
    const invokeEngine = mock(async () => ({
      success: false,
      outputLines: [JSON.stringify({
        type: "result",
        is_error: true,
        result: "API Error: 402 Insufficient Balance",
      })],
      errorLines: [],
    }));

    await aiCommitPullPushRepository("/repo", {
      executionEngine: "claude",
      invokeEngine: invokeEngine as never,
      onAiFallback,
    });

    expect(onAiFallback.mock.calls[0]?.[0]).toEqual({
      executionEngine: "claude",
      reason: "账户额度不足或计费异常（API Error: 402 Insufficient Balance）",
    });
    expect(gitCommit).toHaveBeenCalledTimes(1);
  });
});
