/**
 * 工作台「默认配置」：统一写入 SQLite `app_settings`（`wise.defaultConfig.v1` JSON）。
 * 首次加载会从 legacy 分键与 `localStorage` 一次性迁入并清除旧副本。
 */
import type { ClaudeSession } from "../types";
import {
  DEFAULT_LEFT_SIDEBAR_HUB_QUICK_ENTRIES,
  normalizeLeftSidebarHubQuickEntries,
  type LeftSidebarHubQuickEntryId,
} from "../constants/leftSidebarHubQuickEntries";
import { RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK, RIGHT_PANEL_DEFAULT_COLLAPSED_KEY } from "../utils/rightPanelStorage";
import { deleteAppSetting, getAppSetting, setAppSetting, setAppSettingJson } from "./appSettingsStore";

export type ClaudeSessionConnectionKind = NonNullable<ClaudeSession["connectionKind"]>;

export const WISE_DEFAULT_CONFIG_KEY = "wise.defaultConfig.v1";

/** 一次性：产品默认由逐轮改为长驻后，将已持久化的 `oneshot` 升为 `streaming`。 */
export const WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY =
  "wise.defaultConfig.oneshotToStreaming.v1";

/** @deprecated 迁移后删除；读路径仅用于迁入 `wise.defaultConfig.v1`。 */
export const CLAUDE_DEFAULT_CONNECTION_KIND_KEY = "wise.claudeDefaultConnectionKind.v1";

/** @deprecated 迁移后删除；读路径仅用于迁入 `wise.defaultConfig.v1`。 */
export const RIGHT_PANEL_DEFAULT_COLLAPSED_APP_KEY = "wise.rightPanel.defaultCollapsed.v1";

export const CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK: ClaudeSessionConnectionKind = "streaming";

export const WISE_CLAUDE_CONNECTION_KIND_CHANGED = "wise:claude-connection-kind-changed";

export const WISE_RIGHT_PANEL_DEFAULT_CHANGED = "wise:right-panel-default-changed";

export const WISE_TOPBAR_CHROME_DEFAULT_CHANGED = "wise:topbar-chrome-default-changed";

export const WISE_LEFT_SIDEBAR_HUB_QUICK_ENTRIES_CHANGED = "wise:left-sidebar-hub-quick-entries-changed";

export const WISE_LEFT_SIDEBAR_MONITOR_PANEL_CHANGED = "wise:left-sidebar-monitor-panel-changed";

export interface WiseDefaultConfigV1 {
  version: 1;
  connectionKind: ClaudeSessionConnectionKind;
  rightPanelDefaultCollapsed: boolean;
  /** 主会话顶栏 LLM 代理图标；默认隐藏。 */
  showLlmProxyTopbar: boolean;
  /** 主会话顶栏 Free Claude Code 图标；默认隐藏。 */
  showFccTopbar: boolean;
  /** 主会话顶栏 FCC 请求流量图标；默认隐藏。 */
  showFccTrafficTopbar: boolean;
  /** 主会话顶栏全链路分析图标；默认隐藏。 */
  showSessionDataLinkTopbar: boolean;
  /** 左栏 AI 工作台快捷入口；默认 MCP、技能、自动化。 */
  leftSidebarHubQuickEntries: LeftSidebarHubQuickEntryId[];
  /** 左栏运行面板（终端 / 工作流运行态）；默认显示。 */
  showLeftSidebarMonitorPanel: boolean;
}

const DEFAULT_CONFIG: WiseDefaultConfigV1 = {
  version: 1,
  connectionKind: CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK,
  rightPanelDefaultCollapsed: RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK,
  showLlmProxyTopbar: false,
  showFccTopbar: false,
  showFccTrafficTopbar: false,
  showSessionDataLinkTopbar: false,
  leftSidebarHubQuickEntries: [...DEFAULT_LEFT_SIDEBAR_HUB_QUICK_ENTRIES],
  showLeftSidebarMonitorPanel: true,
};

function normalizeBoolean(raw: unknown, fallback = false): boolean {
  if (raw === true || raw === false) return raw;
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (trimmed === "1" || trimmed === "true") return true;
  if (trimmed === "0" || trimmed === "false") return false;
  return fallback;
}

