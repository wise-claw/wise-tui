import { useSyncExternalStore } from "react";
import {
  WISE_THEME_DOM_ATTRIBUTE,
  nextThemeModeOnToggle,
  readSystemPrefersDark,
  readThemeModeFromStorage,
  resolveThemeDark,
  writeThemeModeToStorage,
  type WiseThemeMode,
} from "../constants/appTheme";

/**
 * 应用外观全局状态：模式（浅/深/跟随系统）+ 解析后的实际深浅。
 *
 * 放在 store 而不是 AppImpl useState，是因为主窗口与吉祥物窗口、以及
 * 配置面板/Topbar 多处都要读写，且需要在 React 之外同步 `<html>` 属性。
 */

export type AppThemeState = {
  mode: WiseThemeMode;
  systemPrefersDark: boolean;
  /** 最终生效的深浅，UI 只需读这个。 */
  dark: boolean;
};

const listeners = new Set<() => void>();

let mode: WiseThemeMode = readThemeModeFromStorage();
let systemPrefersDark = readSystemPrefersDark();

/** useSyncExternalStore 要求未变化时返回同一引用，否则无限重渲。 */
let snapshot: AppThemeState = {
  mode,
  systemPrefersDark,
  dark: resolveThemeDark(mode, systemPrefersDark),
};

function syncSnapshot(): AppThemeState {
  const dark = resolveThemeDark(mode, systemPrefersDark);
  if (
    snapshot.mode === mode &&
    snapshot.systemPrefersDark === systemPrefersDark &&
    snapshot.dark === dark
  ) {
    return snapshot;
  }
  snapshot = { mode, systemPrefersDark, dark };
  return snapshot;
}

/**
 * CSS 侧需要在 AntD 之外也能分叉（毛玻璃高光、终端、代码块等），
 * 因此把结果写到 `<html>`；`color-scheme` 让原生滚动条/表单控件跟随。
 */
function applyThemeToDocument(dark: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute(WISE_THEME_DOM_ATTRIBUTE, dark ? "dark" : "light");
  root.style.colorScheme = dark ? "dark" : "light";
}

function emit(): void {
  const next = syncSnapshot();
  applyThemeToDocument(next.dark);
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

export function getAppThemeState(): AppThemeState {
  return syncSnapshot();
}

export function subscribeAppTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setAppThemeMode(next: WiseThemeMode): void {
  if (mode === next) return;
  mode = next;
  writeThemeModeToStorage(next);
  emit();
}

/** Topbar 快捷开关：跟随系统时按当前呈现取反并落到显式模式。 */
export function toggleAppTheme(): void {
  setAppThemeMode(nextThemeModeOnToggle(mode, systemPrefersDark));
}

let systemWatchDisposer: (() => void) | null = null;

/**
 * 订阅系统深色偏好变化。幂等，重复调用返回同一个 disposer 语义（后者为 no-op），
 * 由主窗口入口调用一次即可。
 */
export function startSystemThemeWatch(): () => void {
  if (systemWatchDisposer) return systemWatchDisposer;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  let query: MediaQueryList;
  try {
    query = window.matchMedia("(prefers-color-scheme: dark)");
  } catch {
    return () => {};
  }
  const onChange = (event: MediaQueryListEvent): void => {
    if (systemPrefersDark === event.matches) return;
    systemPrefersDark = event.matches;
    // 显式浅/深模式下系统变化不该改变呈现，但仍要更新快照供「跟随系统」标签用。
    emit();
  };
  query.addEventListener("change", onChange);
  systemWatchDisposer = () => {
    query.removeEventListener("change", onChange);
    systemWatchDisposer = null;
  };
  return systemWatchDisposer;
}

/** 入口处调用：把持久化的模式立即刷到 `<html>`，避免首帧闪白。 */
export function bootstrapAppTheme(): void {
  applyThemeToDocument(syncSnapshot().dark);
}

export function useAppTheme(): AppThemeState {
  return useSyncExternalStore(subscribeAppTheme, getAppThemeState, getAppThemeState);
}
