import { describe, expect, test } from "bun:test";
import type { ClaudeSession, CursorDiskSessionItem } from "../types";
import { mergeCursorDiskSessions } from "./cursorDiskSessions";

function session(overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  return {
    id: "session_1719000000_old",
    claudeSessionId: null,
    repositoryPath: "/repo",
    repositoryName: "demo",
    model: "sonnet",
    status: "idle",
    messages: [],
    createdAt: 1,
    pendingPrompt: "",
    ...overrides,
  };
}

function diskItem(overrides: Partial<CursorDiskSessionItem> = {}): CursorDiskSessionItem {
  return {
    sessionId: "session_1719000001_listme",
    updatedAtMs: 1_700_000_000_000,
    preview: "帮我看看这个仓库",
    modelHint: "composer-2",
    resumeSessionId: "74ef5e36-b25b-4838-8276-b4c9e619df20",
    ...overrides,
  };
}

describe("mergeCursorDiskSessions", () => {
  test("adds a Wise Cursor row after the same repository", () => {
    const prev = [session({ id: "repo-a-1" }), session({ id: "repo-b-1", repositoryPath: "/other" })];
    const next = mergeCursorDiskSessions(prev, "/repo", "demo", [diskItem()], "sonnet");
    expect(next.map((row) => row.id)).toEqual([
      "repo-a-1",
      "session_1719000001_listme",
      "repo-b-1",
    ]);
    const added = next[1]!;
    expect(added.executionEngine).toBe("cursor");
    expect(added.nativeCliSource).toBeUndefined();
    expect(added.claudeSessionId).toBe("74ef5e36-b25b-4838-8276-b4c9e619df20");
    expect(added.diskPreview).toBe("帮我看看这个仓库");
    expect(added.diskTranscriptPartial).toBe(true);
  });

  test("hydrates an existing Wise tab without changing its id", () => {
    const prev = [
      session({
        id: "session_1719000001_listme",
        claudeSessionId: null,
        executionEngine: "cursor",
        messages: [{ id: 1, role: "user", content: "hi", parts: [], timestamp: 1 }],
        createdAt: 1_700_000_100_000,
      }),
    ];
    const next = mergeCursorDiskSessions(prev, "/repo", "demo", [diskItem()], "sonnet");
    expect(next).toHaveLength(1);
    expect(next[0]!.id).toBe("session_1719000001_listme");
    expect(next[0]!.claudeSessionId).toBe("74ef5e36-b25b-4838-8276-b4c9e619df20");
    expect(next[0]!.diskPreview).toBe("帮我看看这个仓库");
    expect(next[0]!.messages).toHaveLength(1);
    expect(next[0]!.diskTranscriptPartial).toBe(true);
  });
});
