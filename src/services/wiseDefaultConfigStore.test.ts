import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { RIGHT_PANEL_DEFAULT_COLLAPSED_KEY } from "../utils/rightPanelStorage";

const getAppSetting = mock(async () => null as string | null);
const setAppSetting = mock(async () => undefined);
const deleteAppSetting = mock(async () => undefined);

mock.module("./appSettingsStore", () => ({
  getAppSetting,
  setAppSetting,
  setAppSettingJson: async (key: string, payload: unknown) => {
    await setAppSetting(key, JSON.stringify(payload));
  },
  deleteAppSetting,
}));

import {
  loadWiseDefaultConfig,
  saveWiseDefaultConfig,
  WISE_DEFAULT_CONFIG_KEY,
  WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY,
  WISE_RIGHT_PANEL_DEFAULT_CHANGED,
  WISE_TOPBAR_CHROME_DEFAULT_CHANGED,
} from "./wiseDefaultConfigStore";

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
  return stub;
}

describe("wiseDefaultConfigStore", () => {
  let storage: Storage | null = null;

  beforeEach(() => {
    storage = installWindowLocalStorageStub();
    storage.clear();
    getAppSetting.mockReset();
    getAppSetting.mockImplementation(async () => null);
    setAppSetting.mockReset();
    setAppSetting.mockImplementation(async () => undefined);
    deleteAppSetting.mockReset();
    deleteAppSetting.mockImplementation(async () => undefined);
  });

  afterEach(() => {
    storage?.clear();
    Reflect.deleteProperty(globalThis, "window");
    storage = null;
  });

  test("load persists code defaults when unset", async () => {
    const config = await loadWiseDefaultConfig();
    expect(config.connectionKind).toBe("streaming");
    expect(config.rightPanelDefaultCollapsed).toBe(false);
    expect(config.showLlmProxyTopbar).toBe(false);
    expect(config.leftSidebarHubQuickEntries).toEqual(["mcp", "skills", "automation"]);
    expect(setAppSetting).toHaveBeenCalled();
    const payload = JSON.parse(String(setAppSetting.mock.calls[0]?.[1]));
    expect(payload).toMatchObject({
      version: 1,
      connectionKind: "streaming",
      rightPanelDefaultCollapsed: false,
      showLlmProxyTopbar: false,
      leftSidebarHubQuickEntries: ["mcp", "skills", "automation"],
    });
  });

  test("load upgrades persisted oneshot default to streaming once", async () => {
    getAppSetting.mockImplementation(async (key: string) => {
      if (key === WISE_DEFAULT_CONFIG_KEY) {
        return JSON.stringify({
          version: 1,
          connectionKind: "oneshot",
          rightPanelDefaultCollapsed: false,
        });
      }
      if (key === WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY) return null;
      return null;
    });
    const config = await loadWiseDefaultConfig();
    expect(config.connectionKind).toBe("streaming");
    expect(setAppSetting).toHaveBeenCalledWith(
      WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY,
      "1",
    );
  });

  test("load does not re-upgrade oneshot after migration flag is set", async () => {
    getAppSetting.mockImplementation(async (key: string) => {
      if (key === WISE_DEFAULT_CONFIG_KEY) {
        return JSON.stringify({
          version: 1,
          connectionKind: "oneshot",
          rightPanelDefaultCollapsed: false,
        });
      }
      if (key === WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY) return "1";
      return null;
    });
    const config = await loadWiseDefaultConfig();
    expect(config.connectionKind).toBe("oneshot");
  });

  test("load prefers unified json key", async () => {
    getAppSetting.mockImplementation(async (key: string) =>
      key === WISE_DEFAULT_CONFIG_KEY
        ? JSON.stringify({
            version: 1,
            connectionKind: "streaming",
            rightPanelDefaultCollapsed: true,
          })
        : null,
    );
    const config = await loadWiseDefaultConfig();
    expect(config.connectionKind).toBe("streaming");
    expect(config.rightPanelDefaultCollapsed).toBe(true);
  });

  test("load migrates legacy keys and localStorage into unified key", async () => {
    getAppSetting.mockImplementation(async (key: string) => {
      if (key === "wise.claudeDefaultConnectionKind.v1") return "streaming";
      if (key === "wise.rightPanel.defaultCollapsed.v1") return "1";
      return null;
    });
    const config = await loadWiseDefaultConfig();
    expect(config.connectionKind).toBe("streaming");
    expect(config.rightPanelDefaultCollapsed).toBe(true);
    expect(deleteAppSetting).toHaveBeenCalled();
  });

  test("save updates unified json and dispatches right panel event", async () => {
    getAppSetting.mockImplementation(async (key: string) => {
      if (key === WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY) return "1";
      if (key === WISE_DEFAULT_CONFIG_KEY) {
        return JSON.stringify({
          version: 1,
          connectionKind: "oneshot",
          rightPanelDefaultCollapsed: false,
        });
      }
      return null;
    });
    const seen: boolean[] = [];
    window.addEventListener(WISE_RIGHT_PANEL_DEFAULT_CHANGED, (e: Event) => {
      const collapsed = (e as CustomEvent<{ collapsed: boolean }>).detail?.collapsed;
      if (typeof collapsed === "boolean") seen.push(collapsed);
    });
    await saveWiseDefaultConfig({ rightPanelDefaultCollapsed: true });
    expect(seen).toEqual([true]);
    const lastCall = setAppSetting.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe(WISE_DEFAULT_CONFIG_KEY);
    expect(JSON.parse(String(lastCall?.[1]))).toMatchObject({
      version: 1,
      connectionKind: "oneshot",
      rightPanelDefaultCollapsed: true,
    });
    expect(storage?.getItem(RIGHT_PANEL_DEFAULT_COLLAPSED_KEY)).toBeNull();
  });

  test("load backfills missing topbar chrome fields with product defaults", async () => {
    getAppSetting.mockImplementation(async (key: string) =>
      key === WISE_DEFAULT_CONFIG_KEY
        ? JSON.stringify({
            version: 1,
            connectionKind: "streaming",
            rightPanelDefaultCollapsed: false,
          })
        : null,
    );
    const config = await loadWiseDefaultConfig();
    expect(config.showLlmProxyTopbar).toBe(false);
    expect(config.showFccTopbar).toBe(true);
    expect(config.showFccTrafficTopbar).toBe(false);
    expect(config.showSessionDataLinkTopbar).toBe(false);
  });

  test("save topbar chrome dispatches visibility event", async () => {
    getAppSetting.mockImplementation(async (key: string) => {
      if (key === WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY) return "1";
      if (key === WISE_DEFAULT_CONFIG_KEY) {
        return JSON.stringify({
          version: 1,
          connectionKind: "streaming",
          rightPanelDefaultCollapsed: false,
          showLlmProxyTopbar: false,
        });
      }
      return null;
    });
    const seen: Array<{ showLlmProxyTopbar: boolean }> = [];
    window.addEventListener(WISE_TOPBAR_CHROME_DEFAULT_CHANGED, (e: Event) => {
      const detail = (e as CustomEvent<{ showLlmProxyTopbar?: boolean }>).detail;
      if (detail) {
        seen.push({
          showLlmProxyTopbar: Boolean(detail.showLlmProxyTopbar),
        });
      }
    });
    await saveWiseDefaultConfig({
      showLlmProxyTopbar: true,
    });
    expect(seen).toEqual([{ showLlmProxyTopbar: true }]);
  });
});
