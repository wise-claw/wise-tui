import { message } from "antd";
import type { ClaudeSession } from "../types";
import {
  registerSessionFeedbackLoopDispatch,
  updateSessionFeedbackLoopDispatchStatus,
} from "../stores/sessionFeedbackLoopDispatchStore";
import {
  buildFeedbackLoopWorkerRepositoryName,
  buildFeedbackLoopWorkerUserBubble,
  type FeedbackLoopDispatchKind,
} from "../utils/sessionFeedbackLoopDispatch";

export type SessionFeedbackLoopDispatchDeps = {
  getSessions: () => ClaudeSession[];
  createSession: (
    repositoryPath: string,
    repositoryName: string,
    opts?: { skipActivate?: boolean; connectionKind?: "oneshot" | "streaming" },
  ) => Promise<string>;
  executeSession: (
    workerTabId: string,
    prompt: string,
    opts?: { userBubblePrompt?: string },
  ) => boolean;
};

export type SessionFeedbackLoopDispatchInput = {
  anchorSessionId: string;
  prompt: string;
  kind: FeedbackLoopDispatchKind;
  cycleIndex?: number;
};

function repositoryDisplayBase(repositoryName: string): string {
  let name = repositoryName.trim();
  for (const marker of ["/神经网:", "/执行环境:", "/员工:"]) {
    const idx = name.indexOf(marker);
    if (idx >= 0) name = name.slice(0, idx).trim();
  }
  return name || repositoryName.trim();
}

function newDispatchId(): string {
  return `feedback-loop:${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 从主会话向反馈神经网 worker 派发一次性分析任务（不切换主会话、不在主会话展示）。
 */
export async function dispatchSessionFeedbackLoopAnalysis(
  deps: SessionFeedbackLoopDispatchDeps,
  input: SessionFeedbackLoopDispatchInput,
): Promise<string | null> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    message.warning("反馈神经网派发正文为空");
    return null;
  }

  const anchorSession = deps.getSessions().find((item) => item.id === input.anchorSessionId);
  if (!anchorSession) {
    message.warning("未找到主会话，无法派发反馈神经网任务");
    return null;
  }

  const displayBase = repositoryDisplayBase(anchorSession.repositoryName);
  const workerName = buildFeedbackLoopWorkerRepositoryName(
    displayBase,
    input.kind,
    input.cycleIndex,
  );
  const bubble = buildFeedbackLoopWorkerUserBubble(prompt);
  const preview = bubble.slice(0, 72);
  const dispatchId = newDispatchId();

  const workerTabId = await deps.createSession(anchorSession.repositoryPath, workerName, {
    skipActivate: true,
    connectionKind: "oneshot",
  });

  registerSessionFeedbackLoopDispatch({
    dispatchId,
    anchorSessionId: anchorSession.id,
    workerSessionId: workerTabId,
    repositoryPath: anchorSession.repositoryPath,
    kind: input.kind,
    cycleIndex: input.cycleIndex,
    previewText: preview,
  });
  const spawnOk = deps.executeSession(workerTabId, prompt, { userBubblePrompt: bubble });
  if (spawnOk === false) {
    updateSessionFeedbackLoopDispatchStatus({
      dispatchId,
      anchorSessionId: anchorSession.id,
      status: "failed",
    });
    message.warning("反馈神经网派发未启动：可能已达并发上限，请稍后重试。");
    return null;
  }

  message.success("反馈神经网任务已派至独立 worker 会话");
  return workerTabId;
}
