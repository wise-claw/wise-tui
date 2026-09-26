import { beforeEach, describe, expect, mock, test } from "bun:test";

const getAppSetting = mock(async () => null as string | null);
const setAppSetting = mock(async () => undefined);

mock.module("./appSettingsStore", () => ({
  getAppSetting,
  setAppSetting,
}));

import {
  ensureSessionDisplayLanguageLoaded,
  getCachedSessionDisplayLanguage,
  loadSessionDisplayLanguageFromStore,
  resetSessionDisplayLanguageCacheForTests,
  saveSessionDisplayLanguageToStore,
  WISE_SESSION_DISPLAY_LANGUAGE_CHANGED,
  WISE_SESSION_DISPLAY_LANGUAGE_KEY,
} from "./sessionDisplayLanguage";

function installWindowStub(): { dispatched: Array<{ type: string; detail: unknown }> } {
  const dispatched: Array<{ type: string; detail: unknown }> = [];
  Object.defineProperty(globalThis, "window", {
    value: {
      dispatchEvent: (event: Event) => {
        const custom = event as CustomEvent<unknown>;
        dispatched.push({ type: event.type, detail: custom.detail });
        return true;
      },
    },
    configurable: true,
  });
  return { dispatched };
}

describe("sessionDisplayLanguage store", () => {
  beforeEach(() => {
    resetSessionDisplayLanguageCacheForTests();
    getAppSetting.mockReset();
    getAppSetting.mockImplementation(async () => null);
    setAppSetting.mockReset();
    setAppSetting.mockImplementation(async () => undefined);
    Reflect.deleteProperty(globalThis, "window");
  });

  test("load falls back to auto for missing or dirty values", async () => {
    expect(await loadSessionDisplayLanguageFromStore()).toBe("auto");
    getAppSetting.mockImplementation(async () => "not-a-language");
    expect(await loadSessionDisplayLanguageFromStore()).toBe("auto");
    expect(getCachedSessionDisplayLanguage()).toBe("auto");
  });

  test("load keeps a stored language and refreshes the cache", async () => {
    getAppSetting.mockImplementation(async () => "zh-CN");
    expect(await loadSessionDisplayLanguageFromStore()).toBe("zh-CN");
    expect(getCachedSessionDisplayLanguage()).toBe("zh-CN");
    expect(getAppSetting).toHaveBeenCalledWith(WISE_SESSION_DISPLAY_LANGUAGE_KEY);
  });

  test("save persists normalized value, updates cache and broadcasts", async () => {
    const { dispatched } = installWindowStub();
    await saveSessionDisplayLanguageToStore("en");
    expect(setAppSetting).toHaveBeenCalledWith(WISE_SESSION_DISPLAY_LANGUAGE_KEY, "en");
    expect(getCachedSessionDisplayLanguage()).toBe("en");
    expect(dispatched).toEqual([
      { type: WISE_SESSION_DISPLAY_LANGUAGE_CHANGED, detail: { language: "en" } },
    ]);
  });

  test("hydration reads app settings only once", async () => {
    getAppSetting.mockImplementation(async () => "ja");
    expect(await ensureSessionDisplayLanguageLoaded()).toBe("ja");
    expect(await ensureSessionDisplayLanguageLoaded()).toBe("ja");
    expect(getAppSetting).toHaveBeenCalledTimes(1);
  });
});
