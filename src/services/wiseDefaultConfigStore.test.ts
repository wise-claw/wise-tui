import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

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
  getCachedDefaultExecutionEngine,
  saveWiseDefaultConfig,
  WISE_DEFAULT_CONFIG_KEY,
  WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY,
  WISE_DEFAULT_EXECUTION_ENGINE_CHANGED,
  WISE_LEFT_SIDEBAR_MONITOR_PANEL_CHANGED,
  WISE_LEFT_SIDEBAR_WORKSPACE_LIST_CHANGED,
  WISE_LEFT_SIDEBAR_REQUIREMENTS_PANEL_CHANGED,
  WISE_MONITOR_PANEL_PLACEMENT_CHANGED,
  WISE_WORKSPACE_LIST_PLACEMENT_CHANGED,
  WISE_TOPBAR_CHROME_DEFAULT_CHANGED,
  WISE_COMPOSER_FOOTER_CHROME_DEFAULT_CHANGED,
  WISE_WORKSPACE_INSPECTOR_PANELS_CHANGED,
  WISE_WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT_CHANGED,
  WISE_TERMINAL_THEME_MODE_CHANGED,
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
    expect(config.defaultExecutionEngine).toBe("claude");
    expect(config.showLlmProxyTopbar).toBe(false);
    expect(config.leftSidebarHubQuickEntries).toEqual(["mcp", "skills", "automation"]);
    expect(config.showLeftSidebarMonitorPanel).toBe(true);
    expect(config.showLeftSidebarWorkspaceList).toBe(true);
    expect(config.showLeftSidebarRequirementsPanel).toBe(true);
    expect(config.requirementsPanelVisibleRows).toBe(6);
    expect(config.showRepositoryIconBadgesInWorkspaceList).toBe(false);
    expect(config.workspaceListPlacement).toBe("top");
    expect(config.monitorPanelPlacement).toBe("left");
    expect(config.showWorkspaceQuickActionsPanel).toBe(true);
    expect(config.showWorkspaceTodosPanel).toBe(false);
    expect(config.showRemoteEntryTopbar).toBe(true);
    expect(config.showTopbarRepositoryName).toBe(false);
    expect(config.fileTreeOpenInNewPane).toBe(false);
    expect(config.showComposerFooterAttachButton).toBe(true);
    expect(config.showComposerFooterScreenshotButton).toBe(true);
    expect(config.showComposerFooterVoiceButton).toBe(true);
    expect(config.showComposerFooterContextRing).toBe(true);
    expect(config.showComposerFooterCommonPhrases).toBe(true);
    expect(config.showComposerFooterRuntimeSettings).toBe(true);
    expect(config.showComposerFooterModelPicker).toBe(true);
    expect(config.composerFooterTriggerDisplayMode).toBe("full");
    expect(config.gitPanelPlacement).toBe("visible");
    expect(config.filesPanelPlacement).toBe("visible");
    expect(config.terminalThemeMode).toBe("follow");
    expect(setAppSetting).toHaveBeenCalled();
    const payload = JSON.parse(String(setAppSetting.mock.calls[0]?.[1]));
    expect(payload).toMatchObject({
      version: 1,
      connectionKind: "streaming",
      defaultExecutionEngine: "claude",
      showLlmProxyTopbar: false,
      leftSidebarHubQuickEntries: ["mcp", "skills", "automation"],
      showLeftSidebarMonitorPanel: true,
      monitorPanelPlacement: "left",
    });
  });

  test("load upgrades persisted oneshot default to streaming once", async () => {
    getAppSetting.mockImplementation(async (key: string) => {
      if (key === WISE_DEFAULT_CONFIG_KEY) {
        return JSON.stringify({
          version: 1,
          connectionKind: "oneshot",
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
          })
        : null,
    );
    const config = await loadWiseDefaultConfig();
    expect(config.connectionKind).toBe("streaming");
  });

  test("load backfills missing monitor panel visibility with product default", async () => {
    getAppSetting.mockImplementation(async (key: string) =>
      key === WISE_DEFAULT_CONFIG_KEY
        ? JSON.stringify({
            version: 1,
            connectionKind: "streaming",
          })
        : null,
    );
    const config = await loadWiseDefaultConfig();
    expect(config.showLeftSidebarMonitorPanel).toBe(true);
    expect(config.monitorPanelPlacement).toBe("left");
  });

  test("save monitor panel visibility dispatches event", async () => {
    getAppSetting.mockImplementation(async (key: string) => {
      if (key === WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY) return "1";
      if (key === WISE_DEFAULT_CONFIG_KEY) {
        return JSON.stringify({
          version: 1,
          connectionKind: "streaming",
          showLeftSidebarMonitorPanel: true,
        });
      }
      return null;
    });
    const seen: boolean[] = [];
    window.addEventListener(WISE_LEFT_SIDEBAR_MONITOR_PANEL_CHANGED, (e: Event) => {
      const visible = (e as CustomEvent<{ showLeftSidebarMonitorPanel?: boolean }>).detail
        ?.showLeftSidebarMonitorPanel;
      if (typeof visible === "boolean") seen.push(visible);
    });
    await saveWiseDefaultConfig({ showLeftSidebarMonitorPanel: false });
    expect(seen).toEqual([false]);
  });

  test("save workspace list visibility dispatches event", async () => {
    getAppSetting.mockImplementation(async (key: string) => {
      if (key === WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY) return "1";
      if (key === WISE_DEFAULT_CONFIG_KEY) {
        return JSON.stringify({
          version: 1,
          connectionKind: "streaming",
          showLeftSidebarWorkspaceList: true,
        });
      }
      return null;
    });
    const seen: boolean[] = [];
    window.addEventListener(WISE_LEFT_SIDEBAR_WORKSPACE_LIST_CHANGED, (e: Event) => {
      const visible = (e as CustomEvent<{ showLeftSidebarWorkspaceList?: boolean }>).detail
        ?.showLeftSidebarWorkspaceList;
      if (typeof visible === "boolean") seen.push(visible);
    });
    await saveWiseDefaultConfig({ showLeftSidebarWorkspaceList: false });
    expect(seen).toEqual([false]);
  });

  test("save requirements panel visibility dispatches event", async () => {
    getAppSetting.mockImplementation(async (key: string) => {
      if (key === WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY) return "1";
      if (key === WISE_DEFAULT_CONFIG_KEY) {
        return JSON.stringify({
          version: 1,
          connectionKind: "streaming",
          showLeftSidebarRequirementsPanel: true,
        });
      }
      return null;
    });
    const seen: boolean[] = [];
    window.addEventListener(WISE_LEFT_SIDEBAR_REQUIREMENTS_PANEL_CHANGED, (e: Event) => {
      const visible = (e as CustomEvent<{ showLeftSidebarRequirementsPanel?: boolean }>).detail
        ?.showLeftSidebarRequirementsPanel;
      if (typeof visible === "boolean") seen.push(visible);
    });
    await saveWiseDefaultConfig({ showLeftSidebarRequirementsPanel: false });
    expect(seen).toEqual([false]);
  });

  test("save workspace list placement dispatches event", async () => {
    getAppSetting.mockImplementation(async (key: string) => {
      if (key === WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY) return "1";
      if (key === WISE_DEFAULT_CONFIG_KEY) {
        return JSON.stringify({
          version: 1,
          connectionKind: "streaming",
          workspaceListPlacement: "top",
        });
      }
      return null;
    });
    const seen: string[] = [];
    window.addEventListener(WISE_WORKSPACE_LIST_PLACEMENT_CHANGED, (e: Event) => {
      const placement = (e as CustomEvent<{ workspaceListPlacement?: string }>).detail
        ?.workspaceListPlacement;
      if (placement === "top" || placement === "bottom") seen.push(placement);
    });
    await saveWiseDefaultConfig({ workspaceListPlacement: "bottom" });
    expect(seen).toEqual(["bottom"]);
  });

  test("save monitor panel placement dispatches event", async () => {
    getAppSetting.mockImplementation(async (key: string) => {
      if (key === WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY) return "1";
      if (key === WISE_DEFAULT_CONFIG_KEY) {
        return JSON.stringify({
          version: 1,
          connectionKind: "streaming",
          monitorPanelPlacement: "left",
        });
      }
      return null;
    });
    const seen: string[] = [];
    window.addEventListener(WISE_MONITOR_PANEL_PLACEMENT_CHANGED, (e: Event) => {
      const placement = (e as CustomEvent<{ monitorPanelPlacement?: string }>).detail
        ?.monitorPanelPlacement;
      if (placement === "left" || placement === "right") seen.push(placement);
    });
    await saveWiseDefaultConfig({ monitorPanelPlacement: "right" });
    expect(seen).toEqual(["right"]);
  });

  test("load backfills missing defaultExecutionEngine with product default", async () => {
    getAppSetting.mockImplementation(async (key: string) =>
      key === WISE_DEFAULT_CONFIG_KEY
        ? JSON.stringify({
            version: 1,
            connectionKind: "streaming",
          })
        : null,
    );
    const config = await loadWiseDefaultConfig();
    expect(config.defaultExecutionEngine).toBe("claude");
  });

  test("load normalizes invalid defaultExecutionEngine to claude", async () => {
    getAppSetting.mockImplementation(async (key: string) =>
      key === WISE_DEFAULT_CONFIG_KEY
        ? JSON.stringify({
            version: 1,
            connectionKind: "streaming",
            defaultExecutionEngine: "not-an-engine",
          })
        : null,
    );
    const config = await loadWiseDefaultConfig();
    expect(config.defaultExecutionEngine).toBe("claude");
  });

  test("load refreshes cached default execution engine", async () => {
    getAppSetting.mockImplementation(async (key: string) =>
      key === WISE_DEFAULT_CONFIG_KEY
        ? JSON.stringify({
            version: 1,
            connectionKind: "streaming",
            defaultExecutionEngine: "opencode",
          })
        : null,
    );
    const config = await loadWiseDefaultConfig();
    expect(config.defaultExecutionEngine).toBe("opencode");
    expect(getCachedDefaultExecutionEngine()).toBe("opencode");
  });

  test("save default execution engine persists and dispatches event", async () => {
    getAppSetting.mockImplementation(async (key: string) => {
      if (key === WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY) return "1";
      if (key === WISE_DEFAULT_CONFIG_KEY) {
        return JSON.stringify({
          version: 1,
          connectionKind: "streaming",
          defaultExecutionEngine: "claude",
        });
      }
      return null;
    });
    const seen: string[] = [];
    window.addEventListener(WISE_DEFAULT_EXECUTION_ENGINE_CHANGED, (e: Event) => {
      const engine = (e as CustomEvent<{ engine?: string }>).detail?.engine;
      if (typeof engine === "string") seen.push(engine);
    });
    const config = await saveWiseDefaultConfig({ defaultExecutionEngine: "codex" });
    expect(config.defaultExecutionEngine).toBe("codex");
    expect(seen).toEqual(["codex"]);
    const persisted = JSON.parse(String(setAppSetting.mock.calls.at(-1)?.[1]));
    expect(persisted.defaultExecutionEngine).toBe("codex");
  });

  test("load backfills missing topbar chrome fields with product defaults", async () => {
    getAppSetting.mockImplementation(async (key: string) =>
      key === WISE_DEFAULT_CONFIG_KEY
        ? JSON.stringify({
            version: 1,
            connectionKind: "streaming",
          })
        : null,
    );
    const config = await loadWiseDefaultConfig();
    expect(config.showLlmProxyTopbar).toBe(false);
    expect(config.showFccTopbar).toBe(false);
    expect(config.showFccTrafficTopbar).toBe(false);
    expect(config.showOpencodeProxyTopbar).toBe(false);
    expect(config.showSessionDataLinkTopbar).toBe(true);
    expect(config.showSessionFeedbackLoopTopbar).toBe(true);
    expect(config.showRemoteEntryTopbar).toBe(true);
    expect(config.showTopbarRepositoryName).toBe(true);
  });

  test("save topbar chrome dispatches visibility event", async () => {
    getAppSetting.mockImplementation(async (key: string) => {
      if (key === WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY) return "1";
      if (key === WISE_DEFAULT_CONFIG_KEY) {
        return JSON.stringify({
          version: 1,
          connectionKind: "streaming",
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

  test("save composer footer chrome dispatches visibility event", async () => {
    getAppSetting.mockImplementation(async (key: string) => {
      if (key === WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY) return "1";
      if (key === WISE_DEFAULT_CONFIG_KEY) {
        return JSON.stringify({
          version: 1,
          connectionKind: "streaming",
          showComposerFooterAttachButton: true,
        });
      }
      return null;
    });
    const seen: Array<{ showComposerFooterAttachButton: boolean }> = [];
    window.addEventListener(WISE_COMPOSER_FOOTER_CHROME_DEFAULT_CHANGED, (e: Event) => {
      const detail = (e as CustomEvent<{ showComposerFooterAttachButton?: boolean }>).detail;
      if (detail) {
        seen.push({
          showComposerFooterAttachButton: Boolean(detail.showComposerFooterAttachButton),
        });
      }
    });
    await saveWiseDefaultConfig({
      showComposerFooterAttachButton: false,
    });
    expect(seen).toEqual([{ showComposerFooterAttachButton: false }]);
  });

  test("save composer footer trigger display mode dispatches visibility event", async () => {
    getAppSetting.mockImplementation(async (key: string) => {
      if (key === WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY) return "1";
      if (key === WISE_DEFAULT_CONFIG_KEY) {
        return JSON.stringify({
          version: 1,
          connectionKind: "streaming",
          composerFooterTriggerDisplayMode: "full",
        });
      }
      return null;
    });
    const seen: Array<{ composerFooterTriggerDisplayMode?: string }> = [];
    window.addEventListener(WISE_COMPOSER_FOOTER_CHROME_DEFAULT_CHANGED, (e: Event) => {
      const detail = (e as CustomEvent<{ composerFooterTriggerDisplayMode?: string }>).detail;
      if (detail) {
        seen.push({ composerFooterTriggerDisplayMode: detail.composerFooterTriggerDisplayMode });
      }
    });
    await saveWiseDefaultConfig({ composerFooterTriggerDisplayMode: "icon" });
    expect(seen).toEqual([{ composerFooterTriggerDisplayMode: "icon" }]);
    const lastCall = setAppSetting.mock.calls.at(-1);
    expect(JSON.parse(String(lastCall?.[1]))).toMatchObject({
      composerFooterTriggerDisplayMode: "icon",
    });
  });

  test("load backfills missing or invalid composer footer trigger display mode with full", async () => {
    getAppSetting.mockImplementation(async (key: string) =>
      key === WISE_DEFAULT_CONFIG_KEY
        ? JSON.stringify({
            version: 1,
            connectionKind: "streaming",
            composerFooterTriggerDisplayMode: "bogus",
          })
        : null,
    );
    const config = await loadWiseDefaultConfig();
    expect(config.composerFooterTriggerDisplayMode).toBe("full");
  });

  test("save terminal theme mode dispatches change event", async () => {
    getAppSetting.mockImplementation(async (key: string) => {
      if (key === WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY) return "1";
      if (key === WISE_DEFAULT_CONFIG_KEY) {
        return JSON.stringify({
          version: 1,
          connectionKind: "streaming",
          terminalThemeMode: "follow",
        });
      }
      return null;
    });
    const seen: Array<{ terminalThemeMode?: string }> = [];
    window.addEventListener(WISE_TERMINAL_THEME_MODE_CHANGED, (e: Event) => {
      const detail = (e as CustomEvent<{ terminalThemeMode?: string }>).detail;
      if (detail) {
        seen.push({ terminalThemeMode: detail.terminalThemeMode });
      }
    });
    await saveWiseDefaultConfig({ terminalThemeMode: "light" });
    expect(seen).toEqual([{ terminalThemeMode: "light" }]);
    const lastCall = setAppSetting.mock.calls.at(-1);
    expect(JSON.parse(String(lastCall?.[1]))).toMatchObject({
      terminalThemeMode: "light",
    });
  });

  test("load backfills missing or invalid terminal theme mode with follow", async () => {
    getAppSetting.mockImplementation(async (key: string) =>
      key === WISE_DEFAULT_CONFIG_KEY
        ? JSON.stringify({
            version: 1,
            connectionKind: "streaming",
            terminalThemeMode: "bogus",
          })
        : null,
    );
    const config = await loadWiseDefaultConfig();
    expect(config.terminalThemeMode).toBe("follow");
  });

  test("load backfills missing workspace inspector panels with product defaults", async () => {
    getAppSetting.mockImplementation(async (key: string) =>
      key === WISE_DEFAULT_CONFIG_KEY
        ? JSON.stringify({
            version: 1,
            connectionKind: "streaming",
          })
        : null,
    );
    const config = await loadWiseDefaultConfig();
    expect(config.showWorkspaceQuickActionsPanel).toBe(true);
    expect(config.showWorkspaceTodosPanel).toBe(false);
    expect(config.showComposerFooterAttachButton).toBe(true);
    expect(config.showComposerFooterModelPicker).toBe(true);
  });

  test("save workspace inspector panels dispatches event", async () => {
    getAppSetting.mockImplementation(async (key: string) => {
      if (key === WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY) return "1";
      if (key === WISE_DEFAULT_CONFIG_KEY) {
        return JSON.stringify({
          version: 1,
          connectionKind: "streaming",
          showWorkspaceTodosPanel: true,
        });
      }
      return null;
    });
    const seen: Array<{ showWorkspaceTodosPanel?: boolean }> = [];
    window.addEventListener(WISE_WORKSPACE_INSPECTOR_PANELS_CHANGED, (e: Event) => {
      seen.push((e as CustomEvent<{ showWorkspaceTodosPanel?: boolean }>).detail ?? {});
    });
    await saveWiseDefaultConfig({ showWorkspaceTodosPanel: false });
    expect(seen.at(-1)?.showWorkspaceTodosPanel).toBe(false);
  });

  test("load backfills missing workspace sidebar row preview limit with product default", async () => {
    getAppSetting.mockImplementation(async (key: string) =>
      key === WISE_DEFAULT_CONFIG_KEY
        ? JSON.stringify({
            version: 1,
            connectionKind: "streaming",
          })
        : null,
    );
    const config = await loadWiseDefaultConfig();
    expect(config.workspaceSidebarRowPreviewLimit).toBe(3);
  });

  test("save workspace sidebar row preview limit clamps and dispatches event", async () => {
    getAppSetting.mockImplementation(async (key: string) => {
      if (key === WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY) return "1";
      if (key === WISE_DEFAULT_CONFIG_KEY) {
        return JSON.stringify({
          version: 1,
          connectionKind: "streaming",
          workspaceSidebarRowPreviewLimit: 3,
        });
      }
      return null;
    });
    const seen: number[] = [];
    window.addEventListener(WISE_WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT_CHANGED, (e: Event) => {
      const limit = (e as CustomEvent<{ workspaceSidebarRowPreviewLimit?: number }>).detail
        ?.workspaceSidebarRowPreviewLimit;
      if (typeof limit === "number") seen.push(limit);
    });
    const next = await saveWiseDefaultConfig({ workspaceSidebarRowPreviewLimit: 99 });
    expect(next.workspaceSidebarRowPreviewLimit).toBe(10);
    expect(seen).toEqual([10]);
  });
});
