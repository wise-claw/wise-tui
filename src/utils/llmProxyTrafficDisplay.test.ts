import { describe, expect, test } from "bun:test";
import type { ClaudeLlmProxyRecord } from "../services/claudeLlmProxy";
import { filterLlmProxyRecordsForDisplay, isLlmProxyNoiseRecord } from "./llmProxyTrafficDisplay";

function record(partial: Partial<ClaudeLlmProxyRecord>): ClaudeLlmProxyRecord {
  return {
    id: "1",
    timestampMs: 0,
    method: "POST",
    path: "/v1/messages",
    upstreamUrl: "https://example.com/v1/messages",
    statusCode: 200,
    requestBodyPreview: "{}",
    responseBodyPreview: "{}",
    requestBytes: 2,
    responseBytes: 2,
    durationMs: 1,
    isStreaming: false,
    requestTruncated: false,
    responseTruncated: false,
    upstream: "https://example.com",
    ...partial,
  };
}

describe("isLlmProxyNoiseRecord", () => {
  test("filters root HEAD/GET probes", () => {
    expect(isLlmProxyNoiseRecord(record({ method: "HEAD", path: "/" }))).toBe(true);
    expect(isLlmProxyNoiseRecord(record({ method: "GET", path: "/" }))).toBe(true);
    expect(isLlmProxyNoiseRecord(record({ method: "POST", path: "/v1/messages" }))).toBe(false);
  });
});

describe("filterLlmProxyRecordsForDisplay", () => {
  test("drops noise rows", () => {
    const rows = [
      record({ id: "noise", method: "HEAD", path: "/" }),
      record({ id: "api", method: "POST", path: "/v1/messages?beta=true" }),
    ];
    expect(filterLlmProxyRecordsForDisplay(rows).map((r) => r.id)).toEqual(["api"]);
  });
});