function normalizeConnectionKind(raw: unknown): ClaudeSessionConnectionKind | null {
  return raw === "streaming" || raw === "oneshot" ? raw : null;
}

function normalizeRightPanelCollapsed(raw: unknown): boolean | null {
  if (raw === true || raw === false) return raw;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "1" || trimmed === "true") return true;
  if (trimmed === "0" || trimmed === "false") return false;
  return null;
}

function parseConfigJson(raw: string | null | undefined): WiseDefaultConfigV1 | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WiseDefaultConfigV1>;
    const connectionKind = normalizeConnectionKind(parsed.connectionKind);
    const rightPanelDefaultCollapsed = normalizeRightPanelCollapsed(parsed.rightPanelDefaultCollapsed);
    if (connectionKind === null || rightPanelDefaultCollapsed === null) return null;
    return {
      version: 1,
      connectionKind,
      rightPanelDefaultCollapsed,
      showLlmProxyTopbar: normalizeBoolean(parsed.showLlmProxyTopbar),
      showFccTopbar:
        parsed.showFccTopbar === undefined
          ? DEFAULT_CONFIG.showFccTopbar
          : normalizeBoolean(parsed.showFccTopbar),
      showFccTrafficTopbar: normalizeBoolean(parsed.showFccTrafficTopbar),
      showSessionDataLinkTopbar: normalizeBoolean(parsed.showSessionDataLinkTopbar),
      leftSidebarHubQuickEntries: normalizeLeftSidebarHubQuickEntries(parsed.leftSidebarHubQuickEntries),
      showLeftSidebarMonitorPanel:
        parsed.showLeftSidebarMonitorPanel === undefined
          ? DEFAULT_CONFIG.showLeftSidebarMonitorPanel
          : normalizeBoolean(parsed.showLeftSidebarMonitorPanel, DEFAULT_CONFIG.showLeftSidebarMonitorPanel),
    };
  } catch {
    return null;
  }
}

function legacyLocalStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
    if (typeof globalThis !== "undefined" && "localStorage" in globalThis) {
      return globalThis.localStorage;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function readLegacyLocalStorageCollapsed(): boolean | null {
  const storage = legacyLocalStorage();
  if (!storage) return null;
  try {
    return normalizeRightPanelCollapsed(storage.getItem(RIGHT_PANEL_DEFAULT_COLLAPSED_KEY));
  } catch {
    return null;
  }
}

function clearLegacyLocalStorage(): void {
  const storage = legacyLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(RIGHT_PANEL_DEFAULT_COLLAPSED_KEY);
  } catch {
    /* ignore */
  }
}

async function deleteLegacyAppSettings(): Promise<void> {
  await Promise.all([
    deleteAppSetting(CLAUDE_DEFAULT_CONNECTION_KIND_KEY).catch(() => {}),
    deleteAppSetting(RIGHT_PANEL_DEFAULT_COLLAPSED_APP_KEY).catch(() => {}),
  ]);
}

async function persistConfig(config: WiseDefaultConfigV1): Promise<void> {
  await setAppSettingJson(WISE_DEFAULT_CONFIG_KEY, config);
}

function dispatchConnectionKindChanged(kind: ClaudeSessionConnectionKind): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WISE_CLAUDE_CONNECTION_KIND_CHANGED, { detail: { kind } }));
}

function dispatchRightPanelDefaultChanged(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WISE_RIGHT_PANEL_DEFAULT_CHANGED, { detail: { collapsed } }));
}

function dispatchTopbarChromeDefaultChanged(
  config: Pick<
    WiseDefaultConfigV1,
    | "showLlmProxyTopbar"
    | "showFccTopbar"
    | "showFccTrafficTopbar"
    | "showSessionDataLinkTopbar"
  >,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_TOPBAR_CHROME_DEFAULT_CHANGED, {
      detail: {
        showLlmProxyTopbar: config.showLlmProxyTopbar,
        showFccTopbar: config.showFccTopbar,
        showFccTrafficTopbar: config.showFccTrafficTopbar,
        showSessionDataLinkTopbar: config.showSessionDataLinkTopbar,
      },
    }),
  );
}

