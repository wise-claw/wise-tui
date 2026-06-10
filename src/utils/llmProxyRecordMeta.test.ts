import { describe, expect, test } from "bun:test";
import type { ClaudeLlmProxyRecord } from "../services/claudeLlmProxy";
import {
  filterLlmProxyRecordsByPanelQuery,
  isLlmProxyMessagesPath,
  parseModelFromLlmProxyRequest,
  summarizeLlmProxyRecords,
} from "./llmProxyRecordMeta";

function record(partial: Partial<ClaudeLlmProxyRecord>): ClaudeLlmProxyRecord {
  return {
    id: "1",
    timestampMs: 0,
    method: "POST",
    path: "/v1/messages?beta=true",
    upstreamUrl: "https://example.com/v1/messages",
    statusCode: 200,
    requestBodyPreview: '{"model":"claude-sonnet-4-8","stream":true}',
    responseBodyPreview: '{"usage":{"input_tokens":100,"output_tokens":20}}',
    requestBytes: 100,
    responseBytes: 50,
    durationMs: 1200,
    ttftMs: 400,
    isStreaming: true,
    requestTruncated: false,
    responseTruncated: false,
    upstream: "https://example.com",
    ...partial,
  };
}

describe("llmProxyRecordMeta", () => {
  test("isLlmProxyMessagesPath", () => {
    expect(isLlmProxyMessagesPath("/v1/messages?beta=true")).toBe(true);
    expect(isLlmProxyMessagesPath("/stream-json/result")).toBe(false);
  });

  test("parseModelFromLlmProxyRequest", () => {
    expect(parseModelFromLlmProxyRequest('{"model":"kimi-k2.5"}')).toBe("kimi-k2.5");
    expect(parseModelFromLlmProxyRequest('{"model":"doubao')).toBe("doubao");
  });

  test("summarizeLlmProxyRecords aggregates tokens and latency", () => {
    const summary = summarizeLlmProxyRecords([
      record({ id: "a" }),
      record({ id: "b", durationMs: 800, isStreaming: false, ttftMs: 800 }),
    ]);
    expect(summary.total).toBe(2);
    expect(summary.messagesCount).toBe(2);
    expect(summary.totalInputTokens).toBe(200);
    expect(summary.totalOutputTokens).toBe(40);
    expect(summary.avgDurationMs).toBe(1000);
    expect(summary.avgTtftMs).toBe(400);
  });

  test("filterLlmProxyRecordsByPanelQuery", () => {
    const rows = [
      record({ id: "msg", path: "/v1/messages?beta=true" }),
      record({ id: "err", path: "/v1/complete", statusCode: 502 }),
      record({ id: "other", path: "/v1/models" }),
    ];
    expect(filterLlmProxyRecordsByPanelQuery(rows, { kind: "messages" }).map((r) => r.id)).toEqual([
      "msg",
    ]);
    expect(filterLlmProxyRecordsByPanelQuery(rows, { kind: "errors" }).map((r) => r.id)).toEqual([
      "err",
    ]);
    expect(
      filterLlmProxyRecordsByPanelQuery(rows, { query: "kimi-k2.5" }).length,
    ).toBe(0);
    expect(
      filterLlmProxyRecordsByPanelQuery(rows, { query: "sonnet" }).length,
    ).toBe(3);
  });
});
