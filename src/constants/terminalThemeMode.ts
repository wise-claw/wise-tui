/**
 * 内置终端主题模式（与应用外观解耦）。
 *
 * - `follow`：跟随应用解析后的浅/深
 * - `light` / `dark`：强制 Catppuccin Latte / Mocha
 */

export type TerminalThemeMode = "follow" | "light" | "dark";

/** 默认配置变更时通知终端主题 store，独立于大型配置模块以保持启动入口轻量。 */
export const WISE_TERMINAL_THEME_MODE_CHANGED = "wise:terminal-theme-mode-changed";

export const TERMINAL_THEME_MODES: readonly TerminalThemeMode[] = [
  "follow",
  "light",
  "dark",
] as const;

export const TERMINAL_THEME_MODE_LABELS: Readonly<Record<TerminalThemeMode, string>> = {
  follow: "跟随应用",
  light: "浅色",
  dark: "深色",
};

/** 挂在 `.terminal-panel` 上，驱动 `--terminal-*` CSS 变量，不依赖应用 `data-wise-theme`。 */
export const TERMINAL_THEME_DOM_ATTRIBUTE = "data-terminal-theme";

export function isTerminalThemeMode(value: unknown): value is TerminalThemeMode {
  return value === "follow" || value === "light" || value === "dark";
}

/** 未知/损坏值回落到跟随应用，保持与历史「跟随外观」行为一致。 */
export function parseTerminalThemeMode(raw: unknown): TerminalThemeMode {
  return isTerminalThemeMode(raw) ? raw : "follow";
}

export function resolveTerminalDark(mode: TerminalThemeMode, appDark: boolean): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return appDark;
}
