import { invoke } from "@tauri-apps/api/core";

export async function getAppSetting(key: string): Promise<string | null> {
  const normalized = key.trim();
  if (!normalized) return null;
  try {
    const value = await invoke<string | null>("get_app_setting", { key: normalized });
    return value ?? null;
  } catch {
    return null;
  }
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  const normalized = key.trim();
  if (!normalized) return;
  await invoke("set_app_setting", { key: normalized, value });
}

export async function deleteAppSetting(key: string): Promise<void> {
  const normalized = key.trim();
  if (!normalized) return;
  await invoke("delete_app_setting", { key: normalized });
}

/** 单次 IPC 批量读取 app_settings，用于窗口启动等冷路径。 */
export async function getAppSettingsBatch(
  keys: string[],
): Promise<Record<string, string | null>> {
  const normalized = [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
  if (normalized.length === 0) return {};
  try {
    const raw = await invoke<Record<string, string | null>>("get_app_settings_batch", {
      keys: normalized,
    });
    return raw ?? {};
  } catch {
    return Object.fromEntries(normalized.map((key) => [key, null]));
  }
}

export async function getAppSettingJson<T>(key: string): Promise<T | null> {
  const raw = await getAppSetting(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setAppSettingJson(key: string, payload: unknown): Promise<void> {
  const raw = JSON.stringify(payload);
  await setAppSetting(key, raw);
}
