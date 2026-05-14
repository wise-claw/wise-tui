import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../../types";
import { notificationConversationInSessionInboxScope, notificationRowInSessionInboxScope } from "./notificationInbox";

function sess(id: string, repoPath: string, claudeSessionId: string | null = null): ClaudeSession {
  return {
    id,
    claudeSessionId,
    repositoryPath: repoPath,
    repositoryName: "repo",
    model: "sonnet",
    status: "idle",
    messages: [{ role: "user", content: "x", timestamp: 1 }],
    createdAt: 1,
    pendingPrompt: "",
  };
}

describe("notificationInbox", () => {
  test("matches aliases in same repository", () => {
    const current = sess("a", "/repo", "disk-a");
    const all = [current, sess("b", "/repo", "disk-b")];
    expect(notificationConversationInSessionInboxScope("disk-a", current, all)).toBe(true);
    expect(notificationRowInSessionInboxScope({ conversationId: "disk-a", readAt: null }, current, all)).toBe(true);
  });
});
