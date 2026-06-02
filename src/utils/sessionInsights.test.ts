import { describe, expect, test } from "bun:test";
import type { ClaudeMessage } from "../types";
import { buildSequenceEventsFromMessages } from "./claudeSessionTrajectorySequence";
import { buildSessionLinkRecords } from "./buildSessionLinkRecords";
import { computeSessionLinkTurnMetrics } from "./sessionLinkFilters";
import {
  computeSessionInsights,
  filterJsonlLinesForUsageScan,
  formatCacheHitRate,
  formatDurationMs,
  formatTokenCount,
  parseJsonlUsageRow,
  parseUsageFromHttpBody,
  parseUsageFromJsonlLine,
} from "./sessionInsights";

describe("filterJsonlLinesForUsageScan", () => {
  test("keeps only assistant usage rows", () => {
    const usage = JSON.stringify({
      type: "assistant",
      timestamp: "2026-06-02T10:00:00.000Z",
      message: { usage: { input_tokens: 1, output_tokens: 2 } },
    });
    const user = JSON.stringify({ type: "user", message: { content: "hi" } });
    const filtered = filterJsonlLinesForUsageScan([user, usage, "not json"]);
    expect(filtered).toEqual([usage]);
  });
});

describe("parseJsonlUsageRow", () => {
  test("parses usage and timestamp in one pass", () => {
    const line = JSON.stringify({
      type: "assistant",
      timestamp: "2026-06-02T10:00:00.000Z",
      message: {
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 100,
        },
      },
    });
    const row = parseJsonlUsageRow(line);
    expect(row?.usage.inputTokens).toBe(10);
    expect(row?.timestampMs).toBe(Date.parse("2026-06-02T10:00:00.000Z"));
  });
});

describe("parseUsageFromJsonlLine", () => {
  test("parses assistant usage row", () => {
    const line = JSON.stringify({
      type: "assistant",
      timestamp: "2026-06-02T10:00:00.000Z",
      message: {
        usage: {
          input_tokens: 1200,
          output_tokens: 300,
          cache_creation_input_tokens: 500,
          cache_read_input_tokens: 8000,
        },
      },
      costUSD: 0.05,
    });
    const u = parseUsageFromJsonlLine(line);
    expect(u).not.toBeNull();
    expect(u!.inputTokens).toBe(1200);
    expect(u!.outputTokens).toBe(300);
    expect(u!.cacheReadTokens).toBe(8000);
    expect(u!.costUsd).toBe(0.05);
  });
});

describe("parseUsageFromHttpBody", () => {
  test("parses messages API JSON response", () => {
    const body = JSON.stringify({
      id: "msg_1",
      type: "message",
      usage: {
        input_tokens: 900,
        output_tokens: 120,
        cache_read_input_tokens: 4000,
      },
    });
    const u = parseUsageFromHttpBody(body);
    expect(u!.inputTokens).toBe(900);
    expect(u!.cacheReadTokens).toBe(4000);
  });
});

describe("computeSessionInsights", () => {
  test("derives metrics and recommendations from link records", () => {
    const messages: ClaudeMessage[] = [
      {
        id: 1,
        role: "user",
        content: "go",
        timestamp: 1000,
        parts: [{ type: "text", text: "go" }],
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
            name: "Read",
            input: { path: "/a" },
            status: "completed",
          },
        ],
      },
      {
        id: 3,
        role: "user",
        content: "",
        timestamp: 70_000,
        parts: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "Read",
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
        timestamp: 71_000,
        parts: [{ type: "text", text: "done" }],
      },
    ];
    const events = buildSequenceEventsFromMessages(messages);
    const linkRecords = buildSessionLinkRecords(events);
    const turnMetrics = computeSessionLinkTurnMetrics(linkRecords);
    const jsonlLine = JSON.stringify({
      type: "assistant",
      timestamp: "1970-01-01T00:00:04.000Z",
      message: {
        usage: {
          input_tokens: 5000,
          output_tokens: 200,
          cache_creation_input_tokens: 3000,
          cache_read_input_tokens: 500,
        },
      },
    });

    const insights = computeSessionInsights({
      linkRecords,
      turnMetrics,
      jsonlUsageLines: [jsonlLine],
      llmProxyListening: false,
    });

    expect(insights.overview.turnCount).toBe(1);
    expect(insights.overview.toolCallCount).toBe(1);
    expect(insights.overview.tokens.inputTokens).toBeGreaterThan(0);
    expect(insights.recommendations.length).toBeGreaterThan(0);
    expect(insights.recommendations.some((r) => r.category === "observability")).toBe(true);
  });
});

describe("format helpers", () => {
  test("formatTokenCount and formatDurationMs", () => {
    expect(formatTokenCount(1500)).toBe("2K");
    expect(formatDurationMs(450)).toBe("450ms");
    expect(formatDurationMs(65_000)).toBe("1m5s");
    expect(formatCacheHitRate(0.812)).toBe("81.2%");
  });
});
