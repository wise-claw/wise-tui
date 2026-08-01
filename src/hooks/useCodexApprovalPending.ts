import { useCallback, useSyncExternalStore } from "react";
import {
  dismissCodexApprovalPending,
  getCodexApprovalPending,
  subscribeCodexApproval,
} from "../stores/codexApprovalStore";
import {
  respondCodexApproval,
  type CodexApprovalRequestPayload,
} from "../services/codexRpc";

export type CodexApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

/**
 * 订阅当前会话的 Codex RPC 审批请求，并提供回包方法。
 * 无待审批时 `pending` 为 null。
 */
export function useCodexApprovalPending(sessionId: string): {
  pending: CodexApprovalRequestPayload | null;
  respond: (decision: CodexApprovalDecision) => Promise<void>;
} {
  const pending = useSyncExternalStore(
    subscribeCodexApproval,
    () => getCodexApprovalPending(sessionId),
    () => null,
  );

  const respond = useCallback(
    async (decision: CodexApprovalDecision) => {
      const current = getCodexApprovalPending(sessionId);
      if (!current) return;
      await respondCodexApproval(current.session_id, current.request_id, decision);
      dismissCodexApprovalPending(current.session_id, current.request_id);
    },
    [sessionId],
  );

  return { pending, respond };
}
