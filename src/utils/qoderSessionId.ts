import type { ClaudeSession } from "../types";

/** Qoder CLI session ids are typically UUID-shaped; keep validation permissive. */
const QODER_RESUME_SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;

export function isLikelyQoderResumeId(id: string | null | undefined): boolean {
  const trimmed = id?.trim() ?? "";
  if (!trimmed) return false;
  return QODER_RESUME_SESSION_RE.test(trimmed);
}

export function sessionHasPriorQoderTurn(
  messages: readonly ClaudeSession["messages"][number][],
): boolean {
  return messages.some(
    (message) =>
      message.role === "system" && message.content.includes("Qoder CLI 执行"),
  );
}

export function resolveQoderResumeSessionId(
  session: { claudeSessionId?: string | null; messages: ClaudeSession["messages"] },
  tabSessionId: string,
  sessionIdMap?: ReadonlyMap<string, string>,
): string | null {
  if (!sessionHasPriorQoderTurn(session.messages)) {
    return null;
  }
  const candidates = [session.claudeSessionId, sessionIdMap?.get(tabSessionId)];
  for (const raw of candidates) {
    if (isLikelyQoderResumeId(raw)) return raw!.trim();
  }
  return null;
}
