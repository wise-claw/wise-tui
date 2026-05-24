import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import { pickSubagentTranscriptSession } from "./useSubagentDiskTranscript";

function stubSession(id: string, messageCount: number): ClaudeSession {
  return {
    id,
    claudeSessionId: id,
    repositoryPath: "/repo",
    repositoryName: "repo",
    model: "",
    status: "completed",
    createdAt: 1,
    pendingPrompt: "",
    messages: Array.from({ length: messageCount }, (_, i) => ({
      id: i + 1,
      role: "user" as const,
      content: "x",
      parts: [{ type: "text" as const, text: "x" }],
      timestamp: 1,
    })),
  };
}

describe("pickSubagentTranscriptSession", () => {
  test("prefers disk transcript over matched in-memory session", () => {
    const disk = stubSession("disk", 2);
    const matched = stubSession("matched", 1);
    expect(pickSubagentTranscriptSession(disk, matched, null)?.id).toBe("disk");
  });

  test("falls back to matched then synthetic", () => {
    const matched = stubSession("matched", 1);
    const synthetic = stubSession("syn", 3);
    expect(pickSubagentTranscriptSession(null, matched, synthetic)?.id).toBe("matched");
    expect(pickSubagentTranscriptSession(null, null, synthetic)?.id).toBe("syn");
  });
});
