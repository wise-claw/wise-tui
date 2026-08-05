import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { bootstrapDompurifyForTauriAssets } from "./bootstrapDompurifyForTauriAssets";
import { applyTauriMacHostChromeClass } from "./utils/applyTauriMacHostChromeClass";
import { ensureTauriEventUnlistenPatched } from "./utils/safeTauriUnlisten";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ensureMainThreadCongestionProbe } from "./stores/mainThreadCongestionStore";
import "./stores/wireAdaptivePollInteractionRelief";
import { bootstrapAppTheme, startSystemThemeWatch } from "./stores/appThemeStore";
import { bootstrapTerminalThemeStore } from "./stores/terminalThemeStore";
import { startTerminalThemeSync } from "./services/terminalThemeSync";
import { prefetchModule } from "./utils/prefetchModule";

// 拦截全局异步 Promise Rejection 与未捕获异常，防止桌面应用硬崩溃或死锁
if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    console.error("Unhandled Promise Rejection caught at window level:", event.reason);
    event.preventDefault();
  });

  window.addEventListener("error", (event) => {
    console.error("Uncaught runtime error caught at window level:", event.error);
  });
}

applyTauriMacHostChromeClass();
ensureTauriEventUnlistenPatched();
bootstrapDompurifyForTauriAssets();
ensureMainThreadCongestionProbe();
// 在 React 挂载前把外观刷到 <html>，避免深色偏好下首帧闪白。
bootstrapAppTheme();
startSystemThemeWatch();
// 内置终端主题可独立于应用外观（默认跟随）；后端 ANSI 调色板由全局订阅推送。
bootstrapTerminalThemeStore();
startTerminalThemeSync();

/** 与 App / AppImpl 解析并行预拉工作区首屏 chunk，缩短壳体出现后的等待。 */
prefetchModule(() => import("./components/AppWorkspaceLayout.lazy"), "AppWorkspaceLayout.lazy");
prefetchModule(() => import("./AppImpl"), "AppImpl");

/**
 * Monaco 本地环境改为首次打开编辑器 / 文件树预热时再加载（见 preloadMonacoEditor），
 * 避免冷启动即解析 monaco-vendor（~4MB）。
 */

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary type="global">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

