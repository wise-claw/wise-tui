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

// 与 useClaudeSessions.helpers.ts 内逻辑保持一致（complete payload 路由）
function resolveTabIdFromCompletePayload(
  payload: unknown,
  sessions: { id: string; claudeSessionId: string | null }[],
  refTid: string | null,
  sessionIdMap?: Map<string, string>,
): string | null {
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    const o = payload as Record<string, unknown>;
    const raw = o.sessionId ?? o.session_id;
    const sid = typeof raw === "string" ? raw.trim() : "";
    if (sid && sid !== "unknown") {
      const match = sessions.find((s) => s.claudeSessionId === sid || s.id === sid);
      if (match) return match.id;
      if (sessionIdMap) {
        for (const s of sessions) {
          if (sessionIdMap.get(s.id) === sid) return s.id;
        }
      }
      return sid;
    }
  }
  if (typeof payload === "boolean") {
    return refTid ? resolveTabIdForClaudeStream(sessions, null, refTid, sessionIdMap) : null;
  }
  return refTid ? resolveTabIdForClaudeStream(sessions, null, refTid, sessionIdMap) : null;
}

describe("resolveTabIdForClaudeStream", () => {
  test("maps stdout session_id to tab before claudeSessionId is committed on session row", () => {
    const map = new Map([["tab_temp", "uuid-real"]]);
    const sessions = [{ id: "tab_temp", claudeSessionId: null }];
    expect(resolveTabIdForClaudeStream(sessions, "uuid-real", "tab_temp", map)).toBe("tab_temp");
  });
});

// 多屏护栏：全局 handleOutput / handleComplete 在 isMultiPaneRef.current 为 true 时，
// 以 refTid=null 调用下列解析函数，仅靠行内 / payload 的 session_id 匹配真实会话，匹配不到则返回 null（丢弃），
// 防止多屏并行时 streamingTargetIdRef 单值兜底把别屏的流式行串到当前屏。
describe("resolveTabIdForClaudeStream multi-pane guard (refTid=null)", () => {
  const sessions = [
    { id: "tab-A", claudeSessionId: "uuid-A" },
    { id: "tab-B", claudeSessionId: "uuid-B" },
  ];

  test("lineSid 匹配到会话时返回该会话 id（正常路由）", () => {
    expect(resolveTabIdForClaudeStream(sessions, "uuid-A", null)).toBe("tab-A");
    expect(resolveTabIdForClaudeStream(sessions, "uuid-B", null)).toBe("tab-B");
  });

  test("lineSid 为 null（如 codex 构造的流式行不带 claude session_id）时返回 null（丢弃，不串屏）", () => {
    expect(resolveTabIdForClaudeStream(sessions, null, null)).toBeNull();
  });

  test("lineSid 不匹配任何会话时返回 null（丢弃，不串屏）", () => {
    expect(resolveTabIdForClaudeStream(sessions, "uuid-unknown", null)).toBeNull();
  });
});

describe("resolveTabIdFromCompletePayload multi-pane guard (refTid=null)", () => {
  const sessions = [
    { id: "tab-A", claudeSessionId: "uuid-A" },
    { id: "tab-B", claudeSessionId: "uuid-B" },
  ];

  test("payload 带 session_id 且匹配到会话时返回该会话 id", () => {
    expect(resolveTabIdFromCompletePayload({ sessionId: "uuid-A" }, sessions, null)).toBe("tab-A");
    expect(
      resolveTabIdFromCompletePayload({ session_id: "uuid-B", success: true }, sessions, null),
    ).toBe("tab-B");
  });

  test("payload 带 session_id 但无会话匹配时返回裸 sid（调用方需校验为真实会话）", () => {
    expect(
      resolveTabIdFromCompletePayload({ sessionId: "uuid-orphan" }, sessions, null),
    ).toBe("uuid-orphan");
  });

  test("payload 为 boolean 或无 session_id 时返回 null（丢弃，不串屏）", () => {
    expect(resolveTabIdFromCompletePayload(true, sessions, null)).toBeNull();
    expect(resolveTabIdFromCompletePayload({}, sessions, null)).toBeNull();
  });

  test("payload session_id 为 unknown 时返回 null（丢弃）", () => {
    expect(resolveTabIdFromCompletePayload({ sessionId: "unknown" }, sessions, null)).toBeNull();
  });
});
