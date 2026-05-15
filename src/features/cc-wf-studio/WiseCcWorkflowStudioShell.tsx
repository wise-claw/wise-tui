import { useEffect } from "react";
import { ReactFlowProvider } from "reactflow";
import { I18nProvider } from "./vendor/webview/i18n/i18n-context";
import App from "./vendor/webview/App";
import * as studioMain from "./vendor/webview/main";
import { WiseWorkflowPortalProvider, useWiseWorkflowPortalContextValue } from "./WiseWorkflowPortalContext";

function WiseCcWorkflowStudioRadixPortalHost() {
  const ctx = useWiseWorkflowPortalContextValue();
  if (!ctx) {
    throw new Error("WiseCcWorkflowStudioRadixPortalHost must be used inside WiseWorkflowPortalProvider");
  }
  const { setHostElement } = ctx;

  return (
    <div
      ref={(el) => setHostElement(el)}
      className="wise-cc-wf-studio-radix-portal-host"
    />
  );
}

export function WiseCcWorkflowStudioShell() {
  useEffect(() => {
    studioMain.vscode.postMessage({ type: "WEBVIEW_READY" });
  }, []);

  return (
    <WiseWorkflowPortalProvider>
      <div className="wise-cc-wf-studio-shell-wrap">
        <WiseCcWorkflowStudioRadixPortalHost />
        <div className="wise-cc-wf-studio-shell-main">
          <I18nProvider locale="zh-CN">
            <ReactFlowProvider>
              <App />
            </ReactFlowProvider>
          </I18nProvider>
        </div>
      </div>
    </WiseWorkflowPortalProvider>
  );
}
