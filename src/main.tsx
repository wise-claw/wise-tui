import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { bootstrapDompurifyForTauriAssets } from "./bootstrapDompurifyForTauriAssets";
import { applyTauriMacHostChromeClass } from "./utils/applyTauriMacHostChromeClass";
import { ensureTauriEventUnlistenPatched } from "./utils/safeTauriUnlisten";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ensureMainThreadCongestionProbe } from "./stores/mainThreadCongestionStore";
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

/** 与 App / AppImpl 解析并行预拉工作区首屏 chunk，缩短壳体出现后的等待。 */
prefetchModule(() => import("./components/AppWorkspaceLayout.lazy"), "AppWorkspaceLayout.lazy");
prefetchModule(() => import("./AppImpl"), "AppImpl");

/**
 * 尽早异步初始化 Monaco 本地加载环境（注入本地 monaco 实例 + worker 工厂，避免默认 CDN）。
 * 异步执行不阻塞首屏 root render；编辑器按需 mount 前完成即可。
 */
void import("./services/monacoEnvironment");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary type="global">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

