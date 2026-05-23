import { describe, expect, test } from "bun:test";
import type { ClaudeMessage } from "../types";
import { buildSequenceEventsFromMessages } from "./claudeSessionTrajectorySequence";
import { buildSessionLinkRecords, countSessionLinkStats } from "./buildSessionLinkRecords";

describe("buildSessionLinkRecords", () => {
  test("assigns turn index across user and tool exchange", () => {
    const messages: ClaudeMessage[] = [
      {
        id: 1,
        role: "user",
        content: "hello",
        timestamp: 1000,
        parts: [{ type: "text", text: "hello" }],
      },
      {
        id: 2,
        role: "assistant",
        content: "",
        timestamp: 2000,
        parts: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "Bash",
            input: { command: "ls" },
            status: "completed",
          },
        ],
      },
      {
        id: 3,
        role: "user",
        content: "",
        timestamp: 3000,
        parts: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "Bash",
            input: {},
            output: "ok",
            status: "completed",
          },
        ],
      },
      {
        id: 4,
        role: "assistant",
        content: "done",
        timestamp: 4000,
        parts: [{ type: "text", text: "done" }],
      },
    ];
    const events = buildSequenceEventsFromMessages(messages);
    const records = buildSessionLinkRecords(events);
    const user = records.find((r) => r.kind === "user_input");
    expect(user?.turnIndex).toBe(1);
    const inferredHttp = records.find((r) => r.kind === "api_request");
    expect(inferredHttp).toBeDefined();
    expect(inferredHttp?.observed).toBe(false);
    expect(inferredHttp?.source).toBe("inferred");
    const stats = countSessionLinkStats(records);
    expect(stats.turns).toBe(1);
    expect(stats.httpInferred).toBeGreaterThanOrEqual(1);
  });
});
