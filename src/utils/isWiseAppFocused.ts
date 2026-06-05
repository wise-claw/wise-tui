/** 当前 Wise 主 WebView 是否处于系统焦点（非 Tauri / 测试环境恒为 true）。 */
export function isWiseAppFocused(): boolean {
  if (typeof document === "undefined") return true;
  return document.hasFocus();
}
