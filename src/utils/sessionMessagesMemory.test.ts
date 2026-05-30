import { describe, expect, test } from "bun:test";
import { IN_MEMORY_SESSION_MESSAGES_MAX } from "../constants/claudeMessageListWindow";
import { applySessionMemoryCap, applySessionsMemoryCap, capSessionMessagesForMemory, sessionMessagesFromJsonlLines } from "./sessionMessagesMemory";

describe("sessionMessagesMemory", () => {
  test("capSessionMessagesForMemory keeps tail only", () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      role: "user" as const,
      content: `m${i}`,
      parts: [],
      timestamp: i,
    }));
    const capped = capSessionMessagesForMemory(messages, 3);
    expect(capped.map((m) => m.id)).toEqual(["7", "8", "9"]);
  });

  test("sessionMessagesFromJsonlLines marks partial when tail saturated", () => {
    const lines = ['{"type":"user","message":{"role":"user","content":"hi"}}'];
    const result = sessionMessagesFromJsonlLines(lines, {
      tailRequestLines: 1,
      memoryMax: IN_MEMORY_SESSION_MESSAGES_MAX,
    });
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.diskTranscriptPartial).toBe(true);
  });

  test("applySessionsMemoryCap preserves array reference when already capped", () => {
    const sessions = [
      {
        id: "a",
        claudeSessionId: "a",
        repositoryPath: "/r",
        repositoryName: "r",
        model: "sonnet",
        status: "completed" as const,
        messages: [],
        createdAt: 1,
        pendingPrompt: "",
      },
    ];
    expect(applySessionsMemoryCap(sessions)).toBe(sessions);
  });

  test("applySessionsMemoryCap marks partial when truncated", () => {
    const sessions = [
      {
        id: "a",
        claudeSessionId: "a",
        repositoryPath: "/r",
        repositoryName: "r",
        model: "sonnet",
        status: "completed" as const,
        messages: Array.from({ length: 200 }, (_, i) => ({
          id: i,
          role: "user" as const,
          content: `m${i}`,
          parts: [],
          timestamp: i,
        })),
        createdAt: 1,
        pendingPrompt: "",
      },
    ];
    const next = applySessionsMemoryCap(sessions);
    expect(next[0]?.messages.length).toBeLessThan(200);
    expect(next[0]?.diskTranscriptPartial).toBe(true);
    expect(applySessionMemoryCap(sessions[0]!).messages.length).toBe(next[0]!.messages.length);
  });
});
