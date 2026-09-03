import { useSyncExternalStore } from "react";
import {
  parseTerminalThemeMode,
  resolveTerminalDark,
  WISE_TERMINAL_THEME_MODE_CHANGED,
  type TerminalThemeMode,
} from "../constants/terminalThemeMode";
import { getAppThemeState, subscribeAppTheme } from "./appThemeStore";

/**
 * 内置终端主题全局状态：模式（跟随应用 / 浅 / 深）+ 解析后的实际深浅。
 *
 * 与 `appThemeStore` 解耦：用户可在默认配置里把终端钉成浅色，而应用仍用深色。
 * 后端 ANSI 调色板由 `terminalThemeSync` 订阅本 store 后推送。
 */

export type TerminalThemeState = {
  mode: TerminalThemeMode;
  /** 最终生效的深浅（Canvas 兜底色 / 后端调色板 / CSS data 属性共用）。 */
  dark: boolean;
};

const listeners = new Set<() => void>();

let mode: TerminalThemeMode = "follow";
let hydrated = false;

/** useSyncExternalStore 要求未变化时返回同一引用，否则无限重渲。 */
let snapshot: TerminalThemeState = {
  mode,
  dark: resolveTerminalDark(mode, getAppThemeState().dark),
};

function syncSnapshot(): TerminalThemeState {
  const dark = resolveTerminalDark(mode, getAppThemeState().dark);
  if (snapshot.mode === mode && snapshot.dark === dark) {
    return snapshot;
  }
  snapshot = { mode, dark };
  return snapshot;
}

function emit(): void {
  syncSnapshot();
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

export function getTerminalThemeState(): TerminalThemeState {
  return syncSnapshot();
}

export function subscribeTerminalTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 仅更新内存快照；持久化走 `saveTerminalThemeModeToStore`。 */
export function applyTerminalThemeMode(next: TerminalThemeMode): void {
  const normalized = parseTerminalThemeMode(next);
  if (mode === normalized) {
    // 仍要 sync：应用外观可能已变，follow 模式下 dark 会变。
    const before = snapshot.dark;
    syncSnapshot();
    if (snapshot.dark !== before) emit();
    return;
  }
  mode = normalized;
  emit();
}

let bootstrapDisposer: (() => void) | null = null;

/**
 * 从默认配置水合，并订阅应用外观 + 默认配置变更。幂等。
 * 由主窗口入口在 `startTerminalThemeSync` 之前调用。
 */
export function bootstrapTerminalThemeStore(): () => void {
  if (bootstrapDisposer) return bootstrapDisposer;

  const unsubApp = subscribeAppTheme(() => {
    if (mode !== "follow") {
      // 显式浅/深时应用外观变化不改变终端呈现，但仍刷新快照引用无关。
      syncSnapshot();
      return;
    }
    emit();
  });

  const onConfigChanged = (event: Event) => {
    const detail = (event as CustomEvent<{ terminalThemeMode?: unknown }>).detail;
    if (!detail || detail.terminalThemeMode === undefined) return;
    applyTerminalThemeMode(parseTerminalThemeMode(detail.terminalThemeMode));
  };
  if (typeof window !== "undefined") {
    window.addEventListener(WISE_TERMINAL_THEME_MODE_CHANGED, onConfigChanged);
  }

  if (!hydrated) {
    hydrated = true;
    void import("../services/wiseDefaultConfigStore")
      .then(({ loadWiseDefaultConfig }) => loadWiseDefaultConfig())
      .then((config) => {
        applyTerminalThemeMode(config.terminalThemeMode);
      })
      .catch((error) => {
        console.warn("hydrate terminal theme mode failed", error);
      });
  }

  bootstrapDisposer = () => {
    unsubApp();
    if (typeof window !== "undefined") {
      window.removeEventListener(WISE_TERMINAL_THEME_MODE_CHANGED, onConfigChanged);
    }
    bootstrapDisposer = null;
  };
  return bootstrapDisposer;
}

export function useTerminalTheme(): TerminalThemeState {
  return useSyncExternalStore(subscribeTerminalTheme, getTerminalThemeState, getTerminalThemeState);
}
