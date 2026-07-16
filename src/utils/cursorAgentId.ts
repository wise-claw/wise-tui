/** 旧 Cursor SDK Local Agent id（`agent-…`）或 Cloud（`bc-…`）。 */
export function isLikelyCursorSdkAgentId(id: string | null | undefined): boolean {
  const trimmed = id?.trim() ?? "";
  if (!trimmed) return false;
  return trimmed.startsWith("agent-") || trimmed.startsWith("bc-");
}

/** Cursor Agent CLI `--resume` 使用的 chat/session UUID。 */
export function isLikelyCursorCliSessionId(id: string | null | undefined): boolean {
  const trimmed = id?.trim() ?? "";
  if (!trimmed) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    trimmed,
  );
}

/** Cursor 可 resume 的 id（SDK agent id 或 CLI session UUID）。 */
export function isLikelyCursorAgentId(id: string | null | undefined): boolean {
  return isLikelyCursorSdkAgentId(id) || isLikelyCursorCliSessionId(id);
}

export function resolveCursorResumeAgentId(
  session: { claudeSessionId?: string | null },
  tabSessionId: string,
  sessionIdMap?: ReadonlyMap<string, string>,
): string | null {
  const candidates = [
    session.claudeSessionId,
    sessionIdMap?.get(tabSessionId),
  ];
  for (const raw of candidates) {
    if (isLikelyCursorAgentId(raw)) return raw!.trim();
  }
  return null;
}
