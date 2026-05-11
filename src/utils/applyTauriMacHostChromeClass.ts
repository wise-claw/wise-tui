import { isTauri } from "@tauri-apps/api/core";

/**
 * Tauri macOS 叠加标题栏下，WKWebView 往往不触发 `window-controls-overlay` 媒体查询，
 * 通过 `html` 类名驱动 CSS，为左栏顶部 `.app-left-sidebar-topbar` 预留红绿灯安全区。
 */
export function applyTauriMacHostChromeClass(): void {
  if (typeof document === "undefined") return;
  if (!isTauri()) return;
  if (!/\bMac\b/.test(navigator.userAgent)) return;
  document.documentElement.classList.add("app-host-macos-chrome");
}
