import { describe, expect, test } from "bun:test";
import type { ClaudeMessage } from "../types";
import type { SessionLinkRecord } from "../types/sessionLink";
import { buildSequenceEventsFromMessages } from "./claudeSessionTrajectorySequence";
import { buildSessionLinkRecords } from "./buildSessionLinkRecords";
import { computeSessionLinkTurnMetrics } from "./sessionLinkFilters";
import {
  computeSessionInsights,
  classifyLinkToolRecord,
  emptyRequestRationalityMetrics,
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
    expect(insights.requestRationality).toBeDefined();
  });

  test("detects MCP and skill overuse recommendations", () => {
    const linkRecords = [
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `mcp-${i}`,
        timestampMs: 1000 + i,
        layer: "tool" as const,
        kind: "tool_use",
        turnIndex: 1,
        summary: "mcp__codegraph__explore",
        observed: true,
        source: "memory" as const,
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `skill-${i}`,
        timestampMs: 2000 + i,
        layer: "tool" as const,
        kind: "skill",
        turnIndex: 2,
        summary: "trellis-check",
        observed: true,
        source: "memory" as const,
      })),
    ];
    const turnMetrics = [{ turnIndex: 1, durationMs: 30_000, toolCount: 10, httpObserved: 1 }];
    const insights = computeSessionInsights({ linkRecords, turnMetrics });
    expect(insights.requestRationality.toolCategories.find((c) => c.category === "mcp")?.count).toBe(
      10,
    );
    expect(insights.recommendations.some((r) => r.id === "req-mcp-overuse")).toBe(true);
    expect(insights.recommendations.some((r) => r.id === "req-skill-overuse")).toBe(true);
  });
});

describe("classifyLinkToolRecord", () => {
  test("classifies mcp, skill, subagent, and builtin", () => {
    expect(
      classifyLinkToolRecord({
        id: "1",
        timestampMs: 1,
        layer: "tool",
        kind: "mcp",
        turnIndex: 1,
        summary: "linear",
        observed: true,
        source: "memory",
      }),
    ).toBe("mcp");
    expect(
      classifyLinkToolRecord({
        id: "2",
        timestampMs: 1,
        layer: "tool",
        kind: "skill",
        turnIndex: 1,
        summary: "commit",
        observed: true,
        source: "memory",
      }),
    ).toBe("skill");
    expect(
      classifyLinkToolRecord({
        id: "3",
        timestampMs: 1,
        layer: "tool",
        kind: "tool_use",
        turnIndex: 1,
        summary: "Task",
        observed: true,
        source: "memory",
      }),
    ).toBe("subagent");
    expect(
      classifyLinkToolRecord({
        id: "4",
        timestampMs: 1,
        layer: "tool",
        kind: "tool_use",
        turnIndex: 1,
        summary: "Read",
        observed: true,
        source: "memory",
      }),
    ).toBe("builtin");
  });
});

describe("context pressure recommendations", () => {
  test("emits critical recommendation when ctxPercent >= 95", () => {
    const messages: ClaudeMessage[] = [
      {
        id: 1,
        role: "user",
        content: "hi",
        timestamp: 1000,
        parts: [{ type: "text", text: "hi" }],
      },
    ];
    const events = buildSequenceEventsFromMessages(messages);
    const records = buildSessionLinkRecords(events);
    const turnMetrics = computeSessionLinkTurnMetrics(records);
    const insights = computeSessionInsights({
      linkRecords: records,
      turnMetrics,
      contextMetrics: { estimatedTokens: 195_000, ctxPercent: 97 },
    });
    expect(insights.recommendations.some((r) => r.id === "ctx-pressure-critical")).toBe(true);
    expect(insights.overview.dataCoverage.hasContextMetrics).toBe(true);
  });

  test("emits warning when ctxPercent >= 80", () => {
    const messages: ClaudeMessage[] = [
      {
        id: 1,
        role: "user",
        content: "hi",
        timestamp: 1000,
        parts: [{ type: "text", text: "hi" }],
      },
    ];
    const events = buildSequenceEventsFromMessages(messages);
    const records = buildSessionLinkRecords(events);
    const turnMetrics = computeSessionLinkTurnMetrics(records);
    const insights = computeSessionInsights({
      linkRecords: records,
      turnMetrics,
      contextMetrics: { estimatedTokens: 165_000, ctxPercent: 82 },
    });
    expect(insights.recommendations.some((r) => r.id === "ctx-pressure-high")).toBe(true);
  });
});

