import type { ClaudeSession } from "../types";

const OPENCODE_RESUME_SESSION_RE = /^ses_[A-Za-z0-9]+$/;

export function isLikelyOpencodeResumeId(id: string | null | undefined): boolean {
  const trimmed = id?.trim() ?? "";
  if (!trimmed) return false;
  return OPENCODE_RESUME_SESSION_RE.test(trimmed);
}

export function sessionHasPriorOpencodeTurn(
  messages: readonly ClaudeSession["messages"][number][],
): boolean {
  return messages.some(
    (message) =>
      message.role === "system" && message.content.includes("OpenCode 执行"),
  );
}

export function resolveOpencodeResumeSessionId(
  session: { claudeSessionId?: string | null; messages: ClaudeSession["messages"] },
  tabSessionId: string,
  sessionIdMap?: ReadonlyMap<string, string>,
): string | null {
  if (!sessionHasPriorOpencodeTurn(session.messages)) {
    return null;
  }
  const candidates = [session.claudeSessionId, sessionIdMap?.get(tabSessionId)];
  for (const raw of candidates) {
    if (isLikelyOpencodeResumeId(raw)) return raw!.trim();
  }
  return null;
}
