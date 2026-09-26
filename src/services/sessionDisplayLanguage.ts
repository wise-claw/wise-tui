import {
  DEFAULT_SESSION_DISPLAY_LANGUAGE,
  normalizeSessionDisplayLanguage,
  type SessionDisplayLanguage,
} from "../constants/sessionDisplayLanguage";
import { getAppSetting, setAppSetting } from "./appSettingsStore";

/** `app_settings` 键：会话助手回复语言。 */
export const WISE_SESSION_DISPLAY_LANGUAGE_KEY = "wise.sessionDisplayLanguage.v1";

/** 配置中心保存后广播，供已挂载设置面板同步。 */
export const WISE_SESSION_DISPLAY_LANGUAGE_CHANGED = "wise:session-display-language-changed";

let cachedLanguage: SessionDisplayLanguage = DEFAULT_SESSION_DISPLAY_LANGUAGE;

/** 启动期 hydrate 只需一次；保存时原地刷新，避免每轮对话都走 IPC。 */
let hydrationPromise: Promise<SessionDisplayLanguage> | null = null;

/** 同步读取当前回复语言（未 hydrate 时为默认值）。 */
export function getCachedSessionDisplayLanguage(): SessionDisplayLanguage {
  return cachedLanguage;
}

function applyLanguage(language: SessionDisplayLanguage): SessionDisplayLanguage {
  cachedLanguage = language;
  hydrationPromise = Promise.resolve(language);
  return language;
}

function dispatchSessionDisplayLanguageChanged(language: SessionDisplayLanguage): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISE_SESSION_DISPLAY_LANGUAGE_CHANGED, { detail: { language } }),
  );
}

/** 从 `app_settings` 读取回复语言；脏值回退默认并写入内存缓存。 */
export async function loadSessionDisplayLanguageFromStore(): Promise<SessionDisplayLanguage> {
  try {
    const raw = await getAppSetting(WISE_SESSION_DISPLAY_LANGUAGE_KEY);
    return applyLanguage(normalizeSessionDisplayLanguage(raw));
  } catch {
    return cachedLanguage;
  }
}

/** 启动 / 首次对话前 hydrate，后续 `getCachedSessionDisplayLanguage` 即为最新值。 */
export function ensureSessionDisplayLanguageLoaded(): Promise<SessionDisplayLanguage> {
  hydrationPromise ??= loadSessionDisplayLanguageFromStore();
  return hydrationPromise;
}

export async function saveSessionDisplayLanguageToStore(
  language: SessionDisplayLanguage,
): Promise<void> {
  const normalized = normalizeSessionDisplayLanguage(language);
  await setAppSetting(WISE_SESSION_DISPLAY_LANGUAGE_KEY, normalized);
  applyLanguage(normalized);
  dispatchSessionDisplayLanguageChanged(normalized);
}

/** 仅测试使用：清空内存缓存，模拟冷启动。 */
export function resetSessionDisplayLanguageCacheForTests(): void {
  cachedLanguage = DEFAULT_SESSION_DISPLAY_LANGUAGE;
  hydrationPromise = null;
}
