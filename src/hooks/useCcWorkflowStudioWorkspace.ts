import { useCallback, useEffect, useState, type RefObject } from "react";
import { message } from "antd";
import type { ClaudeSession } from "../types";
import {
  WORKFLOW_UI_EVENT_CC_WF_STUDIO_LAUNCH_AI_EDITING,
  WORKFLOW_UI_EVENT_CC_WF_STUDIO_MCP_SESSION_ENDED,
  WORKFLOW_UI_EVENT_CC_WF_STUDIO_ENTER_EXECUTION_WATCH,
  WORKFLOW_UI_EVENT_CC_WF_STUDIO_RUN_IN_CLAUDE_SESSION,
  WORKFLOW_UI_EVENT_CC_WF_STUDIO_SHOW_OVERLAY,
  type CcWfStudioLaunchAiEditingDetail,
  type CcWfStudioEnterExecutionWatchDetail,
  type CcWfStudioRunInClaudeSessionDetail,
  type CcWfStudioShowOverlayDetail,
} from "../constants/workflowUiEvents";
import { isWiseSupportedAiEditingProvider, wiseAiEditingSlashPrompt } from "../services/ccWfStudioAiEditingLaunch";
import type { UseViewModeApi } from "./useViewMode";
import { inspectView } from "./useViewMode";

export interface UseCcWorkflowStudioWorkspaceParams {
  sendMessageToSession: (sessionId: string, text: string) => void | Promise<void>;
  switchSession: (sessionId: string) => void;
  sessionsLatestRef: RefObject<ClaudeSession[]>;
  activeSessionIdLatestRef: RefObject<string | null | undefined>;
  /**
   * 顶层 ViewMode 状态机（参见 .trellis/spec/guides/agent-harness-architecture.md §3）。
   * Workflow Studio 是 inspect 域的一种 tool，进入它时调用 `viewMode.enter(inspectView({ kind: "workflow-studio" }))`，
   * 退出时调用 `viewMode.back()`。
   */
  viewMode: UseViewModeApi;
  /** 侧栏当前仓库 path；用于预加载与「打开工作流工作室」 */
  activeRepositoryPath: string | undefined;
}

