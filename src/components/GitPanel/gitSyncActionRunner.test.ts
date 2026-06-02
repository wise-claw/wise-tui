import { describe, expect, test } from "bun:test";
import { runGitSyncAction, type GitSyncActionKind } from "./gitSyncActionRunner";

describe("runGitSyncAction", () => {
  test("starts loading immediately and clears after completion", async () => {
    const activeKindRef = { current: null as GitSyncActionKind | null };
    const runningActions = { current: new Set<string>() };
    const loadingStates: Array<Record<string, boolean>> = [];

    const result = await runGitSyncAction({
      kind: "fetch",
      activeKindRef,
      runningActions,
      setLoading: (updater) => {
        const next =
          typeof updater === "function"
            ? updater({ fetch: false, pull: false, push: false })
            : updater;
        loadingStates.push(next);
      },
      beginGitSyncOperation: () => undefined,
      endGitSyncOperation: () => undefined,
      refresh: async () => undefined,
      work: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      },
    });

    expect(result).toBe(true);
    expect(loadingStates[0]?.fetch).toBe(true);
    expect(loadingStates.at(-1)?.fetch).toBe(false);
    expect(activeKindRef.current).toBeNull();
    expect(runningActions.current.size).toBe(0);
  });

  test("ignores duplicate invocations while busy", async () => {
    const activeKindRef = { current: null as GitSyncActionKind | null };
    const runningActions = { current: new Set<string>() };
    let workCalls = 0;

    const first = runGitSyncAction({
      kind: "pull",
      activeKindRef,
      runningActions,
      setLoading: () => undefined,
      beginGitSyncOperation: () => undefined,
      endGitSyncOperation: () => undefined,
      refresh: async () => undefined,
      work: async () => {
        workCalls += 1;
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
      },
    });

    const second = runGitSyncAction({
      kind: "fetch",
      activeKindRef,
      runningActions,
      setLoading: () => undefined,
      beginGitSyncOperation: () => undefined,
      endGitSyncOperation: () => undefined,
      refresh: async () => undefined,
      work: async () => {
        workCalls += 1;
      },
    });

    expect(await second).toBe(false);
    expect(await first).toBe(true);
    expect(workCalls).toBe(1);
  });
});
