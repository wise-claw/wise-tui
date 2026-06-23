import { useEffect, useRef } from "react";
import type { ClaudeSession } from "../types";
import { isCurrentPrimaryMainWorkspaceWindowSync } from "../services/mainWindow";
import { assistantMessageVisiblePlainText } from "../services/claudeSessionState";
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

function isTerminalStatus(status: ClaudeSession["status"]): boolean {
  return status === "idle" || status === "error";
}

export function useSessionFeedbackLoopDispatchCompletion(input: {
  anchorSessionId: string;
  getSessions: () => readonly ClaudeSession[];
  onComplete?: (record: SessionFeedbackLoopDispatchRecord, responseText: string) => void;
}): void {
  const onCompleteRef = useRef(input.onComplete);
  onCompleteRef.current = input.onComplete;

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
        if (!isTerminalStatus(worker.status)) continue;

        const status = worker.status === "error" ? "failed" : "completed";
        updateSessionFeedbackLoopDispatchStatus({
          dispatchId: record.dispatchId,
          anchorSessionId,
          status,
        });
        handled.add(record.dispatchId);

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
    const timer = window.setInterval(scan, feedbackPollMs);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
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
    if (running.length === 0 || !isTerminalStatus(session.status)) continue;
    const status = session.status === "error" ? "failed" : "completed";
    const responseText = status === "completed" ? extractLastAssistantText(session) : "";
    for (const record of running) {
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
