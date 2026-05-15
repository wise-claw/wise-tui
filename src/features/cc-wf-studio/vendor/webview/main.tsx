/**
 * Claude Code Workflow Studio — Wise 嵌入入口
 * 仅导出 vscode API；根挂载由 `WiseCcWorkflowStudioRoot.tsx` 负责。
 */

import { createWiseVsCodeApi } from "../../wiseVscodeApi";

interface VSCodeAPI {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VSCodeAPI;
    initialLocale?: string;
    vscode?: VSCodeAPI;
  }
}

window.addEventListener("vite:preloadError", (event) => {
  const e = event as Event & { payload?: unknown };
  const message = e.payload instanceof Error ? e.payload.message : String(e.payload ?? "");
  if (message.includes("Unable to preload CSS")) {
    event.preventDefault();
  } else {
    console.error("[vite:preloadError]", e.payload);
  }
});

export const vscode = createWiseVsCodeApi();
window.vscode = vscode;
