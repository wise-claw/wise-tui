import { useEffect, useRef } from "react";
import { message } from "antd";
import {
  WISE_UI_EVENT_CODE_REVIEW_FIX,
  type CodeReviewFixDetail,
} from "../constants/workflowUiEvents";
type CreateSession = (
  repositoryPath: string,
  repositoryName: string,
  opts?: {
    skipActivate?: boolean;
    connectionKind?: "streaming" | "oneshot";
    immediateActivate?: boolean;
  },
) => Promise<string>;

type ExecuteSession = (sessionId: string, prompt: string) => boolean;

/**
 * Listens for Code Review "fix in session" requests and dispatches a worker session.
 * Keeps AppImpl thin — feature wiring lives here.
 */
export function useCodeReviewFixDispatch(deps: {
  createSession: CreateSession;
  executeSession: ExecuteSession;
}): void {
  const createSessionRef = useRef(deps.createSession);
  const executeSessionRef = useRef(deps.executeSession);
  createSessionRef.current = deps.createSession;
  executeSessionRef.current = deps.executeSession;

  useEffect(() => {
    const onFix = (event: Event) => {
      const detail = (event as CustomEvent<CodeReviewFixDetail>).detail;
      const repositoryPath = detail?.repositoryPath?.trim() ?? "";
      const prompt = detail?.prompt?.trim() ?? "";
      if (!repositoryPath || !prompt) return;

      const baseName =
        detail.repositoryName?.trim() ||
        repositoryPath.split("/").filter(Boolean).pop() ||
        "仓库";
      const stamp = new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      const workerName = `${baseName}/代码审查修复·${stamp}`;

      void (async () => {
        try {
          const sessionId = await createSessionRef.current(repositoryPath, workerName, {
            immediateActivate: true,
            connectionKind: "streaming",
          });
          const started = executeSessionRef.current(sessionId, prompt);
          if (!started) {
            message.warning("修复会话已创建，但未能立即启动执行，请在会话中重试发送。");
            return;
          }
          message.success("已在新会话中启动修复");
        } catch (error) {
          message.error(error instanceof Error ? error.message : "无法启动修复会话");
        }
      })();
    };

    window.addEventListener(WISE_UI_EVENT_CODE_REVIEW_FIX, onFix as EventListener);
    return () => {
      window.removeEventListener(WISE_UI_EVENT_CODE_REVIEW_FIX, onFix as EventListener);
    };
  }, []);
}
