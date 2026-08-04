import { describe, expect, test } from "bun:test";
import { runGitPanelAction } from "./runGitPanelAction";

describe("runGitPanelAction", () => {
  test("mutation 成功后先清 loading，再刷新 status", async () => {
    const events: string[] = [];
    const lastActionTime = new Map<string, number>();
    const runningActions = new Set<string>();
    let loading: Record<string, boolean> = {};
    let errors: Record<string, string> = {};

    await runGitPanelAction({
      action: "stage",
      debounceMs: 0,
      lastActionTime,
      runningActions,
      setLoading: (update) => {
        loading = update(loading);
        events.push(loading.stage ? "loading:on" : "loading:off");
      },
      setErrors: (update) => {
        errors = update(errors);
      },
      beginGitSyncOperation: () => events.push("sync:begin"),
      endGitSyncOperation: () => events.push("sync:end"),
      refreshStatus: async () => {
        events.push("refresh");
        expect(loading.stage).toBe(false);
      },
      fn: async () => {
        events.push("mutate");
        expect(loading.stage).toBe(true);
      },
    });

    expect(events).toEqual([
      "loading:on",
      "sync:begin",
      "mutate",
      "loading:off",
      "refresh",
      "sync:end",
    ]);
    expect(errors).toEqual({});
    expect(runningActions.size).toBe(0);
  });

  test("mutation 失败时不刷新 status，仍清 loading", async () => {
    const events: string[] = [];
    const lastActionTime = new Map<string, number>();
    const runningActions = new Set<string>();
    let loading: Record<string, boolean> = {};
    let errors: Record<string, string> = {};

    await runGitPanelAction({
      action: "stageAll",
      debounceMs: 0,
      lastActionTime,
      runningActions,
      setLoading: (update) => {
        loading = update(loading);
        events.push(loading.stageAll ? "loading:on" : "loading:off");
      },
      setErrors: (update) => {
        errors = update(errors);
      },
      refreshStatus: async () => {
        events.push("refresh");
      },
      fn: async () => {
        events.push("mutate");
        throw new Error("boom");
      },
    });

    expect(events).toEqual(["loading:on", "mutate", "loading:off"]);
    expect(errors.stageAll).toBe("boom");
  });

  test("debounce 期间重复点击直接跳过", async () => {
    const lastActionTime = new Map<string, number>([["unstage", Date.now()]]);
    const runningActions = new Set<string>();
    let called = 0;

    await runGitPanelAction({
      action: "unstage",
      debounceMs: 10_000,
      lastActionTime,
      runningActions,
      setLoading: () => {},
      setErrors: () => {},
      refreshStatus: async () => {
        called += 1;
      },
      fn: async () => {
        called += 1;
      },
    });

    expect(called).toBe(0);
  });
});
