import { useEffect, useLayoutEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { mountCcWfStudioWiseHost } from "./ccWfStudioWiseHost";
import { wiseCcWfStudioWiseHostDeps } from "./wiseCcWfStudioHostDeps";
import { WiseCcWorkflowStudioShell } from "./WiseCcWorkflowStudioShell";
import {
  WORKFLOW_UI_EVENT_CC_WF_STUDIO_ENTER_EXECUTION_WATCH,
  WORKFLOW_UI_EVENT_CC_WF_STUDIO_SHOW_OVERLAY,
  type CcWfStudioEnterExecutionWatchDetail,
  type CcWfStudioShowOverlayDetail,
} from "../../constants/workflowUiEvents";
import { emitExtensionToWebviewMessage } from "./wiseVscodeApi";

/** Wise 宿主 → Webview：会话内运行工作流时切到画布以展示 highlight_group_node 边动画 */
export const WISE_CC_WF_STUDIO_ENTER_EXECUTION_WATCH_MESSAGE = "WISE_ENTER_EXECUTION_WATCH" as const;

function emitEnterExecutionWatch() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      emitExtensionToWebviewMessage({ type: WISE_CC_WF_STUDIO_ENTER_EXECUTION_WATCH_MESSAGE });
    });
  });
}
import "reactflow/dist/style.css";
import "./vendor/webview/styles/main.css";
import "./vendor/webview/styles/nodes.css";
import "./wise-cc-wf-studio-embed.css";

function emitApplyWorkflowFromMcp(payload: Record<string, unknown>) {
  emitExtensionToWebviewMessage({
    type: "APPLY_WORKFLOW_FROM_MCP",
    payload,
  });
}

function handleApplyWorkflowFromMcp(repositoryPath: string, payload: Record<string, unknown>) {
  const needsConfirmation = payload.requireConfirmation !== false;
  if (needsConfirmation) {
    window.dispatchEvent(
      new CustomEvent<CcWfStudioShowOverlayDetail>(WORKFLOW_UI_EVENT_CC_WF_STUDIO_SHOW_OVERLAY, {
        detail: { repositoryPath },
      }),
    );
    // 等宿主叠层完成布局后再弹出 Diff 确认框，避免在 1px 后台宿主内被 Radix 立即 dismiss。
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        emitApplyWorkflowFromMcp(payload);
      });
    });
    return;
  }
  emitApplyWorkflowFromMcp(payload);
}

export interface WiseCcWorkflowStudioRootProps {
  repositoryPath: string;
}

export function WiseCcWorkflowStudioRoot({ repositoryPath }: WiseCcWorkflowStudioRootProps) {
  useLayoutEffect(() => {
    document.documentElement.classList.add("wise-cc-wf-studio-host-active");
    document.body.classList.add("vscode-dark");
    const ctl = mountCcWfStudioWiseHost(repositoryPath, wiseCcWfStudioWiseHostDeps);
    return () => {
      ctl.dispose();
      document.documentElement.classList.remove("wise-cc-wf-studio-host-active");
      document.body.classList.remove("vscode-dark");
    };
  }, [repositoryPath]);

  useEffect(() => {
    const rp = repositoryPath.trim();
    if (!rp) return;
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const u = await listen<Record<string, unknown>>("cc-wf-studio-mcp-invoke", (ev) => {
          const p = ev.payload;
          if (!p || typeof p !== "object") return;
          const kind = p.kind as string | undefined;
          if (kind === "get_current_workflow") {
            emitExtensionToWebviewMessage({
              type: "GET_CURRENT_WORKFLOW_REQUEST",
              payload: { correlationId: p.correlationId as string },
            });
          } else if (kind === "apply_workflow_from_mcp") {
            handleApplyWorkflowFromMcp(rp, p.payload as Record<string, unknown>);
          } else if (kind === "highlight_group_node") {
            // Supports any node type (groupNodeId field name kept for backward compatibility)
            emitExtensionToWebviewMessage({
              type: "HIGHLIGHT_GROUP_NODE",
              payload: p.payload as Record<string, unknown>,
            });
          }
        });
        if (!cancelled) {
          unlisten = u;
        } else {
          u();
        }
      } catch (e) {
        console.error("[cc-wf-studio] MCP invoke listener failed", e);
        return;
      }
      try {
        await invoke("ensure_cc_workflow_studio_project_mcp", { projectPath: rp });
      } catch (e) {
        console.error("[cc-wf-studio] ensure_cc_workflow_studio_project_mcp failed", e);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [repositoryPath]);

  useEffect(() => {
    const rp = repositoryPath.trim();
    if (!rp) return;

    function onEnterExecutionWatch(event: Event) {
      const detail = (event as CustomEvent<CcWfStudioEnterExecutionWatchDetail>).detail;
      if (detail?.repositoryPath?.trim() !== rp) {
        return;
      }
      emitEnterExecutionWatch();
    }

    window.addEventListener(
      WORKFLOW_UI_EVENT_CC_WF_STUDIO_ENTER_EXECUTION_WATCH,
      onEnterExecutionWatch as EventListener,
    );
    return () => {
      window.removeEventListener(
        WORKFLOW_UI_EVENT_CC_WF_STUDIO_ENTER_EXECUTION_WATCH,
        onEnterExecutionWatch as EventListener,
      );
    };
  }, [repositoryPath]);

  return (
    <div className="wise-cc-wf-studio-root">
      <WiseCcWorkflowStudioShell />
    </div>
  );
}
