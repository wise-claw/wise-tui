import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import {
  getClaudeSessionsSnapshot,
  getClaudeSessionsStructureKey,
  publishClaudeSessions,
  subscribeClaudeSessionLive,
} from "./claudeSessionsLiveStore";

function stubSession(id: string, messageCount: number): ClaudeSession {
  return {
    id,
    status: "running",
    messages: Array.from({ length: messageCount }, (_, i) => ({
      id: `${id}-m${i}`,
      role: "assistant" as const,
      content: "x".repeat(100 + i),
      timestamp: i,
    })),
    repositoryPath: "/repo",
    repositoryName: "wise",
  };
}

describe("claudeSessionsLiveStore", () => {
  test("structure key ignores streaming body growth on same message count", () => {
    publishClaudeSessions([stubSession("a", 2)]);
    const key1 = getClaudeSessionsStructureKey();
    publishClaudeSessions([stubSession("a", 2)]);
    const key2 = getClaudeSessionsStructureKey();
    expect(key1).toBe(key2);
    expect(getClaudeSessionsSnapshot()[0]?.messages).toHaveLength(2);
  });

  test("structure key changes when message count changes", () => {
    publishClaudeSessions([stubSession("a", 1)]);
    const key1 = getClaudeSessionsStructureKey();
    publishClaudeSessions([stubSession("a", 2)]);
    const key2 = getClaudeSessionsStructureKey();
    expect(key1).not.toBe(key2);
  });

  test("session live subscription ignores unrelated session updates", async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const sessionA = stubSession("a", 1);
    publishClaudeSessions([sessionA, stubSession("b", 1)]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    let aRevision = 0;
    const unsub = subscribeClaudeSessionLive("a", () => {
      aRevision += 1;
    });
    publishClaudeSessions([sessionA, stubSession("b", 2)]);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(aRevision).toBe(0);
    publishClaudeSessions([stubSession("a", 2), stubSession("b", 2)]);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(aRevision).toBe(1);
    unsub();
  });
});
