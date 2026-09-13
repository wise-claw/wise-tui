import type { ClaudeSession } from "../types";

/** dsh ACP session ids are opaque; keep validation permissive like Qoder's. */
const DEEPSEEK_RESUME_SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;

export function isLikelyDeepseekResumeId(id: string | null | undefined): boolean {
  const trimmed = id?.trim() ?? "";
  if (!trimmed) return false;
  return DEEPSEEK_RESUME_SESSION_RE.test(trimmed);
}

export function sessionHasPriorDeepseekTurn(
  messages: readonly ClaudeSession["messages"][number][],
): boolean {
  return messages.some(
    (message) =>
      message.role === "system" && message.content.includes("DeepSeek Harness 执行"),
  );
}

export function resolveDeepseekResumeSessionId(
  session: { claudeSessionId?: string | null; messages: ClaudeSession["messages"] },
  tabSessionId: string,
  sessionIdMap?: ReadonlyMap<string, string>,
): string | null {
  if (!sessionHasPriorDeepseekTurn(session.messages)) {
    return null;
  }
  const candidates = [session.claudeSessionId, sessionIdMap?.get(tabSessionId)];
  for (const raw of candidates) {
    if (isLikelyDeepseekResumeId(raw)) return raw!.trim();
  }
  return null;
}
