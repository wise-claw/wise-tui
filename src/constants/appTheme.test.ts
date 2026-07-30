import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  WISE_THEME_MODE_STORAGE_KEY,
  isWiseThemeMode,
  nextThemeModeOnToggle,
  parseWiseThemeMode,
  readSystemPrefersDark,
  readThemeModeFromStorage,
  resolveThemeDark,
  writeThemeModeToStorage,
} from "./appTheme";

function installWindowStub(options?: { prefersDark?: boolean; matchMediaThrows?: boolean }): Storage {
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
    value: {
      localStorage: stub,
      matchMedia: (query: string) => {
        if (options?.matchMediaThrows) throw new Error("matchMedia unavailable");
        return { matches: Boolean(options?.prefersDark) && query.includes("dark") };
      },
    },
    configurable: true,
  });
  return stub;
}

describe("isWiseThemeMode / parseWiseThemeMode", () => {
  it("accepts only the three known modes", () => {
    expect(isWiseThemeMode("light")).toBe(true);
    expect(isWiseThemeMode("dark")).toBe(true);
    expect(isWiseThemeMode("system")).toBe(true);
    expect(isWiseThemeMode("auto")).toBe(false);
    expect(isWiseThemeMode(null)).toBe(false);
  });

  it("falls back to system for unknown or corrupt values", () => {
    expect(parseWiseThemeMode("dark")).toBe("dark");
    expect(parseWiseThemeMode("nope")).toBe("system");
    expect(parseWiseThemeMode(undefined)).toBe("system");
    expect(parseWiseThemeMode(42)).toBe("system");
  });
});

describe("resolveThemeDark", () => {
  it("honors explicit modes regardless of system preference", () => {
    expect(resolveThemeDark("dark", false)).toBe(true);
    expect(resolveThemeDark("light", true)).toBe(false);
  });

  it("defers to system preference in system mode", () => {
    expect(resolveThemeDark("system", true)).toBe(true);
    expect(resolveThemeDark("system", false)).toBe(false);
  });
});

describe("nextThemeModeOnToggle", () => {
  it("flips explicit modes", () => {
    expect(nextThemeModeOnToggle("light", false)).toBe("dark");
    expect(nextThemeModeOnToggle("dark", false)).toBe("light");
  });

  it("lands on an explicit mode opposite to what system currently renders", () => {
    expect(nextThemeModeOnToggle("system", true)).toBe("light");
    expect(nextThemeModeOnToggle("system", false)).toBe("dark");
  });
});

describe("storage and system probes", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = installWindowStub({ prefersDark: true });
    storage.clear();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("reads system mode when nothing is stored", () => {
    expect(readThemeModeFromStorage()).toBe("system");
  });

  it("round-trips a stored mode", () => {
    writeThemeModeToStorage("dark");
    expect(storage.getItem(WISE_THEME_MODE_STORAGE_KEY)).toBe("dark");
    expect(readThemeModeFromStorage()).toBe("dark");
  });

  it("sanitizes a corrupt stored mode", () => {
    storage.setItem(WISE_THEME_MODE_STORAGE_KEY, "midnight");
    expect(readThemeModeFromStorage()).toBe("system");
  });

  it("reads the system dark preference", () => {
    expect(readSystemPrefersDark()).toBe(true);
  });

  it("treats a throwing matchMedia as light", () => {
    installWindowStub({ matchMediaThrows: true });
    expect(readSystemPrefersDark()).toBe(false);
  });
});

describe("without a window (SSR / worker)", () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("degrades to system mode and light appearance", () => {
    expect(readThemeModeFromStorage()).toBe("system");
    expect(readSystemPrefersDark()).toBe(false);
    expect(() => writeThemeModeToStorage("dark")).not.toThrow();
  });
});
