import type { ClaudeSession } from "../types";

/** 仅处理仍匹配 expectedTurnNonce 的 complete；丢弃 terminalFreshTurn 取消的旧进程迟到事件。 */
export function shouldApplyClaudeTurnComplete(awaitingThisTurn: boolean): boolean {
  return awaitingThisTurn;
}

/** complete 时按 tab / 映射 / 会话 id / claudeSessionId 解析本轮 nonce，避免 init 迁移后全局 complete 找不到条目。 */
export function resolveExpectedTurnNonceForTab(input: {
  tabId: string;
  sessionIdMap: ReadonlyMap<string, string>;
  nonceByTabId: ReadonlyMap<string, number>;
  sessions: readonly Pick<ClaudeSession, "id" | "claudeSessionId">[];
  boundNonce?: number;
}): number | undefined {
  const tabId = input.tabId.trim();
  if (!tabId) return input.boundNonce;
  const mapped = input.sessionIdMap.get(tabId) ?? tabId;
  const session = input.sessions.find(
    (s) => s.id === tabId || s.claudeSessionId === tabId || s.id === mapped,
  );
  const keys = new Set<string>([tabId, mapped]);
  if (session?.id) keys.add(session.id);
  const cc = session?.claudeSessionId?.trim();
  if (cc) keys.add(cc);
  for (const key of keys) {
    const nonce = input.nonceByTabId.get(key);
    if (nonce !== undefined) return nonce;
  }
  return input.boundNonce;
}

export const CLAUDE_NO_VISIBLE_REPLY_FAILURE_HINT = "未产出可见回复";

export function completePayloadSessionId(payload: unknown): string | null {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
  const raw = (payload as Record<string, unknown>).sessionId ?? (payload as Record<string, unknown>).session_id;
  const sid = typeof raw === "string" ? raw.trim() : "";
  return sid && sid !== "unknown" ? sid : null;
}

/**
 * terminalFreshTurn 清空 claudeSessionId 后，旧 Claude 会话 cancel 仍会带旧 session_id；
 * Codex/Cursor 以 Wise tab id 为 session_id 时，cancel 的 complete 不得与真实回合混淆。
 */
export function isStaleClaudeCompleteForSession(
  session: Pick<ClaudeSession, "id" | "claudeSessionId"> | undefined,
  payload: unknown,
): boolean {
  if (!session) return false;
  const payloadSid = completePayloadSessionId(payload);
  if (!payloadSid) return false;
  const currentSid = session.claudeSessionId?.trim();
  if (!currentSid) {
    return payloadSid !== session.id;
  }
  return payloadSid !== currentSid && session.id !== payloadSid;
}
