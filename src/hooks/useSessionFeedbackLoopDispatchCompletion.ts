import { useEffect, useRef } from "react";
import type { ClaudeSession } from "../types";
import { isCurrentPrimaryMainWorkspaceWindowSync } from "../services/mainWindow";
import { assistantMessageVisiblePlainText } from "../services/claudeSessionState";
import { startAdaptiveInterval } from "../utils/adaptivePoll";
import {
  findRunningFeedbackLoopDispatchesForWorker,
  getSessionFeedbackLoopDispatchesSnapshotForAnchor,
  subscribeSessionFeedbackLoopDispatches,
  updateSessionFeedbackLoopDispatchStatus,
  type SessionFeedbackLoopDispatchRecord,
} from "../stores/sessionFeedbackLoopDispatchStore";

function extractLastAssistantText(session: ClaudeSession): string {
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const msg = session.messages[i];
    if (msg.role !== "assistant") continue;
    const text = assistantMessageVisiblePlainText(msg).trim();
    if (text) return text;
  }
  return "";
}

export function resolveFeedbackWorkerCompletion(worker: ClaudeSession, dispatchedAt: number): "completed" | "failed" | null {
  if (worker.status === "error" || worker.status === "cancelled") return "failed";
  if (worker.status === "completed") return extractLastAssistantText(worker) ? "completed" : "failed";
  if (worker.status !== "idle") return null;
  // Registration happens before executeSession: a newly created idle worker has
  // not finished a turn. Require an assistant response from this dispatch.
  return worker.messages.some(message => message.role === "assistant" && message.timestamp >= dispatchedAt && assistantMessageVisiblePlainText(message).trim()) ? "completed" : null;
}

export function useSessionFeedbackLoopDispatchCompletion(input: {
  anchorSessionId: string;
  getSessions: () => readonly ClaudeSession[];
  onComplete?: (record: SessionFeedbackLoopDispatchRecord, responseText: string) => void;
  onFailed?: (record: SessionFeedbackLoopDispatchRecord) => void;
}): void {
  const onCompleteRef = useRef(input.onComplete);
  onCompleteRef.current = input.onComplete;
  const onFailedRef = useRef(input.onFailed);
  onFailedRef.current = input.onFailed;

  useEffect(() => {
    const anchorSessionId = input.anchorSessionId.trim();
    if (!anchorSessionId) return;

    const handled = new Set<string>();

    const scan = () => {
      const records = getSessionFeedbackLoopDispatchesSnapshotForAnchor(anchorSessionId);
      const running = records.filter((record) => record.status === "running");
      if (running.length === 0) return;

      const sessions = input.getSessions();
      for (const record of running) {
        if (handled.has(record.dispatchId)) continue;
        const worker = sessions.find((session) => session.id === record.workerSessionId);
        if (!worker) continue;
        const status = resolveFeedbackWorkerCompletion(worker, record.createdAt);
        if (!status) continue;
        handled.add(record.dispatchId);
        updateSessionFeedbackLoopDispatchStatus({
          dispatchId: record.dispatchId,
          anchorSessionId,
          status,
        });
        if (status === "failed") onFailedRef.current?.(record);
        if (status === "completed") {
          const responseText = extractLastAssistantText(worker);
          if (responseText) {
            onCompleteRef.current?.(record, responseText);
          }
        }
      }
    };

    scan();
    const unsubscribe = subscribeSessionFeedbackLoopDispatches(scan);
    const feedbackPollMs = isCurrentPrimaryMainWorkspaceWindowSync() ? 3000 : 5000;
    const stopPoll = startAdaptiveInterval(scan, feedbackPollMs, feedbackPollMs * 3);
    return () => {
      unsubscribe();
      stopPoll();
    };
  }, [input.anchorSessionId, input.getSessions]);
}

/** 供全局 watcher 使用：按 worker 标签 id 推进派发状态。 */
export function syncFeedbackLoopDispatchFromSessions(
  sessions: readonly ClaudeSession[],
  onComplete?: (record: SessionFeedbackLoopDispatchRecord, responseText: string) => void,
): void {
  for (const session of sessions) {
    const running = findRunningFeedbackLoopDispatchesForWorker(session.id);
    for (const record of running) {
      const status = resolveFeedbackWorkerCompletion(session, record.createdAt);
      if (!status) continue;
      const responseText = status === "completed" ? extractLastAssistantText(session) : "";
      updateSessionFeedbackLoopDispatchStatus({
        dispatchId: record.dispatchId,
        anchorSessionId: record.anchorSessionId,
        status,
      });
      if (status === "completed" && responseText) {
        onComplete?.(record, responseText);
      }
    }
  }
}
