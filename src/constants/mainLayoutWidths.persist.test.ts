import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX,
  MAIN_LAYOUT_LEFT_SIDER_WIDTH_STORAGE_KEY,
  MAIN_LAYOUT_LEFT_SIDER_WIDTH_STORAGE_KEY_LEGACY,
  readPersistedLeftSiderWidthFromStorage,
  resolvePersistedLeftSiderWidthPx,
  writePersistedLeftSiderWidthToStorage,
} from "./mainLayoutWidths";

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

describe("resolvePersistedLeftSiderWidthPx", () => {
  it("uses fallback when stored is missing or invalid", () => {
    expect(resolvePersistedLeftSiderWidthPx(null)).toBe(MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX);
    expect(resolvePersistedLeftSiderWidthPx(undefined, 240)).toBe(240);
    expect(resolvePersistedLeftSiderWidthPx(Number.NaN)).toBe(MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX);
  });

  it("snaps prior defaults and sub-default widths to current default", () => {
    expect(resolvePersistedLeftSiderWidthPx(300)).toBe(MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX);
    expect(resolvePersistedLeftSiderWidthPx(280)).toBe(MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX);
    expect(resolvePersistedLeftSiderWidthPx(270)).toBe(MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX);
    expect(resolvePersistedLeftSiderWidthPx(210)).toBe(MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX);
  });

  it("keeps user widths above current default", () => {
    expect(resolvePersistedLeftSiderWidthPx(360)).toBe(360);
    expect(resolvePersistedLeftSiderWidthPx(290)).toBe(290);
  });
});

describe("readPersistedLeftSiderWidthFromStorage", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = installWindowLocalStorageStub();
    storage.clear();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("returns default when nothing stored", () => {
    expect(readPersistedLeftSiderWidthFromStorage()).toBe(MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX);
  });

  it("migrates legacy narrow width to default", () => {
    storage.setItem(MAIN_LAYOUT_LEFT_SIDER_WIDTH_STORAGE_KEY_LEGACY, "210");
    expect(readPersistedLeftSiderWidthFromStorage()).toBe(MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX);
  });

  it("keeps legacy width at or above default", () => {
    storage.setItem(MAIN_LAYOUT_LEFT_SIDER_WIDTH_STORAGE_KEY_LEGACY, "340");
    expect(readPersistedLeftSiderWidthFromStorage()).toBe(340);
  });

  it("prefers v2 and preserves width above current default", () => {
    storage.setItem(MAIN_LAYOUT_LEFT_SIDER_WIDTH_STORAGE_KEY_LEGACY, "210");
    storage.setItem(MAIN_LAYOUT_LEFT_SIDER_WIDTH_STORAGE_KEY, "320");
    expect(readPersistedLeftSiderWidthFromStorage()).toBe(320);
  });

  it("migrates v2 stored prior defaults to current default", () => {
    storage.setItem(MAIN_LAYOUT_LEFT_SIDER_WIDTH_STORAGE_KEY, "300");
    expect(readPersistedLeftSiderWidthFromStorage()).toBe(MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX);
    storage.setItem(MAIN_LAYOUT_LEFT_SIDER_WIDTH_STORAGE_KEY, "280");
    expect(readPersistedLeftSiderWidthFromStorage()).toBe(MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX);
  });

  it("writePersistedLeftSiderWidthToStorage uses v2 key", () => {
    writePersistedLeftSiderWidthToStorage(305);
    expect(storage.getItem(MAIN_LAYOUT_LEFT_SIDER_WIDTH_STORAGE_KEY)).toBe("305");
    expect(storage.getItem(MAIN_LAYOUT_LEFT_SIDER_WIDTH_STORAGE_KEY_LEGACY)).toBeNull();
  });
});
