/** Reloads the webview window (works in both Tauri WebView and browser). */
export async function reloadAppWindow(): Promise<void> {
  window.location.reload();
}
