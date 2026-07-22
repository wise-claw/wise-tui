import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import { mergePersistedTabsWithLocalBackup } from "./useClaudeSessions.helpers";

function session(
  id: string,
  messages: ClaudeSession["messages"],
  extra?: Partial<ClaudeSession>,
): ClaudeSession {
  return {
    id,
    repositoryPath: "/repo",
    repositoryName: "repo",
    model: "claude",
    status: "idle",
    messages,
    createdAt: 1,
    pendingPrompt: "",
    ...extra,
  };
}

describe("mergePersistedTabsWithLocalBackup", () => {
  test("prefers backup messages when primary session was emptied", () => {
    const primary = [session("tab-1", [])];
    const backup = [
      session("tab-1", [
        { id: 1, role: "user", content: "hello", parts: [], timestamp: 1 },
        { id: 2, role: "assistant", content: "world", parts: [], timestamp: 2 },
      ]),
    ];
    const merged = mergePersistedTabsWithLocalBackup(primary, backup);
    expect(merged.sessions[0]?.messages).toHaveLength(2);
    expect(merged.sessions[0]?.messages[0]?.content).toBe("hello");
  });

  test("keeps primary when it already has more messages", () => {
    const primary = [
      session("tab-1", [
        { id: 1, role: "user", content: "a", parts: [], timestamp: 1 },
        { id: 2, role: "assistant", content: "b", parts: [], timestamp: 2 },
        { id: 3, role: "user", content: "c", parts: [], timestamp: 3 },
      ]),
    ];
    const backup = [
      session("tab-1", [{ id: 1, role: "user", content: "old", parts: [], timestamp: 1 }]),
    ];
    const merged = mergePersistedTabsWithLocalBackup(primary, backup);
    expect(merged.sessions[0]?.messages).toHaveLength(3);
    expect(merged.sessions[0]?.messages[2]?.content).toBe("c");
  });

  test("appends backup-only sessions", () => {
    const primary = [session("tab-1", [])];
    const backup = [
      session("tab-2", [{ id: 1, role: "user", content: "x", parts: [], timestamp: 1 }]),
    ];
    const merged = mergePersistedTabsWithLocalBackup(primary, backup);
    expect(merged.sessions.map((s) => s.id)).toEqual(["tab-1", "tab-2"]);
  });
});
