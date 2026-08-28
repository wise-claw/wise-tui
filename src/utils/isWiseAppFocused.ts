import { getWiseHudModeActive } from "../stores/wiseHudModeStore";

/** 当前 Wise 主 WebView 是否处于系统焦点（非 Tauri / 测试环境恒为 true）。 */
export function isWiseAppFocused(): boolean {
  if (typeof document === "undefined") return true;
  return document.hasFocus();
}

/**
 * HUD 占用焦点并把主窗 hide 之后，主窗 `document.hasFocus()` 为 false。
 * 全局 claude-output/complete 若仍按焦点丢弃，HUD 发出的回合就只剩用户气泡。
 */
export function shouldAcceptBackgroundClaudeStream(): boolean {
  return isWiseAppFocused() || getWiseHudModeActive();
}
