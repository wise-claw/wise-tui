import { describe, expect, test } from "bun:test";

// 与 useClaudeSessions.ts 内逻辑保持一致（会话 id 迁移窗口）
function resolveTabIdForClaudeStream(
  sessions: { id: string; claudeSessionId: string | null }[],
  lineSid: string | null,
  refTid: string | null,
  sessionIdMap?: Map<string, string>,
): string | null {
  if (lineSid) {
    const bySid = sessions.find((s) => s.claudeSessionId === lineSid || s.id === lineSid);
    if (bySid) return bySid.id;
    if (sessionIdMap) {
      for (const s of sessions) {
        if (sessionIdMap.get(s.id) === lineSid) return s.id;
      }
    }
  }
  if (refTid) {
    const byRef = sessions.find((s) => s.id === refTid || s.claudeSessionId === refTid);
    if (byRef) return byRef.id;
    if (sessionIdMap) {
      const mapped = sessionIdMap.get(refTid);
      if (mapped) {
        const byMapped = sessions.find((s) => s.id === mapped || s.claudeSessionId === mapped);
        if (byMapped) return byMapped.id;
      }
      for (const s of sessions) {
        if (sessionIdMap.get(s.id) === refTid) return s.id;
      }
    }
    return refTid;
  }
  return null;
}

describe("resolveTabIdForClaudeStream", () => {
  test("maps stdout session_id to tab before claudeSessionId is committed on session row", () => {
    const map = new Map([["tab_temp", "uuid-real"]]);
    const sessions = [{ id: "tab_temp", claudeSessionId: null }];
    expect(resolveTabIdForClaudeStream(sessions, "uuid-real", "tab_temp", map)).toBe("tab_temp");
  });
});
