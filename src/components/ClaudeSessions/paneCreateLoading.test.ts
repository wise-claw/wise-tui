import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const warningMock = mock(() => {});

mock.module("antd", () => ({
  message: {
    warning: warningMock,
  },
}));
mock.module("antd/lib/index.js", () => ({
  message: {
    warning: warningMock,
  },
}));

const { runPaneCreateTask } = await import("./paneCreateLoading");

function installWindowTimerStub() {
  Object.defineProperty(globalThis, "window", {
    value: globalThis,
    configurable: true,
  });
}

describe("runPaneCreateTask", () => {
  beforeEach(() => {
    installWindowTimerStub();
    warningMock.mockClear();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  test("sets creating true then false after fast task", async () => {
    const updates: Array<Record<number, boolean>> = [];
    const setCreating = (updater: Record<number, boolean> | ((prev: Record<number, boolean>) => Record<number, boolean>)) => {
      const prev = updates.at(-1) ?? {};
      const next = typeof updater === "function" ? updater(prev) : updater;
      updates.push(next);
    };

    runPaneCreateTask(Promise.resolve("ok"), 1, setCreating, { minLoadingMs: 0, timeoutMs: 500 });
    expect(updates[0]?.[1]).toBe(true);

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(updates.at(-1)?.[1]).toBe(false);
    expect(warningMock).not.toHaveBeenCalled();
  });

  test("clears creating and warns when task exceeds timeout", async () => {
    const updates: Array<Record<number, boolean>> = [];
    const setCreating = (updater: Record<number, boolean> | ((prev: Record<number, boolean>) => Record<number, boolean>)) => {
      const prev = updates.at(-1) ?? {};
      const next = typeof updater === "function" ? updater(prev) : updater;
      updates.push(next);
    };

    runPaneCreateTask(new Promise(() => {}), 2, setCreating, { minLoadingMs: 0, timeoutMs: 30 });
    expect(updates[0]?.[2]).toBe(true);

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 60);
    });
    expect(updates.at(-1)?.[2]).toBe(false);
    expect(warningMock).toHaveBeenCalledTimes(1);
  });

  test("does not clear creating again after timeout when late task completes", async () => {
    let resolveTask: ((value: string) => void) | undefined;
    const task = new Promise<string>((resolve) => {
      resolveTask = resolve;
    });
    const updates: Array<Record<number, boolean>> = [];
    const setCreating = (updater: Record<number, boolean> | ((prev: Record<number, boolean>) => Record<number, boolean>)) => {
      const prev = updates.at(-1) ?? {};
      const next = typeof updater === "function" ? updater(prev) : updater;
      updates.push(next);
    };

    runPaneCreateTask(task, 0, setCreating, { minLoadingMs: 0, timeoutMs: 20 });
    expect(updates[0]?.[0]).toBe(true);

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 40);
    });
    const falseCountAfterTimeout = updates.filter((row) => row[0] === false).length;
    expect(falseCountAfterTimeout).toBe(1);
    expect(warningMock).toHaveBeenCalledTimes(1);

    resolveTask?.("late");
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(updates.filter((row) => row[0] === false).length).toBe(falseCountAfterTimeout);
  });
});
