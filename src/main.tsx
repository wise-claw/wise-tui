import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { bootstrapDompurifyForTauriAssets } from "./bootstrapDompurifyForTauriAssets";
import { applyTauriMacHostChromeClass } from "./utils/applyTauriMacHostChromeClass";
import { ensureTauriEventUnlistenPatched } from "./utils/safeTauriUnlisten";
import { ErrorBoundary } from "./components/ErrorBoundary";

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

/** 与 App / AppImpl 解析并行预拉工作区首屏 chunk，缩短壳体出现后的等待。 */
void import("./components/AppWorkspaceLayout.lazy");
void import("./AppImpl");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary type="global">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

