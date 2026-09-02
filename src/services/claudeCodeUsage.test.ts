import { afterEach, describe, expect, mock, test } from "bun:test";

const invoke = mock(async (_command: string, args: { projectPath?: string | null }) => ({
  projectPath: args.projectPath,
}));

mock.module("@tauri-apps/api/core", () => ({
  invoke,
  isTauri: () => true,
}));

import {
  getClaudeCodeLineEditsSnapshot,
  getClaudeCodeUsageSnapshot,
  invalidateClaudeCodeUsageSnapshotCache,
  resetClaudeCodeUsageSnapshotCacheForTests,
} from "./claudeCodeUsage";

afterEach(() => {
  invoke.mockClear();
  resetClaudeCodeUsageSnapshotCacheForTests();
});

describe("claudeCodeUsage snapshot cache", () => {
  test("coalesces concurrent expensive scans for the same scope", async () => {
    let resolveScan!: (value: unknown) => void;
    invoke.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveScan = resolve;
      }),
    );

    const first = getClaudeCodeUsageSnapshot({ projectPath: " /repo " });
    const second = getClaudeCodeUsageSnapshot({ projectPath: "/repo" });
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledTimes(1);
    resolveScan({ totalTokens: 42 });

    expect(await first).toEqual({ totalTokens: 42 });
    expect(await second).toEqual({ totalTokens: 42 });
  });

  test("invalidating an in-flight scan prevents stale completion from repopulating cache", async () => {
    let resolveFirst!: (value: unknown) => void;
    invoke.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    const stale = getClaudeCodeUsageSnapshot({ projectPath: "/repo" });
    await Promise.resolve();
    invalidateClaudeCodeUsageSnapshotCache("/repo");
    resolveFirst({ generation: 1 });
    await stale;

    invoke.mockResolvedValueOnce({ generation: 2 });
    expect(await getClaudeCodeUsageSnapshot({ projectPath: "/repo" })).toEqual({ generation: 2 });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  test("bounds per-project cache entries with LRU eviction", async () => {
    for (let index = 0; index < 13; index += 1) {
      await getClaudeCodeUsageSnapshot({ projectPath: `/repo-${index}` });
    }
    expect(invoke).toHaveBeenCalledTimes(13);
    await getClaudeCodeUsageSnapshot({ projectPath: "/repo-12" });
    expect(invoke).toHaveBeenCalledTimes(13);
    await getClaudeCodeUsageSnapshot({ projectPath: "/repo-0" });
    expect(invoke).toHaveBeenCalledTimes(14);
  });

  test("keeps usage and line-edit scans in independent caches", async () => {
    await Promise.all([
      getClaudeCodeUsageSnapshot({ projectPath: "/repo" }),
      getClaudeCodeLineEditsSnapshot({ projectPath: "/repo" }),
    ]);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls.map(([command]) => command).sort()).toEqual([
      "get_claude_code_line_edits_snapshot",
      "get_claude_code_usage_snapshot",
    ]);
  });
});
