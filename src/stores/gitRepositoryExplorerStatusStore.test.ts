import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { GitStatusResponse } from "../types";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

function statusWithFile(path: string): GitStatusResponse {
  return {
    staged: [],
    unstaged: [{ path, status: "M", additions: 1, deletions: 0 }],
    branch: "main",
    additions: 1,
    deletions: 0,
    ahead: 0,
    behind: 0,
    upstream: null,
  };
}

const emptyStatus: GitStatusResponse = {
  staged: [],
  unstaged: [],
  branch: "main",
  additions: 0,
  deletions: 0,
  ahead: 0,
  behind: 0,
  upstream: null,
};

const gitStatusMock = mock(async (_path: string): Promise<GitStatusResponse> => emptyStatus);
const listenMock = mock(async () => () => undefined);
const unlistenMock = mock(() => undefined);

mock.module("../services/git", () => ({
  gitStatus: (path: string) => gitStatusMock(path),
}));

let resolvedStatus: GitStatusResponse | null = null;
let warmStatus: GitStatusResponse | null = null;

mock.module("../services/gitStatusWarmCache", () => ({
  peekWarmGitStatus: () => warmStatus && Promise.resolve(warmStatus),
  consumeWarmGitStatus: () => null,
  rememberGitStatus: () => undefined,
  getResolvedGitStatus: () => resolvedStatus,
}));

mock.module("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

mock.module("../utils/adaptivePoll", () => ({
  startAdaptiveInterval: () => () => undefined,
  scalePollIntervalMs: (ms: number) => ms,
  isWebViewDevToolsLikelyOpen: () => false,
  shouldDeferAdaptivePollTick: () => false,
  readVisiblePollIntervalMs: (visibleMs: number) => visibleMs,
  congestionCheckRef: { current: null },
  pollInteractionReliefRef: { current: null },
}));

mock.module("./gitRepositoryStatsStore", () => ({
  applyGitRepositoryStatsEmpty: () => undefined,
  applyGitRepositoryStatsFromStatus: () => undefined,
  registerGitRepositoryStatsExplorerBridge: () => undefined,
}));

const {
  getGitRepositoryExplorerStatusGeneration,
  getGitRepositoryExplorerStatusSnapshot,
  refreshGitRepositoryExplorerStatus,
  resetGitRepositoryExplorerStatusStoreForTests,
  subscribeGitRepositoryExplorerStatus,
} = await import("./gitRepositoryExplorerStatusStore");

describe("gitRepositoryExplorerStatusStore refresh race", () => {
  beforeEach(() => {
    resetGitRepositoryExplorerStatusStoreForTests();
    resolvedStatus = null;
    warmStatus = null;
    gitStatusMock.mockReset();
    gitStatusMock.mockImplementation(async () => emptyStatus);
    listenMock.mockReset();
    listenMock.mockImplementation(async () => unlistenMock);
    unlistenMock.mockReset();
  });

  afterEach(() => {
    resetGitRepositoryExplorerStatusStoreForTests();
  });

  test("slow refresh does not overwrite a newer refresh result", async () => {
    const pending: Deferred<GitStatusResponse>[] = [];
    gitStatusMock.mockImplementation(async () => {
      const d = deferred<GitStatusResponse>();
      pending.push(d);
      return d.promise;
    });

    const unsub = subscribeGitRepositoryExplorerStatus("/repo", () => undefined);
    await flushMicrotasks();
    // 消化 subscribe 触发的初始 refresh（ensurePollLoop + acquire）
    while (pending.length > 0) {
      const batch = pending.splice(0, pending.length);
      for (const item of batch) item.resolve(emptyStatus);
      await flushMicrotasks();
    }

    refreshGitRepositoryExplorerStatus("/repo");
    refreshGitRepositoryExplorerStatus("/repo");
    await flushMicrotasks();
    expect(pending.length).toBe(2);

    const [slow, fast] = pending.splice(0, 2);
    fast!.resolve(statusWithFile("newer.ts"));
    await flushMicrotasks();

    expect(getGitRepositoryExplorerStatusSnapshot("/repo").fileStatusByPath.get("newer.ts")).toBe("M");
    const genAfterFast = getGitRepositoryExplorerStatusGeneration("/repo");

    slow!.resolve(statusWithFile("stale.ts"));
    await flushMicrotasks();

    expect(getGitRepositoryExplorerStatusSnapshot("/repo").fileStatusByPath.has("stale.ts")).toBe(false);
    expect(getGitRepositoryExplorerStatusSnapshot("/repo").fileStatusByPath.get("newer.ts")).toBe("M");
    expect(getGitRepositoryExplorerStatusGeneration("/repo")).toBe(genAfterFast);

    unsub();
  });

  test("unlistens orphan git-changed listener when consumers drop during listen await", async () => {
    const listenReady = deferred<() => void>();
    listenMock.mockImplementation(async () => listenReady.promise);

    const unsub = subscribeGitRepositoryExplorerStatus("/repo-orphan", () => undefined);
    unsub();

    listenReady.resolve(unlistenMock);
    await flushMicrotasks();

    expect(unlistenMock).toHaveBeenCalled();
  });

  test("resolved warm cache seeds explorer colors without an immediate git_status", async () => {
    resolvedStatus = statusWithFile("cached.ts");
    const unsub = subscribeGitRepositoryExplorerStatus("/repo-warm", () => undefined);
    await flushMicrotasks();

    expect(gitStatusMock).not.toHaveBeenCalled();
    expect(getGitRepositoryExplorerStatusSnapshot("/repo-warm").fileStatusByPath.get("cached.ts")).toBe("M");
    expect(getGitRepositoryExplorerStatusGeneration("/repo-warm")).toBeGreaterThan(0);

    unsub();
  });

  test("explicit refresh bypasses a stale warm status", async () => {
    resolvedStatus = emptyStatus;
    warmStatus = statusWithFile("stale.ts");
    const unsub = subscribeGitRepositoryExplorerStatus("/repo-force", () => undefined);
    await flushMicrotasks();

    refreshGitRepositoryExplorerStatus("/repo-force");
    await flushMicrotasks();

    expect(gitStatusMock).toHaveBeenCalledWith("/repo-force");
    expect(getGitRepositoryExplorerStatusSnapshot("/repo-force").fileStatusByPath.has("stale.ts")).toBe(false);
    unsub();
  });
});
