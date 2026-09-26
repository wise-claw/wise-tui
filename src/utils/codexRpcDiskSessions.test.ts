import { describe, expect, test } from "bun:test";
import type { ClaudeSession, CodexRpcDiskSessionItem } from "../types";
import { mergeCodexRpcDiskSessions } from "./codexRpcDiskSessions";

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

function diskItem(overrides: Partial<CodexRpcDiskSessionItem> = {}): CodexRpcDiskSessionItem {
  return {
    sessionId: "session_1719000001_listme",
    updatedAtMs: 1_700_000_000_000,
    preview: "帮我看看这个仓库",
    modelHint: "gpt-5.6",
    resumeSessionId: "01a0abc-thread-id",
    ...overrides,
  };
}

describe("mergeCodexRpcDiskSessions", () => {
  test("adds a Wise Codex RPC row after the same repository", () => {
    const prev = [session({ id: "repo-a-1" }), session({ id: "repo-b-1", repositoryPath: "/other" })];
    const next = mergeCodexRpcDiskSessions(prev, "/repo", "demo", [diskItem()], "sonnet");
    expect(next.map((row) => row.id)).toEqual([
      "repo-a-1",
      "session_1719000001_listme",
      "repo-b-1",
    ]);
    const added = next[1]!;
    expect(added.executionEngine).toBe("codex-rpc");
    expect(added.nativeCliSource).toBeUndefined();
    expect(added.claudeSessionId).toBe("01a0abc-thread-id");
    expect(added.diskPreview).toBe("帮我看看这个仓库");
    expect(added.diskTranscriptPartial).toBe(true);
  });

  test("hydrates an existing Wise tab without changing its id", () => {
    const prev = [
      session({
        id: "session_1719000001_listme",
        claudeSessionId: null,
        executionEngine: "codex-rpc",
        messages: [{ id: 1, role: "user", content: "hi", parts: [], timestamp: 1 }],
        createdAt: 1_700_000_100_000,
      }),
    ];
    const next = mergeCodexRpcDiskSessions(prev, "/repo", "demo", [diskItem()], "sonnet");
    expect(next).toHaveLength(1);
    expect(next[0]!.id).toBe("session_1719000001_listme");
    expect(next[0]!.claudeSessionId).toBe("01a0abc-thread-id");
    expect(next[0]!.diskPreview).toBe("帮我看看这个仓库");
    expect(next[0]!.messages).toHaveLength(1);
    expect(next[0]!.diskTranscriptPartial).toBe(true);
    expect(next[0]!.createdAt).toBe(1_700_000_000_000);
  });
});
