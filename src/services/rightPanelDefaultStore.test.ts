import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { RIGHT_PANEL_DEFAULT_COLLAPSED_KEY } from "../utils/rightPanelStorage";

const getAppSetting = mock(async () => null as string | null);
const setAppSetting = mock(async () => undefined);

mock.module("./appSettingsStore", () => ({
  getAppSetting,
  setAppSetting,
}));

import {
  loadRightPanelDefaultCollapsed,
  RIGHT_PANEL_DEFAULT_COLLAPSED_APP_KEY,
  saveRightPanelDefaultCollapsed,
  WISE_RIGHT_PANEL_DEFAULT_CHANGED,
} from "./rightPanelDefaultStore";

function installWindowLocalStorageStub(): Storage {
  const map = new Map<string, string>();
  const stub = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  } satisfies Storage;
  const listeners = new Map<string, Set<EventListener>>();
  Object.defineProperty(globalThis, "window", {
    value: {
      localStorage: stub,
      dispatchEvent: (event: Event) => {
        const bucket = listeners.get(event.type);
        bucket?.forEach((handler) => handler(event));
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
  return stub;
}

describe("rightPanelDefaultStore", () => {
  let storage: Storage | null = null;

  beforeEach(() => {
    storage = installWindowLocalStorageStub();
    storage.clear();
    getAppSetting.mockReset();
    getAppSetting.mockImplementation(async () => null);
    setAppSetting.mockReset();
    setAppSetting.mockImplementation(async () => undefined);
  });

  afterEach(() => {
    storage?.clear();
    Reflect.deleteProperty(globalThis, "window");
    storage = null;
  });

  test("load falls back to expanded when unset", async () => {
    expect(await loadRightPanelDefaultCollapsed()).toBe(false);
  });

  test("load prefers app_settings value", async () => {
    getAppSetting.mockImplementation(async (key: string) =>
      key === RIGHT_PANEL_DEFAULT_COLLAPSED_APP_KEY ? "1" : null,
    );
    expect(await loadRightPanelDefaultCollapsed()).toBe(true);
  });

  test("load migrates legacy localStorage into app_settings", async () => {
    storage?.setItem(RIGHT_PANEL_DEFAULT_COLLAPSED_KEY, "1");
    expect(await loadRightPanelDefaultCollapsed()).toBe(true);
    expect(setAppSetting).toHaveBeenCalledWith(RIGHT_PANEL_DEFAULT_COLLAPSED_APP_KEY, "1");
    expect(storage?.getItem(RIGHT_PANEL_DEFAULT_COLLAPSED_KEY)).toBeNull();
  });

  test("save writes app_settings and clears legacy localStorage", async () => {
    storage?.setItem(RIGHT_PANEL_DEFAULT_COLLAPSED_KEY, "0");
    await saveRightPanelDefaultCollapsed(true);
    expect(setAppSetting).toHaveBeenCalledWith(RIGHT_PANEL_DEFAULT_COLLAPSED_APP_KEY, "1");
    expect(storage?.getItem(RIGHT_PANEL_DEFAULT_COLLAPSED_KEY)).toBeNull();
  });

  test("save dispatches browser event when window exists", async () => {
    const seen: boolean[] = [];
    const handler = (e: Event) => {
      const collapsed = (e as CustomEvent<{ collapsed: boolean }>).detail?.collapsed;
      if (typeof collapsed === "boolean") seen.push(collapsed);
    };
    window.addEventListener(WISE_RIGHT_PANEL_DEFAULT_CHANGED, handler);
    try {
      await saveRightPanelDefaultCollapsed(false);
      expect(seen).toEqual([false]);
    } finally {
      window.removeEventListener(WISE_RIGHT_PANEL_DEFAULT_CHANGED, handler);
    }
  });
});
