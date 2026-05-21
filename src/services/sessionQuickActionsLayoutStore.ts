/**
 * 会话快捷操作布局：持久化在 SQLite `app_settings`（经 Tauri `get_app_setting` / `set_app_setting`）。
 * 首次加载时若库内无数据，会从 legacy `localStorage` 一次性迁入并清除浏览器副本。
 */
import {
  DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT,
  ensurePrdSplitQuickActionPrimary,
  mergeSessionQuickActionsLayout,
  parseSessionQuickActionsLayout,
  SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY,
  SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY_V1,
  type SessionQuickActionsLayoutV1,
} from "../constants/sessionQuickActionsLayout";
import { deleteAppSetting, getAppSetting, setAppSettingJson } from "./appSettingsStore";

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

function readLegacyLocalStorageRaw(): { v2: string | null; v1: string | null } {
  const storage = legacyLocalStorage();
  if (!storage) {
    return { v2: null, v1: null };
  }
  try {
    return {
      v2: storage.getItem(SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY),
      v1: storage.getItem(SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY_V1),
    };
  } catch {
    return { v2: null, v1: null };
  }
}

function clearLegacyLocalStorage(): void {
  const storage = legacyLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY);
    storage.removeItem(SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY_V1);
  } catch {
    /* ignore */
  }
}

function normalizeForPersist(layout: SessionQuickActionsLayoutV1): SessionQuickActionsLayoutV1 {
  return mergeSessionQuickActionsLayout(layout);
}

export async function loadSessionQuickActionsLayout(): Promise<SessionQuickActionsLayoutV1> {
  const rawV2 = await getAppSetting(SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY);
  if (rawV2?.trim()) {
    return parseSessionQuickActionsLayout(rawV2);
  }

  const rawV1 = await getAppSetting(SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY_V1);
  if (rawV1?.trim()) {
    const migrated = ensurePrdSplitQuickActionPrimary(parseSessionQuickActionsLayout(rawV1));
    await saveSessionQuickActionsLayout(migrated);
    await deleteAppSetting(SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY_V1).catch(() => {});
    return migrated;
  }

  const { v2, v1 } = readLegacyLocalStorageRaw();
  const localRaw = v2?.trim() ? v2 : v1;
  if (localRaw?.trim()) {
    const migrated = ensurePrdSplitQuickActionPrimary(parseSessionQuickActionsLayout(localRaw));
    await saveSessionQuickActionsLayout(migrated);
    clearLegacyLocalStorage();
    return migrated;
  }

  return mergeSessionQuickActionsLayout(DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT);
}

export async function saveSessionQuickActionsLayout(layout: SessionQuickActionsLayoutV1): Promise<void> {
  const normalized = normalizeForPersist(layout);
  await setAppSettingJson(SESSION_QUICK_ACTIONS_LAYOUT_STORAGE_KEY, normalized);
}
