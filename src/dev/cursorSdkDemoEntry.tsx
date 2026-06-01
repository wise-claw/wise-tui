import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CursorSdkDiagnosticPanel } from "../components/CursorSdkDiagnosticPanel";
import { ErrorBoundary } from "../components/ErrorBoundary";

const repo = new URLSearchParams(window.location.search).get("repo")?.trim() ?? "";

const root = document.getElementById("wise-cursor-sdk-diagnostic-root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ConfigProvider locale={zhCN}>
        <AntApp>
          <ErrorBoundary type="global">
            <div style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
              <h1 style={{ fontSize: "1.25rem", margin: "0 0 8px" }}>Cursor SDK 诊断页</h1>
              <CursorSdkDiagnosticPanel
                initialRepositoryPath={repo}
                autoProbeOnMount
                showStandaloneHint
              />
            </div>
          </ErrorBoundary>
        </AntApp>
      </ConfigProvider>
    </StrictMode>,
  );
}
