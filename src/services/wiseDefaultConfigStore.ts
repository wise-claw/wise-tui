/**
 * 工作台「默认配置」：统一写入 SQLite `app_settings`（`wise.defaultConfig.v1` JSON）。
 * 首次加载会从 legacy 分键与 `localStorage` 一次性迁入并清除旧副本。
 */
import type { ClaudeSession } from "../types";
import { RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK, RIGHT_PANEL_DEFAULT_COLLAPSED_KEY } from "../utils/rightPanelStorage";
import { deleteAppSetting, getAppSetting, setAppSettingJson } from "./appSettingsStore";

export type ClaudeSessionConnectionKind = NonNullable<ClaudeSession["connectionKind"]>;

export const WISE_DEFAULT_CONFIG_KEY = "wise.defaultConfig.v1";

/** @deprecated 迁移后删除；读路径仅用于迁入 `wise.defaultConfig.v1`。 */
export const CLAUDE_DEFAULT_CONNECTION_KIND_KEY = "wise.claudeDefaultConnectionKind.v1";

/** @deprecated 迁移后删除；读路径仅用于迁入 `wise.defaultConfig.v1`。 */
export const RIGHT_PANEL_DEFAULT_COLLAPSED_APP_KEY = "wise.rightPanel.defaultCollapsed.v1";

export const CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK: ClaudeSessionConnectionKind = "oneshot";

export const WISE_CLAUDE_CONNECTION_KIND_CHANGED = "wise:claude-connection-kind-changed";

export const WISE_RIGHT_PANEL_DEFAULT_CHANGED = "wise:right-panel-default-changed";

export interface WiseDefaultConfigV1 {
  version: 1;
  connectionKind: ClaudeSessionConnectionKind;
  rightPanelDefaultCollapsed: boolean;
}

const DEFAULT_CONFIG: WiseDefaultConfigV1 = {
  version: 1,
  connectionKind: CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK,
  rightPanelDefaultCollapsed: RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK,
};

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
    return { version: 1, connectionKind, rightPanelDefaultCollapsed };
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
  };
}

/** 从 `app_settings` 读取默认配置；无记录时写入默认值并返回。 */
export async function loadWiseDefaultConfig(): Promise<WiseDefaultConfigV1> {
  const fromJson = parseConfigJson(await getAppSetting(WISE_DEFAULT_CONFIG_KEY));
  if (fromJson) return fromJson;

  const migrated = await migrateLegacyConfig();
  const resolved = migrated ?? DEFAULT_CONFIG;
  await persistConfig(resolved);
  await deleteLegacyAppSettings();
  clearLegacyLocalStorage();
  return resolved;
}

export async function saveWiseDefaultConfig(
  patch: Partial<Pick<WiseDefaultConfigV1, "connectionKind" | "rightPanelDefaultCollapsed">>,
): Promise<WiseDefaultConfigV1> {
  const current = await loadWiseDefaultConfig();
  const next: WiseDefaultConfigV1 = {
    version: 1,
    connectionKind: patch.connectionKind ?? current.connectionKind,
    rightPanelDefaultCollapsed:
      patch.rightPanelDefaultCollapsed ?? current.rightPanelDefaultCollapsed,
  };
  if (patch.connectionKind !== undefined) {
    next.connectionKind = normalizeConnectionKind(patch.connectionKind) ?? current.connectionKind;
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

  return next;
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
