/**
 * 右侧面板启动默认收起/展开：持久化在 SQLite `app_settings`。
 * 首次加载若库内无数据，会从 legacy `localStorage` 一次性迁入并清除浏览器副本。
 */
import { getAppSetting, setAppSetting } from "./appSettingsStore";
import {
  RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK,
  RIGHT_PANEL_DEFAULT_COLLAPSED_KEY,
} from "../utils/rightPanelStorage";

export const RIGHT_PANEL_DEFAULT_COLLAPSED_APP_KEY = "wise.rightPanel.defaultCollapsed.v1";

/** 配置中心或顶栏保存默认右栏状态后派发，供布局 hook 热更新。 */
export const WISE_RIGHT_PANEL_DEFAULT_CHANGED = "wise:right-panel-default-changed";

function legacyLocalStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
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
    const raw = storage.getItem(RIGHT_PANEL_DEFAULT_COLLAPSED_KEY);
    if (raw === null) return null;
    return raw === "1" || raw === "true";
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

function parseStoredCollapsed(raw: string | null | undefined): boolean | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  if (trimmed === "1" || trimmed === "true") return true;
  if (trimmed === "0" || trimmed === "false") return false;
  return null;
}

export async function loadRightPanelDefaultCollapsed(
  fallback: boolean = RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK,
): Promise<boolean> {
  const fromDb = parseStoredCollapsed(await getAppSetting(RIGHT_PANEL_DEFAULT_COLLAPSED_APP_KEY));
  if (fromDb !== null) return fromDb;

  const fromLegacy = readLegacyLocalStorageCollapsed();
  if (fromLegacy !== null) {
    await saveRightPanelDefaultCollapsed(fromLegacy);
    return fromLegacy;
  }

  return fallback;
}

export async function saveRightPanelDefaultCollapsed(collapsed: boolean): Promise<void> {
  await setAppSetting(RIGHT_PANEL_DEFAULT_COLLAPSED_APP_KEY, collapsed ? "1" : "0");
  clearLegacyLocalStorage();
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(WISE_RIGHT_PANEL_DEFAULT_CHANGED, { detail: { collapsed } }),
    );
  }
}
