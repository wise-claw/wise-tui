import { describe, expect, it } from "bun:test";
import {
  annotateSequenceEvents,
  buildSequenceEventsFromFccTraces,
  buildSequenceEventsFromMessages,
  buildTrajectorySequenceModel,
  filterSequenceEventsForTurn,
  filterSequenceEventsForTurnRange,
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

  it("classifies skill, mcp, and subagent tool_use on CC lane", () => {
    const messages: ClaudeMessage[] = [
      {
        id: 1,
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool_use",
            id: "s1",
            name: "Skill",
            input: { skill: "commit" },
            status: "completed",
          },
          {
            type: "tool_use",
            id: "m1",
            name: "mcp__linear__search_issues",
            input: { server: "linear" },
            status: "completed",
          },
          {
            type: "tool_use",
            id: "t1",
            name: "Task",
            input: { description: "run subagent" },
            status: "completed",
          },
        ],
        timestamp: 2000,
      },
    ];
    const ev = buildSequenceEventsFromMessages(messages);
    const skill = ev.find((e) => e.kind === "skill");
    const mcp = ev.find((e) => e.kind === "mcp");
    const sub = ev.find((e) => e.kind === "subagent");
    expect(skill?.label).toBe("SKILL");
    expect(skill?.fromLane).toBe("claude_code");
    expect(skill?.toLane).toBe("claude_code");
    expect(mcp?.label).toBe("MCP");
    expect(mcp?.fromLane).toBe("claude_code");
    expect(sub?.label).toBe("SUBAGENT");
    expect(sub?.drilldown?.type).toBe("subagent_task");
  });

  it("parses hook_started from supplemental jsonl", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "hook_started",
      timestamp: 5000,
      hook_name: "PreToolUse",
    });
    const ev = parseTrajectoryJsonlSupplemental([line]);
    expect(ev.length).toBe(1);
    expect(ev[0]!.kind).toBe("hook");
    expect(ev[0]!.subtitle).toContain("启动");
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

  it("filterSequenceEventsForTurn keeps one conversation round", () => {
    const messages: ClaudeMessage[] = [
      { id: 1, role: "user", content: "a", parts: [{ type: "text", text: "a" }], timestamp: 1000 },
      {
        id: 2,
        role: "assistant",
        content: "b",
        parts: [{ type: "text", text: "b" }],
        timestamp: 2000,
      },
      { id: 3, role: "user", content: "c", parts: [{ type: "text", text: "c" }], timestamp: 3000 },
      {
        id: 4,
        role: "assistant",
        content: "d",
        parts: [{ type: "text", text: "d" }],
        timestamp: 4000,
      },
    ];
    const events = buildSequenceEventsFromMessages(messages);
    const turn1 = filterSequenceEventsForTurn(events, 1);
    const turn2 = filterSequenceEventsForTurn(events, 2);
    expect(turn1.some((e) => e.kind === "user_input" && e.subtitle === "a")).toBe(true);
    expect(turn1.some((e) => e.kind === "assistant_text")).toBe(true);
    expect(turn1.some((e) => e.subtitle === "c")).toBe(false);
    expect(turn2.some((e) => e.kind === "user_input" && e.subtitle === "c")).toBe(true);
    expect(turn2.some((e) => e.kind === "assistant_text")).toBe(true);
  });

  it("filterSequenceEventsForTurnRange selects an inclusive range of turns", () => {
    const messages: ClaudeMessage[] = [
      { id: 1, role: "user", content: "a", parts: [{ type: "text", text: "a" }], timestamp: 1000 },
      {
        id: 2,
        role: "assistant",
        content: "b",
        parts: [{ type: "text", text: "b" }],
        timestamp: 2000,
      },
      { id: 3, role: "user", content: "c", parts: [{ type: "text", text: "c" }], timestamp: 3000 },
      {
        id: 4,
        role: "assistant",
        content: "d",
        parts: [{ type: "text", text: "d" }],
        timestamp: 4000,
      },
      { id: 5, role: "user", content: "e", parts: [{ type: "text", text: "e" }], timestamp: 5000 },
      {
        id: 6,
        role: "assistant",
        content: "f",
        parts: [{ type: "text", text: "f" }],
        timestamp: 6000,
      },
    ];
    const events = buildSequenceEventsFromMessages(messages);
    const all = filterSequenceEventsForTurnRange(events, 1, 3);
    expect(all.length).toBe(events.length);

    const firstTwo = filterSequenceEventsForTurnRange(events, 1, 2);
    expect(firstTwo.some((e) => e.kind === "user_input" && e.subtitle === "a")).toBe(true);
    expect(firstTwo.some((e) => e.kind === "user_input" && e.subtitle === "c")).toBe(true);
    expect(firstTwo.some((e) => e.kind === "user_input" && e.subtitle === "e")).toBe(false);

    const lastOnly = filterSequenceEventsForTurnRange(events, 3, 3);
    expect(lastOnly.length).toBeGreaterThan(0);
    expect(lastOnly.every((e) => e.subtitle !== "a" && e.subtitle !== "c")).toBe(true);

    expect(filterSequenceEventsForTurnRange(events, 2, 1).length).toBe(0);
    expect(filterSequenceEventsForTurnRange(events, 0, 0).length).toBe(0);
    expect(filterSequenceEventsForTurnRange(events, 99, 100).length).toBe(0);
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