async function migrateLegacyConfig(): Promise<WiseDefaultConfigV1 | null> {
  let connectionKind: ClaudeSessionConnectionKind | null = null;
  let rightPanelDefaultCollapsed: boolean | null = null;

  const legacyConnection = normalizeConnectionKind(await getAppSetting(CLAUDE_DEFAULT_CONNECTION_KIND_KEY));
  if (legacyConnection) connectionKind = legacyConnection;

  const legacyRightPanel = normalizeRightPanelCollapsed(
    await getAppSetting(RIGHT_PANEL_DEFAULT_COLLAPSED_APP_KEY),
  );
  if (legacyRightPanel !== null) rightPanelDefaultCollapsed = legacyRightPanel;

  const legacyLocalRight = readLegacyLocalStorageCollapsed();
  if (legacyLocalRight !== null) rightPanelDefaultCollapsed = legacyLocalRight;

  if (connectionKind === null && rightPanelDefaultCollapsed === null) return null;

  return {
    version: 1,
    connectionKind: connectionKind ?? DEFAULT_CONFIG.connectionKind,
    rightPanelDefaultCollapsed:
      rightPanelDefaultCollapsed ?? DEFAULT_CONFIG.rightPanelDefaultCollapsed,
    showLlmProxyTopbar: DEFAULT_CONFIG.showLlmProxyTopbar,
    showFccTopbar: DEFAULT_CONFIG.showFccTopbar,
    showFccTrafficTopbar: DEFAULT_CONFIG.showFccTrafficTopbar,
    showSessionDataLinkTopbar: DEFAULT_CONFIG.showSessionDataLinkTopbar,
    leftSidebarHubQuickEntries: [...DEFAULT_LEFT_SIDEBAR_HUB_QUICK_ENTRIES],
    showLeftSidebarMonitorPanel: DEFAULT_CONFIG.showLeftSidebarMonitorPanel,
  };
}

function dispatchLeftSidebarHubQuickEntriesChanged(entries: LeftSidebarHubQuickEntryId[]): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_LEFT_SIDEBAR_HUB_QUICK_ENTRIES_CHANGED, {
      detail: { leftSidebarHubQuickEntries: entries },
    }),
  );
}

function dispatchLeftSidebarMonitorPanelChanged(visible: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_LEFT_SIDEBAR_MONITOR_PANEL_CHANGED, {
      detail: { showLeftSidebarMonitorPanel: visible },
    }),
  );
}

/** 将旧版代码默认写入库的 `oneshot` 升为当前产品默认 `streaming`（仅执行一次）。 */
async function maybeUpgradeOneshotDefaultToStreaming(
  config: WiseDefaultConfigV1,
): Promise<WiseDefaultConfigV1> {
  if (config.connectionKind !== "oneshot") return config;
  if ((await getAppSetting(WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY)) === "1") {
    return config;
  }
  const next: WiseDefaultConfigV1 = { ...config, connectionKind: "streaming" };
  await persistConfig(next);
  await setAppSetting(WISE_DEFAULT_CONFIG_ONESHOT_TO_STREAMING_MIGRATION_KEY, "1");
  dispatchConnectionKindChanged("streaming");
  return next;
}

/** 从 `app_settings` 读取默认配置；无记录时写入默认值并返回。 */
export async function loadWiseDefaultConfig(): Promise<WiseDefaultConfigV1> {
  const fromJson = parseConfigJson(await getAppSetting(WISE_DEFAULT_CONFIG_KEY));
  if (fromJson) {
    return await maybeUpgradeOneshotDefaultToStreaming(fromJson);
  }

  const migrated = await migrateLegacyConfig();
  const resolved = migrated ?? DEFAULT_CONFIG;
  await persistConfig(resolved);
  await deleteLegacyAppSettings();
  clearLegacyLocalStorage();
  return await maybeUpgradeOneshotDefaultToStreaming(resolved);
}

