import { describe, expect, it } from "bun:test";
import {
  annotateSequenceEvents,
  buildSequenceEventsFromMessages,
  buildTrajectorySequenceModel,
  mergeSequenceEventsByTime,
  parseTrajectoryJsonlSupplemental,
} from "./claudeSessionTrajectorySequence";
import type { ClaudeMessage } from "../types";

describe("claudeSessionTrajectorySequence", () => {
  it("builds API_REQUEST after tool-only user before assistant", () => {
    const messages: ClaudeMessage[] = [
      { id: 1, role: "user", content: "hi", parts: [{ type: "text", text: "hi" }], timestamp: 1000 },
      {
        id: 2,
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool_use",
            id: "t1",
            name: "Read",
            input: { file_path: "/a" },
            status: "completed",
          },
        ],
        timestamp: 2000,
      },
      {
        id: 3,
        role: "user",
        content: "",
        parts: [
          {
            type: "tool_use",
            id: "t1",
            name: "Read",
            input: {},
            output: "ok",
            status: "completed",
          },
        ],
        timestamp: 3000,
      },
      {
        id: 4,
        role: "assistant",
        content: "done",
        parts: [{ type: "text", text: "done" }],
        timestamp: 4000,
      },
    ];
    const ev = annotateSequenceEvents(buildSequenceEventsFromMessages(messages));
    const kinds = ev.map((e) => e.kind);
    expect(kinds).toContain("api_request");
    expect(kinds).toContain("tool_result");
    expect(kinds).toContain("tool_use");
  });

  it("parses hook_response from supplemental jsonl", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "hook_response",
      timestamp: 5000,
      hook_event: "PreToolUse",
      outcome: "success",
      output: "ok",
    });
    const ev = parseTrajectoryJsonlSupplemental([line]);
    expect(ev.length).toBe(1);
    expect(ev[0]!.kind).toBe("hook");
    expect(ev[0]!.fromLane).toBe("claude_code");
    expect(ev[0]!.toLane).toBe("claude_code");
  });

  it("merges messages with supplemental", () => {
    const messages: ClaudeMessage[] = [
      { id: 1, role: "user", content: "x", parts: [{ type: "text", text: "x" }], timestamp: 1000 },
    ];
    const hookLine = JSON.stringify({
      type: "system",
      subtype: "hook_response",
      timestamp: 1500,
      hook_event: "Stop",
      outcome: "success",
    });
    const merged = buildTrajectorySequenceModel(messages, [hookLine]);
    expect(merged.some((e) => e.kind === "user_input")).toBe(true);
    expect(merged.some((e) => e.kind === "hook")).toBe(true);
  });
});
