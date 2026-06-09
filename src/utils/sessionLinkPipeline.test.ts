import { describe, expect, test } from "bun:test";
import type { ClaudeMessage } from "../types";
import type { FccTraceEntry } from "../types/fccTrace";
import type { OpencodeGoProxyTraceEntry } from "../types/opencodeGoProxyTrace";
import { buildSequenceEventsFromMessages } from "./claudeSessionTrajectorySequence";
import { buildSessionLinkRecords } from "./buildSessionLinkRecords";
import {
  buildSessionLinkRecordsFromSources,
  suppressInferredHttpWhenObserved,
} from "./sessionLinkPipeline";

describe("sessionLinkPipeline", () => {
  test("suppresses inferred api_request when turn has observed http", () => {
    const records = [
      {
        id: "1",
        timestampMs: 1,
        layer: "http" as const,
        kind: "http_request",
        turnIndex: 1,
        summary: "POST /v1/messages · 200",
        observed: true,
        source: "fcc_trace" as const,
      },
      {
        id: "2",
        timestampMs: 2,
        layer: "http" as const,
        kind: "api_request",
        turnIndex: 1,
        summary: "inferred",
        observed: false,
        source: "inferred" as const,
      },
    ];
    const out = suppressInferredHttpWhenObserved(records);
    expect(out.some((r) => r.kind === "api_request")).toBe(false);
    expect(out.some((r) => r.kind === "http_request")).toBe(true);
  });

  test("merges fcc trace into records", () => {
    const messages: ClaudeMessage[] = [
      {
        id: 1,
        role: "user",
        content: "hi",
        timestamp: 1000,
        parts: [{ type: "text", text: "hi" }],
      },
    ];
    const fcc: FccTraceEntry[] = [
      {
        id: "t1",
        timestampMs: 1500,
        method: "POST",
        path: "/v1/messages",
        statusCode: 200,
      },
    ];
    const records = buildSessionLinkRecordsFromSources({ messages, fccTraces: fcc });
    expect(records.some((r) => r.source === "fcc_trace" && r.observed)).toBe(true);
  });

  test("fcc trace removes inferred placeholder in same turn", () => {
    const messages: ClaudeMessage[] = [
      {
        id: 1,
        role: "user",
        content: "hi",
        timestamp: 1000,
        parts: [{ type: "text", text: "hi" }],
      },
      {
        id: 2,
        role: "assistant",
        content: "tool",
        timestamp: 1200,
        parts: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "Bash",
            input: {},
            status: "completed",
          },
        ],
      },
      {
        id: 3,
        role: "user",
        content: "",
        timestamp: 1300,
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
        timestamp: 2000,
        parts: [{ type: "text", text: "done" }],
      },
    ];
    const events = buildSequenceEventsFromMessages(messages);
    const before = buildSessionLinkRecords(events);
    expect(before.some((r) => r.kind === "api_request")).toBe(true);
    const fcc: FccTraceEntry[] = [
      {
        id: "t1",
        timestampMs: 1800,
        method: "POST",
        path: "/v1/messages",
        statusCode: 200,
      },
    ];
    const merged = buildSessionLinkRecordsFromSources({ messages, fccTraces: fcc });
    expect(merged.some((r) => r.kind === "api_request")).toBe(false);
    expect(merged.some((r) => r.source === "fcc_trace")).toBe(true);
  });

  test("merges opencode go proxy trace into records", () => {
    const messages: ClaudeMessage[] = [
      {
        id: 1,
        role: "user",
        content: "hi",
        timestamp: 1000,
        parts: [{ type: "text", text: "hi" }],
      },
    ];
    const opencode: OpencodeGoProxyTraceEntry[] = [
      {
        id: "og1",
        timestampMs: 1500,
        method: "POST",
        path: "/v1/messages",
        claudeModel: "claude-sonnet-4",
        upstreamModel: "glm-4.7",
        upstreamUrl: "https://opencode.ai/zen/go/v1",
        statusCode: 200,
        durationMs: 800,
        isStreaming: false,
        requestPreview: "{}",
        responsePreview: "{}",
      },
    ];
    const records = buildSessionLinkRecordsFromSources({
      messages,
      opencodeGoProxyTraces: opencode,
    });
    expect(records.some((r) => r.source === "opencode_go_proxy" && r.observed)).toBe(true);
  });
});
