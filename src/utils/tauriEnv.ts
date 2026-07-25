import { isTauri } from "@tauri-apps/api/core";

/**
 * 运行时是否处于「Tauri IPC 桥存活」状态。
 *
 * 用途一：`visibilitychange` / `beforeunload` 在 webview 关闭/刷新时可能晚于 IPC 桥销毁，
 * 此时继续 `invoke` 会让 fetch 走到已被 Tauri runtime 收回的 ACL 路由，抛
 * "Fetch API cannot load ipc://... due to access control checks"。
 *
 * 用途二：纯浏览器 / CDP 监控环境（如通过 vite dev server 直连 http://localhost:16088
 * 打开页面而非 Tauri webview）下 `window.__TAURI_INTERNALS__` 恒为 undefined，
 * 而 `@tauri-apps/api` 的 `invoke` / `getCurrentWindow` 会**同步**读取
 * `__TAURI_INTERNALS__.invoke` / `.metadata`，同步抛
 * "Cannot read properties of undefined (reading 'invoke'/'metadata')"。
 * 同步抛出发生在 Promise 创建之前，`.catch()` 无法兜底，会直接击穿调用方
 * （未捕获时冒泡为 Unhandled Rejection 或触发 React ErrorBoundary）。
 *
 * 直接检查底层 `__TAURI_INTERNALS__`，比 `isTauri()` 更精准（后者只判断注入标识，
 * 不反映运行时存活）。
 */
export function isTauriIpcAlive(): boolean {
  if (!isTauri()) return false;
  // Tauri 2.x 把内部 invoke / metadata 挂在 window.__TAURI_INTERNALS__ 上；
  // webview 销毁 / IPC 桥关闭 / 非 Tauri 环境时该对象为 undefined。
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ !==
      "undefined"
  );
}
