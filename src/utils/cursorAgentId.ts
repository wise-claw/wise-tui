/** Cursor Local Agent id（bridge 返回 `agent-…`）；Cloud 为 `bc-…`。 */
export function isLikelyCursorAgentId(id: string | null | undefined): boolean {
  const trimmed = id?.trim() ?? "";
  if (!trimmed) return false;
  return trimmed.startsWith("agent-") || trimmed.startsWith("bc-");
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
