import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT,
  SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY,
  SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY_V1,
} from "../constants/sessionQuickActionsLayout";

const getAppSetting = mock(async () => null as string | null);
const setAppSettingJson = mock(async () => {});
const deleteAppSetting = mock(async () => {});

mock.module("./appSettingsStore", () => ({
  WISE_CLAUDE_DEFAULT_SETTINGS_KEY: "wise.claudeDefaultSettings.v1",
  WISE_CODEX_DEFAULT_SETTINGS_KEY: "wise.codexDefaultSettings.v1",
  WISE_OPENCODE_DEFAULT_SETTINGS_KEY: "wise.opencodeDefaultSettings.v1",
  getAppSetting,
  setAppSetting: mock(async () => {}),
  setAppSettingJson,
  deleteAppSetting,
  getAppSettingsBatch: mock(async () => ({})),
  getAppSettingJson: mock(async () => null),
}));

const {
  flushSaveSessionQuickActionsLayout,
  loadSessionQuickActionsLayout,
  resetSessionQuickActionsLayoutPersistForTests,
  saveSessionQuickActionsLayout,
  scheduleSaveSessionQuickActionsLayout,
} = await import("./sessionQuickActionsLayoutStore");

function installLocalStorageStub(): Storage {
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
  Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true });
  return stub;
}

describe("sessionQuickActionsLayoutStore", () => {
  let storage: Storage | null = null;

  beforeEach(() => {
    getAppSetting.mockReset();
    setAppSettingJson.mockReset();
    deleteAppSetting.mockReset();
    resetSessionQuickActionsLayoutPersistForTests();
    storage = installLocalStorageStub();
    storage.clear();
  });

  afterEach(() => {
    resetSessionQuickActionsLayoutPersistForTests();
    storage?.clear();
    Reflect.deleteProperty(globalThis, "localStorage");
    storage = null;
  });

  test("load returns default when database and localStorage are empty", async () => {
    const layout = await loadSessionQuickActionsLayout();
    expect(layout.items.map((item) => item.id)).toEqual(
      DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT.items.map((item) => item.id),
    );
    expect(setAppSettingJson).not.toHaveBeenCalled();
  });

  test("load prefers app_settings v2 payload", async () => {
    getAppSetting.mockImplementation(async (key: string) => {
      if (key === SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY) {
        return JSON.stringify({
          version: 1,
          items: [{ id: "compact-context", visible: true, zone: "primary" }],
        });
      }
      return null;
    });
    const layout = await loadSessionQuickActionsLayout();
    expect(layout.items[0]?.id).toBe("compact-context");
  });

  test("save writes normalized layout to app_settings", async () => {
    await saveSessionQuickActionsLayout(DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT);
    expect(setAppSettingJson).toHaveBeenCalledTimes(1);
    expect(setAppSettingJson.mock.calls[0]?.[0]).toBe(SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY);
    const saved = setAppSettingJson.mock.calls[0]?.[1] as { items: { id: string }[] };
    expect(saved.items.some((item) => item.id === "new-session")).toBe(true);
  });

  test("migrates legacy localStorage into app_settings once", async () => {
    storage!.setItem(
      SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        items: [{ id: "compact-context", visible: true, zone: "primary" }],
      }),
    );
    const layout = await loadSessionQuickActionsLayout();
    expect(layout.items.some((item) => item.id === "compact-context")).toBe(true);
    expect(setAppSettingJson).toHaveBeenCalled();
    expect(storage!.getItem(SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY)).toBeNull();
    expect(storage!.getItem(SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY_V1)).toBeNull();
  });

  test("schedule debounce coalesces to latest layout and flush writes immediately", async () => {
    const first = {
      version: 1 as const,
      items: [{ id: "compact-context", visible: true, zone: "primary" as const }],
    };
    const second = {
      version: 1 as const,
      items: [{ id: "new-session", visible: true, zone: "primary" as const }],
    };
    scheduleSaveSessionQuickActionsLayout(first);
    scheduleSaveSessionQuickActionsLayout(second);
    expect(setAppSettingJson).not.toHaveBeenCalled();

    const ok = await flushSaveSessionQuickActionsLayout();
    expect(ok).toBe(true);
    expect(setAppSettingJson).toHaveBeenCalledTimes(1);
    const saved = setAppSettingJson.mock.calls[0]?.[1] as { items: { id: string }[] };
    expect(saved.items.some((item) => item.id === "new-session")).toBe(true);
  });

  test("flush with explicit layout cancels pending debounce", async () => {
    scheduleSaveSessionQuickActionsLayout({
      version: 1,
      items: [{ id: "compact-context", visible: true, zone: "primary" }],
    });
    const ok = await flushSaveSessionQuickActionsLayout({
      version: 1,
      items: [{ id: "new-session", visible: true, zone: "overflow" }],
    });
    expect(ok).toBe(true);
    expect(setAppSettingJson).toHaveBeenCalledTimes(1);
    const saved = setAppSettingJson.mock.calls[0]?.[1] as { items: { id: string; zone: string }[] };
    expect(saved.items.find((item) => item.id === "new-session")?.zone).toBe("overflow");
  });
});
