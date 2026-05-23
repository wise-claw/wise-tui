import { describe, expect, it } from "bun:test";
import {
  annotateSequenceEvents,
  buildSequenceEventsFromFccTraces,
  buildSequenceEventsFromMessages,
  buildTrajectorySequenceModel,
  mergeSequenceEventsByTime,
  parseTrajectoryJsonlSupplemental,
  suppressInferredApiRequestsWhenObserved,
} from "./claudeSessionTrajectorySequence";
import type { ClaudeMessage } from "../types";
import type { FccTraceEntry } from "../types/fccTrace";

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

  it("adds api_request after plain user before assistant", () => {
    const messages: ClaudeMessage[] = [
      { id: 1, role: "user", content: "你在干什么", parts: [{ type: "text", text: "你在干什么" }], timestamp: 1000 },
      {
        id: 2,
        role: "assistant",
        content: "待命",
        parts: [{ type: "text", text: "待命" }],
        timestamp: 2000,
      },
    ];
    const ev = buildSequenceEventsFromMessages(messages);
    const api = ev.find((e) => e.kind === "api_request");
    expect(api).toBeDefined();
    expect(api?.messageId).toBe(2);
  });

  it("merges FCC trace as observed api_request on model lane", () => {
    const messages: ClaudeMessage[] = [
      { id: 1, role: "user", content: "hi", parts: [{ type: "text", text: "hi" }], timestamp: 1000 },
      {
        id: 2,
        role: "assistant",
        content: "hello",
        parts: [{ type: "text", text: "hello" }],
        timestamp: 2000,
      },
    ];
    const fcc: FccTraceEntry[] = [
      {
        id: "t1",
        timestampMs: 1500,
        method: "POST",
        path: "/v1/messages",
        statusCode: 200,
        durationMs: 120,
      },
    ];
    const merged = buildTrajectorySequenceModel(messages, undefined, { fccTraces: fcc });
    const http = merged.filter((e) => e.kind === "api_request");
    expect(http.length).toBe(1);
    expect(http[0]!.flags.observedHttp).toBe(true);
    expect(http[0]!.fromLane).toBe("claude_code");
    expect(http[0]!.toLane).toBe("model");
  });

  it("suppresses inferred api_request near observed FCC trace", () => {
    const observed = buildSequenceEventsFromFccTraces([
      { id: "a", timestampMs: 3000, method: "POST", path: "/v1/messages" },
    ]);
    const inferred: ReturnType<typeof buildSequenceEventsFromMessages> = [
      {
        id: "api-4",
        order: 10,
        timestamp: 3001,
        kind: "api_request",
        fromLane: "claude_code",
        toLane: "model",
        label: "REQUEST",
        flags: {},
      },
    ];
    const out = suppressInferredApiRequestsWhenObserved([...inferred, ...observed]);
    expect(out.some((e) => e.kind === "api_request" && !e.flags.observedHttp)).toBe(false);
    expect(out.some((e) => e.flags.observedHttp)).toBe(true);
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
