import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import {
  getClaudeSessionsSnapshot,
  getClaudeSessionsStructureKey,
  getClaudeSessionSnapshot,
  publishClaudeSessions,
  subscribeClaudeSessionLive,
  subscribeClaudeSessionsStructure,
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

  test("structure key ignores message count growth while session is running", () => {
    publishClaudeSessions([stubSession("a", 1)]);
    const key1 = getClaudeSessionsStructureKey();
    publishClaudeSessions([stubSession("a", 2)]);
    const key2 = getClaudeSessionsStructureKey();
    expect(key1).toBe(key2);
  });

  test("structure key changes when idle session message count changes", () => {
    const idle = (count: number): ClaudeSession => ({
      ...stubSession("a", count),
      status: "idle",
    });
    publishClaudeSessions([idle(1)]);
    const key1 = getClaudeSessionsStructureKey();
    publishClaudeSessions([idle(2)]);
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

  test("getClaudeSessionSnapshot resolves claudeSessionId alias to tab session", () => {
    const session: ClaudeSession = {
      ...stubSession("tab-1", 1),
      claudeSessionId: "claude-sid-9",
      status: "idle",
    };
    publishClaudeSessions([session]);
    expect(getClaudeSessionSnapshot("claude-sid-9")?.id).toBe("tab-1");
    expect(getClaudeSessionSnapshot("tab-1")?.id).toBe("tab-1");
  });

  test("structure subscription does not fire on streaming body growth while running", async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
    publishClaudeSessions([stubSession("struct-a", 1)]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    let structureRevision = 0;
    const unsub = subscribeClaudeSessionsStructure(() => {
      structureRevision += 1;
    });
    publishClaudeSessions([stubSession("struct-a", 1)]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(structureRevision).toBe(0);
    publishClaudeSessions([
      {
        ...stubSession("struct-a", 1),
        status: "idle",
      },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(structureRevision).toBe(1);
    unsub();
  });

  test("structure key changes when session executionEngine changes", async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
    publishClaudeSessions([
      {
        ...stubSession("engine-a", 0),
        status: "idle",
        messages: [],
      },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const key1 = getClaudeSessionsStructureKey();
    let structureRevision = 0;
    const unsub = subscribeClaudeSessionsStructure(() => {
      structureRevision += 1;
    });
    publishClaudeSessions([
      {
        ...stubSession("engine-a", 0),
        status: "idle",
        messages: [],
        executionEngine: "codex",
      },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(getClaudeSessionsStructureKey()).not.toBe(key1);
    expect(structureRevision).toBe(1);
    unsub();
  });

  test("defers live flush while document is hidden", async () => {
    if (typeof document === "undefined") return;
    const originalDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    let liveRevision = 0;
    const unsub = subscribeClaudeSessionLive("hidden-a", () => {
      liveRevision += 1;
    });
    publishClaudeSessions([stubSession("hidden-a", 1)]);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(liveRevision).toBe(0);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(liveRevision).toBe(1);
    unsub();
    if (originalDescriptor) {
      Object.defineProperty(document, "visibilityState", originalDescriptor);
    }
  });
});