describe("tool latency and duplicate read insights", () => {
  test("computeSessionInsights surfaces slow tools and duplicate reads", () => {
    const detail = 'input:\n{"file_path":"src/a.ts"}';
    const records: import("../types/sessionLink").SessionLinkRecord[] = [
      {
        id: "in-1",
        timestampMs: 0,
        layer: "input",
        kind: "user_input",
        turnIndex: 1,
        summary: "hi",
        observed: true,
        source: "memory",
      },
      {
        id: "tu-1",
        timestampMs: 100,
        layer: "tool",
        kind: "tool_use",
        turnIndex: 1,
        summary: "Shell",
        observed: true,
        source: "memory",
        toolUseId: "toolu_1",
      },
      {
        id: "tr-1",
        timestampMs: 12_100,
        layer: "tool",
        kind: "tool_result",
        turnIndex: 1,
        summary: "ok",
        observed: true,
        source: "memory",
        toolUseId: "toolu_1",
      },
      {
        id: "tu-2",
        timestampMs: 13_000,
        layer: "tool",
        kind: "tool_use",
        turnIndex: 1,
        summary: "Read",
        detail,
        observed: true,
        source: "memory",
        toolUseId: "toolu_2",
      },
      {
        id: "tr-2",
        timestampMs: 13_100,
        layer: "tool",
        kind: "tool_result",
        turnIndex: 1,
        summary: "ok",
        observed: true,
        source: "memory",
        toolUseId: "toolu_2",
      },
      {
        id: "tu-3",
        timestampMs: 14_000,
        layer: "tool",
        kind: "tool_use",
        turnIndex: 2,
        summary: "Read",
        detail,
        observed: true,
        source: "memory",
        toolUseId: "toolu_3",
      },
      {
        id: "tr-3",
        timestampMs: 14_100,
        layer: "tool",
        kind: "tool_result",
        turnIndex: 2,
        summary: "ok",
        observed: true,
        source: "memory",
        toolUseId: "toolu_3",
      },
      {
        id: "tu-4",
        timestampMs: 15_000,
        layer: "tool",
        kind: "tool_use",
        turnIndex: 2,
        summary: "Read",
        detail,
        observed: true,
        source: "memory",
        toolUseId: "toolu_4",
      },
      {
        id: "tr-4",
        timestampMs: 15_100,
        layer: "tool",
        kind: "tool_result",
        turnIndex: 2,
        summary: "ok",
        observed: true,
        source: "memory",
        toolUseId: "toolu_4",
      },
    ];
    const turnMetrics = computeSessionLinkTurnMetrics(records);
    const insights = computeSessionInsights({ linkRecords: records, turnMetrics });
    expect(insights.toolLatencyHotspots.some((h) => h.name === "Shell")).toBe(true);
    expect(insights.duplicateReadPaths.some((d) => d.path === "src/a.ts")).toBe(true);
    expect(insights.recommendations.some((r) => r.id.startsWith("tool-duplicate-read"))).toBe(true);
  });

  test("computeReliabilityMetrics surfaces tool and http errors", () => {
    const records: SessionLinkRecord[] = [
      {
        id: "tr-err",
        layer: "tool",
        kind: "tool_result",
        turnIndex: 1,
        summary: "Read failed",
        detail: '{"is_error": true, "error": "ENOENT"}',
        observed: true,
        source: "memory",
        toolUseId: "toolu_e1",
      },
      {
        id: "http-500",
        layer: "http",
        kind: "http",
        turnIndex: 1,
        summary: "POST /v1/messages 500",
        observed: true,
        source: "llm_proxy",
      },
    ];
    const turnMetrics = computeSessionLinkTurnMetrics(records);
    const insights = computeSessionInsights({ linkRecords: records, turnMetrics });
    expect(insights.reliability.toolErrorCount).toBe(1);
    expect(insights.reliability.httpErrorCount).toBe(1);
    expect(insights.recommendations.some((r) => r.category === "reliability")).toBe(false);
  });

  test("reliability recommendations appear when error counts exceed threshold", () => {
    const records: SessionLinkRecord[] = [];
    for (let i = 0; i < 3; i += 1) {
      records.push({
        id: `tr-${i}`,
        layer: "tool",
        kind: "tool_result",
        turnIndex: 1,
        summary: "error",
        detail: "is_error",
        observed: true,
        source: "memory",
        toolUseId: `toolu_${i}`,
      });
    }
    const turnMetrics = computeSessionLinkTurnMetrics(records);
    const insights = computeSessionInsights({ linkRecords: records, turnMetrics });
    expect(insights.reliability.toolErrorCount).toBe(3);
    expect(insights.recommendations.some((r) => r.id === "reliability-tool-errors")).toBe(true);
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
