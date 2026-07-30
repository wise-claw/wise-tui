/**
 * 应用外观（浅色 / 深色 / 跟随系统）的纯常量与解析helpers。
 *
 * 只负责「模式 → 是否深色」的解析和 localStorage 读写；订阅与副作用在
 * `src/stores/appThemeStore.ts`，AntD token 生成在 `appThemeTokens.ts`。
 */

export type WiseThemeMode = "light" | "dark" | "system";

export const WISE_THEME_MODES: readonly WiseThemeMode[] = ["light", "dark", "system"] as const;

export const WISE_THEME_MODE_STORAGE_KEY = "wise.appearance.themeMode.v1";

/**
 * 挂在 `<html>` 上，供 CSS 侧 `:root[data-wise-theme="dark"]` 覆盖自定义变量。
 * AntD 自身的 `--ant-color-*` 由 ConfigProvider algorithm 注入，不走这个属性。
 */
export const WISE_THEME_DOM_ATTRIBUTE = "data-wise-theme";

export const WISE_THEME_MODE_LABELS: Readonly<Record<WiseThemeMode, string>> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};

export function isWiseThemeMode(value: unknown): value is WiseThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

/** 未知/损坏的持久化值回落到跟随系统，而不是硬钉浅色。 */
export function parseWiseThemeMode(raw: unknown): WiseThemeMode {
  return isWiseThemeMode(raw) ? raw : "system";
}

export function resolveThemeDark(mode: WiseThemeMode, systemPrefersDark: boolean): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return systemPrefersDark;
}

/** 「切换」语义：跟随系统时按当前实际呈现取反，落到显式模式。 */
export function nextThemeModeOnToggle(mode: WiseThemeMode, systemPrefersDark: boolean): WiseThemeMode {
  return resolveThemeDark(mode, systemPrefersDark) ? "light" : "dark";
}

export function readThemeModeFromStorage(): WiseThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    return parseWiseThemeMode(window.localStorage.getItem(WISE_THEME_MODE_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function writeThemeModeToStorage(mode: WiseThemeMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WISE_THEME_MODE_STORAGE_KEY, mode);
  } catch {
    /* ignore quota / private mode */
  }
}

export function readSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}