export function useCcWorkflowStudioWorkspace(p: UseCcWorkflowStudioWorkspaceParams) {
  /**
   * Workflow Studio session path 是 view 状态之外的辅助 state——
   * 它跟随 inspect/workflow-studio 进入而被设置，但 P1 不重新设计它，
   * 维持原有 useState 行为以最小化 P0 改动面。
   */
  const [ccWfStudioSessionPath, setCcWfStudioSessionPath] = useState<string | null>(null);

  const onCloseCcWorkflowStudio = useCallback(() => {
    p.viewMode.back();
  }, [p.viewMode]);

  const openWorkflowStudio = useCallback(() => {
    const path = p.activeRepositoryPath?.trim() ?? "";
    if (!path) {
      message.warning("请先在侧栏选择仓库");
      return;
    }
    setCcWfStudioSessionPath(path);
    p.viewMode.enter(inspectView({ kind: "workflow-studio" }));
  }, [p.activeRepositoryPath, p.viewMode]);

  useEffect(() => {
    function onCcWfStudioLaunchAiEditing(event: Event) {
      const detail = (event as CustomEvent<CcWfStudioLaunchAiEditingDetail>).detail;
      const repositoryPath = detail?.repositoryPath?.trim();
      const provider = detail?.provider?.trim();
      if (!repositoryPath || !provider || !isWiseSupportedAiEditingProvider(provider)) {
        return;
      }

      setCcWfStudioSessionPath(repositoryPath);

      const sessionsNow = p.sessionsLatestRef.current;
      const activeId = p.activeSessionIdLatestRef.current?.trim() ?? "";
      const activeForRepo =
        activeId && sessionsNow.find((s) => s.id === activeId && s.repositoryPath === repositoryPath);
      const session =
        activeForRepo ?? sessionsNow.find((s) => s.repositoryPath === repositoryPath) ?? null;
      if (!session) {
        message.warning("请先在当前仓库打开 Claude Code 会话，再启动 AI 编辑");
        return;
      }

      if (session.id !== activeId) {
        p.switchSession(session.id);
      }
      void (async () => {
        try {
          await p.sendMessageToSession(session.id, wiseAiEditingSlashPrompt(provider));
          // AI editing prompt sent — leave the workflow studio overlay
          if (p.viewMode.legacy.ccWfStudioMode) {
            p.viewMode.back();
          }
        } catch {
          // sendMessageToSession 已将失败写入会话
        }
      })();
    }

    function onCcWfStudioMcpSessionEnded() {
      setCcWfStudioSessionPath(null);
    }

    function onCcWfStudioShowOverlay(event: Event) {
      const detail = (event as CustomEvent<CcWfStudioShowOverlayDetail>).detail;
      const repositoryPath = detail?.repositoryPath?.trim();
      if (!repositoryPath) {
        return;
      }
      setCcWfStudioSessionPath(repositoryPath);
      p.viewMode.enter(inspectView({ kind: "workflow-studio" }));
    }

    function onCcWfStudioRunInClaudeSession(event: Event) {
      const detail = (event as CustomEvent<CcWfStudioRunInClaudeSessionDetail>).detail;
      const repositoryPath = detail?.repositoryPath?.trim();
      const slashCommand = detail?.slashCommand?.trim();
      if (!repositoryPath || !slashCommand) {
        return;
      }

      setCcWfStudioSessionPath(repositoryPath);

      const sessionsNow = p.sessionsLatestRef.current;
      const activeId = p.activeSessionIdLatestRef.current?.trim() ?? "";
      const activeForRepo =
        activeId && sessionsNow.find((s) => s.id === activeId && s.repositoryPath === repositoryPath);
      const session =
        activeForRepo ?? sessionsNow.find((s) => s.repositoryPath === repositoryPath) ?? null;
      if (!session) {
        message.warning("请先在当前仓库打开 Claude Code 会话，再运行工作流");
        return;
      }

      if (session.id !== activeId) {
        p.switchSession(session.id);
      }

      p.viewMode.enter(inspectView({ kind: "workflow-studio" }));
      window.dispatchEvent(
        new CustomEvent<CcWfStudioEnterExecutionWatchDetail>(
          WORKFLOW_UI_EVENT_CC_WF_STUDIO_ENTER_EXECUTION_WATCH,
          { detail: { repositoryPath } },
        ),
      );

      void (async () => {
        try {
          await p.sendMessageToSession(session.id, slashCommand);
        } catch {
          /* sendMessageToSession 已将失败写入会话 */
        }
      })();
    }

    window.addEventListener(
      WORKFLOW_UI_EVENT_CC_WF_STUDIO_LAUNCH_AI_EDITING,
      onCcWfStudioLaunchAiEditing as EventListener,
    );
    window.addEventListener(
      WORKFLOW_UI_EVENT_CC_WF_STUDIO_MCP_SESSION_ENDED,
      onCcWfStudioMcpSessionEnded as EventListener,
    );
    window.addEventListener(
      WORKFLOW_UI_EVENT_CC_WF_STUDIO_SHOW_OVERLAY,
      onCcWfStudioShowOverlay as EventListener,
    );
    window.addEventListener(
      WORKFLOW_UI_EVENT_CC_WF_STUDIO_RUN_IN_CLAUDE_SESSION,
      onCcWfStudioRunInClaudeSession as EventListener,
    );
    return () => {
      window.removeEventListener(
        WORKFLOW_UI_EVENT_CC_WF_STUDIO_LAUNCH_AI_EDITING,
        onCcWfStudioLaunchAiEditing as EventListener,
      );
      window.removeEventListener(
        WORKFLOW_UI_EVENT_CC_WF_STUDIO_MCP_SESSION_ENDED,
        onCcWfStudioMcpSessionEnded as EventListener,
      );
      window.removeEventListener(
        WORKFLOW_UI_EVENT_CC_WF_STUDIO_SHOW_OVERLAY,
        onCcWfStudioShowOverlay as EventListener,
      );
      window.removeEventListener(
        WORKFLOW_UI_EVENT_CC_WF_STUDIO_RUN_IN_CLAUDE_SESSION,
        onCcWfStudioRunInClaudeSession as EventListener,
      );
    };
  }, [
    p.sendMessageToSession,
    p.switchSession,
    p.viewMode,
    p.sessionsLatestRef,
    p.activeSessionIdLatestRef,
  ]);

  /** 空闲时预拉取工作流工作室切片，避免首次点击时串行等待。 */
  useEffect(() => {
    const path = p.activeRepositoryPath?.trim();
    if (!path) return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      void import("../features/cc-wf-studio/WiseCcWorkflowStudioPanel").catch(() => {
        /* 预加载失败不打扰用户，真正打开时会再试 */
      });
    };
    let ricId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (typeof globalThis.requestIdleCallback === "function") {
      ricId = globalThis.requestIdleCallback(() => run(), { timeout: 5000 });
    } else {
      timeoutId = globalThis.setTimeout(run, 800);
    }
    return () => {
      cancelled = true;
      if (ricId !== undefined && typeof globalThis.cancelIdleCallback === "function") {
        globalThis.cancelIdleCallback(ricId);
      }
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    };
  }, [p.activeRepositoryPath]);

  return {
    ccWfStudioSessionPath,
    setCcWfStudioSessionPath,
    onCloseCcWorkflowStudio,
    openWorkflowStudio,
  };
}
