import type { ClaudeSession } from "../types";
import { isLikelyCursorAgentId } from "./cursorAgentId";

const CODEX_RESUME_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Codex `exec resume` 接受的 thread / session id（复用 `claudeSessionId` 字段）。 */
export function isLikelyCodexResumeId(id: string | null | undefined): boolean {
  const trimmed = id?.trim() ?? "";
  if (!trimmed) return false;
  if (isLikelyCursorAgentId(trimmed)) return false;
  if (CODEX_RESUME_UUID_RE.test(trimmed)) return true;
  return /^[a-zA-Z][a-zA-Z0-9._-]{2,127}$/.test(trimmed);
}

export function sessionHasPriorCodexTurn(
  messages: readonly ClaudeSession["messages"][number][],
): boolean {
  return messages.some(
    (message) =>
      message.role === "system" && message.content.includes("Codex 执行"),
  );
}

export function resolveCodexResumeSessionId(
  session: { claudeSessionId?: string | null; messages: ClaudeSession["messages"] },
  tabSessionId: string,
  sessionIdMap?: ReadonlyMap<string, string>,
): string | null {
  if (!sessionHasPriorCodexTurn(session.messages)) {
    return null;
  }
  const candidates = [session.claudeSessionId, sessionIdMap?.get(tabSessionId)];
  for (const raw of candidates) {
    if (isLikelyCodexResumeId(raw)) return raw!.trim();
  }
  return null;
}