export async function saveWiseDefaultConfig(
  patch: Partial<
    Pick<
      WiseDefaultConfigV1,
      | "connectionKind"
      | "rightPanelDefaultCollapsed"
      | "showLlmProxyTopbar"
      | "showFccTopbar"
      | "showFccTrafficTopbar"
      | "showSessionDataLinkTopbar"
      | "leftSidebarHubQuickEntries"
      | "showLeftSidebarMonitorPanel"
    >
  >,
): Promise<WiseDefaultConfigV1> {
  const current = await loadWiseDefaultConfig();
  const next: WiseDefaultConfigV1 = {
    version: 1,
    connectionKind: patch.connectionKind ?? current.connectionKind,
    rightPanelDefaultCollapsed:
      patch.rightPanelDefaultCollapsed ?? current.rightPanelDefaultCollapsed,
    showLlmProxyTopbar: patch.showLlmProxyTopbar ?? current.showLlmProxyTopbar,
    showFccTopbar: patch.showFccTopbar ?? current.showFccTopbar,
    showFccTrafficTopbar: patch.showFccTrafficTopbar ?? current.showFccTrafficTopbar,
    showSessionDataLinkTopbar:
      patch.showSessionDataLinkTopbar ?? current.showSessionDataLinkTopbar,
    leftSidebarHubQuickEntries:
      patch.leftSidebarHubQuickEntries !== undefined
        ? normalizeLeftSidebarHubQuickEntries(patch.leftSidebarHubQuickEntries)
        : current.leftSidebarHubQuickEntries,
    showLeftSidebarMonitorPanel:
      patch.showLeftSidebarMonitorPanel ?? current.showLeftSidebarMonitorPanel,
  };
  if (patch.connectionKind !== undefined) {
    next.connectionKind = normalizeConnectionKind(patch.connectionKind) ?? current.connectionKind;
  }
  if (patch.showLlmProxyTopbar !== undefined) {
    next.showLlmProxyTopbar = normalizeBoolean(patch.showLlmProxyTopbar);
  }
  if (patch.showFccTopbar !== undefined) {
    next.showFccTopbar = normalizeBoolean(patch.showFccTopbar);
  }
  if (patch.showFccTrafficTopbar !== undefined) {
    next.showFccTrafficTopbar = normalizeBoolean(patch.showFccTrafficTopbar);
  }
  if (patch.showSessionDataLinkTopbar !== undefined) {
    next.showSessionDataLinkTopbar = normalizeBoolean(patch.showSessionDataLinkTopbar);
  }
  if (patch.leftSidebarHubQuickEntries !== undefined) {
    next.leftSidebarHubQuickEntries = normalizeLeftSidebarHubQuickEntries(patch.leftSidebarHubQuickEntries);
  }
  if (patch.showLeftSidebarMonitorPanel !== undefined) {
    next.showLeftSidebarMonitorPanel = normalizeBoolean(patch.showLeftSidebarMonitorPanel);
  }
  await persistConfig(next);
  await deleteLegacyAppSettings();
  clearLegacyLocalStorage();

  if (patch.connectionKind !== undefined && next.connectionKind !== current.connectionKind) {
    dispatchConnectionKindChanged(next.connectionKind);
  }
  if (
    patch.rightPanelDefaultCollapsed !== undefined &&
    next.rightPanelDefaultCollapsed !== current.rightPanelDefaultCollapsed
  ) {
    dispatchRightPanelDefaultChanged(next.rightPanelDefaultCollapsed);
  }
  if (
    patch.showLlmProxyTopbar !== undefined ||
    patch.showFccTopbar !== undefined ||
    patch.showFccTrafficTopbar !== undefined ||
    patch.showSessionDataLinkTopbar !== undefined
  ) {
    if (
      next.showLlmProxyTopbar !== current.showLlmProxyTopbar ||
      next.showFccTopbar !== current.showFccTopbar ||
      next.showFccTrafficTopbar !== current.showFccTrafficTopbar ||
      next.showSessionDataLinkTopbar !== current.showSessionDataLinkTopbar
    ) {
      dispatchTopbarChromeDefaultChanged({
        showLlmProxyTopbar: next.showLlmProxyTopbar,
        showFccTopbar: next.showFccTopbar,
        showFccTrafficTopbar: next.showFccTrafficTopbar,
        showSessionDataLinkTopbar: next.showSessionDataLinkTopbar,
      });
    }
  }
  if (
    patch.leftSidebarHubQuickEntries !== undefined &&
    JSON.stringify(next.leftSidebarHubQuickEntries) !== JSON.stringify(current.leftSidebarHubQuickEntries)
  ) {
    dispatchLeftSidebarHubQuickEntriesChanged(next.leftSidebarHubQuickEntries);
  }
  if (
    patch.showLeftSidebarMonitorPanel !== undefined &&
    next.showLeftSidebarMonitorPanel !== current.showLeftSidebarMonitorPanel
  ) {
    dispatchLeftSidebarMonitorPanelChanged(next.showLeftSidebarMonitorPanel);
  }

  return next;
}

