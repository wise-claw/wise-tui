import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK,
  RIGHT_PANEL_DEFAULT_COLLAPSED_KEY,
  readRightPanelDefaultCollapsedFromStorage,
  writeRightPanelDefaultCollapsedToStorage,
} from "./rightPanelStorage";

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
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: stub },
    configurable: true,
  });
  return stub;
}

describe("rightPanelStorage", () => {
  let storage: Storage | null = null;

  beforeEach(() => {
    storage = installWindowLocalStorageStub();
    storage.clear();
  });

  afterEach(() => {
    storage?.clear();
    Reflect.deleteProperty(globalThis, "window");
    storage = null;
  });

  test("falls back to expanded when unset", () => {
    expect(readRightPanelDefaultCollapsedFromStorage()).toBe(RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK);
    expect(readRightPanelDefaultCollapsedFromStorage()).toBe(false);
  });

  test("persists collapsed preference", () => {
    writeRightPanelDefaultCollapsedToStorage(true);
    expect(storage?.getItem(RIGHT_PANEL_DEFAULT_COLLAPSED_KEY)).toBe("1");
    expect(readRightPanelDefaultCollapsedFromStorage()).toBe(true);

    writeRightPanelDefaultCollapsedToStorage(false);
    expect(storage?.getItem(RIGHT_PANEL_DEFAULT_COLLAPSED_KEY)).toBe("0");
    expect(readRightPanelDefaultCollapsedFromStorage()).toBe(false);
  });

  test("accepts legacy true string", () => {
    storage?.setItem(RIGHT_PANEL_DEFAULT_COLLAPSED_KEY, "true");
    expect(readRightPanelDefaultCollapsedFromStorage()).toBe(true);
  });
});
