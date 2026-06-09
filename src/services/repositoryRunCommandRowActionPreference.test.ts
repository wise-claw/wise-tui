import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const getAppSetting = mock(async () => null as string | null);
const setAppSetting = mock(async () => undefined);

mock.module("./appSettingsStore", () => ({
  getAppSetting,
  setAppSetting,
}));

import {
  isRepositoryRunCommandRowPinned,
  loadRepositoryRunCommandRowPinnedMap,
  REPOSITORY_RUN_COMMAND_ROW_PINNED_BY_REPO_KEY,
  setRepositoryRunCommandRowPinned,
  toggleRepositoryRunCommandRowPinned,
  WISE_REPOSITORY_RUN_COMMAND_ROW_PINNED_CHANGED,
} from "./repositoryRunCommandRowActionPreference";

function installWindowStub() {
  const listeners = new Map<string, Set<EventListener>>();
  Object.defineProperty(globalThis, "window", {
    value: {
      dispatchEvent: (event: Event) => {
        listeners.get(event.type)?.forEach((handler) => handler(event));
        return true;
      },
      addEventListener: (type: string, handler: EventListener) => {
        const bucket = listeners.get(type) ?? new Set<EventListener>();
        bucket.add(handler);
        listeners.set(type, bucket);
      },
      removeEventListener: (type: string, handler: EventListener) => {
        listeners.get(type)?.delete(handler);
      },
    },
    configurable: true,
  });
}

describe("repositoryRunCommandRowActionPreference", () => {
  let storedMapJson: string | null = null;

  beforeEach(() => {
    installWindowStub();
    storedMapJson = null;
    getAppSetting.mockReset();
    getAppSetting.mockImplementation(async (key: string) => {
      if (key === REPOSITORY_RUN_COMMAND_ROW_PINNED_BY_REPO_KEY) return storedMapJson;
      return null;
    });
    setAppSetting.mockReset();
    setAppSetting.mockImplementation(async (key: string, value: string) => {
      if (key === REPOSITORY_RUN_COMMAND_ROW_PINNED_BY_REPO_KEY) storedMapJson = value;
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  test("load returns empty map when unset", async () => {
    const map = await loadRepositoryRunCommandRowPinnedMap();
    expect(map).toEqual({});
    expect(setAppSetting).toHaveBeenCalledWith(REPOSITORY_RUN_COMMAND_ROW_PINNED_BY_REPO_KEY, "{}");
  });

  test("toggle pins only the requested repository", async () => {
    storedMapJson = JSON.stringify({ "7": true });

    const events: Array<Record<number, boolean>> = [];
    window.addEventListener(WISE_REPOSITORY_RUN_COMMAND_ROW_PINNED_CHANGED, (event) => {
      events.push((event as CustomEvent<{ map: Record<number, boolean> }>).detail.map);
    });

    const next = await toggleRepositoryRunCommandRowPinned(9);
    expect(next).toBe(true);
    expect(setAppSetting).toHaveBeenCalledWith(
      REPOSITORY_RUN_COMMAND_ROW_PINNED_BY_REPO_KEY,
      JSON.stringify({ "7": true, "9": true }),
    );
    expect(events.at(-1)).toEqual({ 7: true, 9: true });

    await setRepositoryRunCommandRowPinned(7, false);
    expect(setAppSetting).toHaveBeenCalledWith(
      REPOSITORY_RUN_COMMAND_ROW_PINNED_BY_REPO_KEY,
      JSON.stringify({ "9": true }),
    );
    expect(isRepositoryRunCommandRowPinned({ 9: true }, 7)).toBe(false);
    expect(isRepositoryRunCommandRowPinned({ 9: true }, 9)).toBe(true);
  });
});