export async function loadLeftSidebarHubQuickEntriesFromStore(): Promise<LeftSidebarHubQuickEntryId[]> {
  return [...(await loadWiseDefaultConfig()).leftSidebarHubQuickEntries];
}

export async function saveLeftSidebarHubQuickEntriesToStore(
  entries: LeftSidebarHubQuickEntryId[],
): Promise<void> {
  await saveWiseDefaultConfig({ leftSidebarHubQuickEntries: entries });
}

export async function loadLeftSidebarMonitorPanelVisibleFromStore(): Promise<boolean> {
  return (await loadWiseDefaultConfig()).showLeftSidebarMonitorPanel;
}

export async function saveLeftSidebarMonitorPanelVisibleToStore(visible: boolean): Promise<void> {
  await saveWiseDefaultConfig({ showLeftSidebarMonitorPanel: visible });
}

export async function loadDefaultClaudeConnectionKindFromStore(): Promise<ClaudeSessionConnectionKind> {
  return (await loadWiseDefaultConfig()).connectionKind;
}

export async function saveDefaultClaudeConnectionKindToStore(
  kind: ClaudeSessionConnectionKind,
): Promise<void> {
  const normalized = normalizeConnectionKind(kind);
  if (!normalized) return;
  await saveWiseDefaultConfig({ connectionKind: normalized });
}

export async function loadRightPanelDefaultCollapsedFromStore(
  fallback: boolean = RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK,
): Promise<boolean> {
  const fromStore = (await loadWiseDefaultConfig()).rightPanelDefaultCollapsed;
  return typeof fromStore === "boolean" ? fromStore : fallback;
}

export async function saveRightPanelDefaultCollapsedToStore(collapsed: boolean): Promise<void> {
  await saveWiseDefaultConfig({ rightPanelDefaultCollapsed: collapsed });
}

/** @alias loadRightPanelDefaultCollapsedFromStore */
export const loadRightPanelDefaultCollapsed = loadRightPanelDefaultCollapsedFromStore;

/** @alias saveRightPanelDefaultCollapsedToStore */
export const saveRightPanelDefaultCollapsed = saveRightPanelDefaultCollapsedToStore;

export async function loadTopbarChromeDefaultsFromStore(): Promise<
  Pick<
    WiseDefaultConfigV1,
    | "showLlmProxyTopbar"
    | "showFccTopbar"
    | "showFccTrafficTopbar"
    | "showSessionDataLinkTopbar"
  >
> {
  const config = await loadWiseDefaultConfig();
  return {
    showLlmProxyTopbar: config.showLlmProxyTopbar,
    showFccTopbar: config.showFccTopbar,
    showFccTrafficTopbar: config.showFccTrafficTopbar,
    showSessionDataLinkTopbar: config.showSessionDataLinkTopbar,
  };
}

export async function saveTopbarChromeDefaultsToStore(
  patch: Partial<
    Pick<
      WiseDefaultConfigV1,
      | "showLlmProxyTopbar"
      | "showFccTopbar"
      | "showFccTrafficTopbar"
      | "showSessionDataLinkTopbar"
    >
  >,
): Promise<void> {
  await saveWiseDefaultConfig(patch);
}
