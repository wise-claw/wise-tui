import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const getAppSetting = mock(async () => null as string | null);
const setAppSetting = mock(async (_key: string, _value: string) => undefined);
mock.module("./appSettingsStore", () => ({ getAppSetting, setAppSetting }));

import { createLocalModelPreferenceCache } from "./localModelPreferenceCache";

const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const parse = (raw: string | null): Partial<Record<"claude" | "cursor", string>> =>
  raw ? JSON.parse(raw) : {};

describe("local model preference persistence", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
      },
    });
    getAppSetting.mockReset();
    getAppSetting.mockImplementation(async () => null);
    setAppSetting.mockReset();
    setAppSetting.mockImplementation(async () => undefined);
  });

  afterEach(() => {
    if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });

  test("a refresh immediately restores local choices even before disk save completes", async () => {
    let finishRead!: (raw: string | null) => void;
    getAppSetting.mockImplementation(() => new Promise((resolve) => { finishRead = resolve; }));
    const cache = createLocalModelPreferenceCache("models", parse);
    const save = cache.update("cursor", "gpt-selected");
    const refreshed = createLocalModelPreferenceCache("models", parse);
    expect(refreshed.read().cursor).toBe("gpt-selected");
    finishRead(JSON.stringify({ claude: "opus", cursor: "old" }));
    await save;
    expect(cache.read()).toEqual({ claude: "opus", cursor: "gpt-selected" });
    expect(setAppSetting).toHaveBeenLastCalledWith("models", JSON.stringify(cache.read()));
  });

  test("browser-only saves survive a full in-memory reset", async () => {
    const cache = createLocalModelPreferenceCache("models", parse);
    await cache.update("cursor", "grok-selected");
    await cache.update("claude", "opus");
    cache.reset();
    expect(cache.read()).toEqual({ cursor: "grok-selected", claude: "opus" });
    await cache.load();
    expect(cache.read()).toEqual({ cursor: "grok-selected", claude: "opus" });
  });

  test("rapid selections serialize disk writes and finish with the latest choice", async () => {
    let release!: () => void;
    const persisted: string[] = [];
    setAppSetting.mockImplementation(async (_key, value) => {
      if (!persisted.length) await new Promise<void>((resolve) => { release = resolve; });
      persisted.push(value);
    });
    const cache = createLocalModelPreferenceCache("models", parse);
    await cache.load();
    const first = cache.update("cursor", "first");
    // Let the first write reach the fake disk.
    await Promise.resolve();
    await Promise.resolve();
    const second = cache.update("cursor", "second");
    const third = cache.update("claude", "opus");
    expect(cache.read()).toEqual({ cursor: "second", claude: "opus" });
    expect(setAppSetting).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second, third]);
    expect(JSON.parse(persisted.at(-1)!)).toEqual({ cursor: "second", claude: "opus" });
  });

  test("clearing a default during hydration does not revive its disk value", async () => {
    globalThis.localStorage.setItem("models", JSON.stringify({ cursor: "old" }));
    getAppSetting.mockImplementation(async () => JSON.stringify({ cursor: "old", claude: "opus" }));
    const cache = createLocalModelPreferenceCache("models", parse);
    await cache.update("cursor", undefined);
    expect(cache.read()).toEqual({ claude: "opus" });
  });

  test("unavailable local storage still uses the desktop store", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() { throw new Error("storage unavailable"); },
    });
    const cache = createLocalModelPreferenceCache("models", parse);
    await cache.update("cursor", "selected");
    expect(cache.read().cursor).toBe("selected");
    expect(setAppSetting).toHaveBeenCalledTimes(1);
  });
});
