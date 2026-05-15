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

export interface UseCcWorkflowStudioWorkspaceParams {
  sendMessageToSession: (sessionId: string, text: string) => void | Promise<void>;
  switchSession: (sessionId: string) => void;
  sessionsLatestRef: RefObject<ClaudeSession[]>;
  activeSessionIdLatestRef: RefObject<string | null | undefined>;
  setPromptsMode: (v: boolean) => void;
  setMcpHubMode: (v: boolean) => void;
  setSkillsHubMode: (v: boolean) => void;
  setCodeKnowledgeGraphMode: (v: boolean) => void;
  /** 侧栏当前仓库 path；用于预加载与「打开工作流工作室」 */
  activeRepositoryPath: string | undefined;
}

export function useCcWorkflowStudioWorkspace(p: UseCcWorkflowStudioWorkspaceParams) {
  const [ccWfStudioMode, setCcWfStudioMode] = useState(false);
  const [ccWfStudioSessionPath, setCcWfStudioSessionPath] = useState<string | null>(null);

  const onCloseCcWorkflowStudio = useCallback(() => {
    setCcWfStudioMode(false);
  }, []);

  const openWorkflowStudio = useCallback(() => {
    const path = p.activeRepositoryPath?.trim() ?? "";
    if (!path) {
      message.warning("请先在侧栏选择仓库");
      return;
    }
    p.setPromptsMode(false);
    p.setMcpHubMode(false);
    p.setSkillsHubMode(false);
    p.setCodeKnowledgeGraphMode(false);
    setCcWfStudioSessionPath(path);
    setCcWfStudioMode(true);
  }, [
    p.activeRepositoryPath,
    p.setCodeKnowledgeGraphMode,
    p.setMcpHubMode,
    p.setPromptsMode,
    p.setSkillsHubMode,
  ]);

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
          setCcWfStudioMode(false);
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
      setCcWfStudioMode(true);
      p.setPromptsMode(false);
      p.setMcpHubMode(false);
      p.setSkillsHubMode(false);
      p.setCodeKnowledgeGraphMode(false);
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

      p.setPromptsMode(false);
      p.setMcpHubMode(false);
      p.setSkillsHubMode(false);
      p.setCodeKnowledgeGraphMode(false);
      setCcWfStudioMode(true);
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
    p.setPromptsMode,
    p.setMcpHubMode,
    p.setSkillsHubMode,
    p.setCodeKnowledgeGraphMode,
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
      ricId = globalThis.requestIdleCallback(() => run(), { timeout: 2500 });
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
    ccWfStudioMode,
    setCcWfStudioMode,
    ccWfStudioSessionPath,
    setCcWfStudioSessionPath,
    onCloseCcWorkflowStudio,
    openWorkflowStudio,
  };
}
