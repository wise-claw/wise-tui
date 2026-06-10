import { describe, expect, test } from "bun:test";
import type { ClaudeLlmProxyRecord } from "../services/claudeLlmProxy";
import { resolveProxyTtftMs, resolveProxyFirstByteMs, resolveProxyRttMs, ssePreviewHasFirstToken } from "./llmProxyTtft";

describe("llmProxyTtft", () => {
    test("ssePreviewHasFirstToken detects anthropic delta", () => {
    const sample = `event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"Hi"}}`;
    expect(ssePreviewHasFirstToken(sample)).toBe(true);
    expect(ssePreviewHasFirstToken('event: message_start\ndata: {}')).toBe(false);
  });

  test("ssePreviewHasFirstToken detects content_block_start text", () => {
    const sample =
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}';
    expect(ssePreviewHasFirstToken(sample)).toBe(true);
  });

  test("resolveProxyRttMs reads rttMs", () => {
    expect(resolveProxyRttMs({ rttMs: 320 } as ClaudeLlmProxyRecord)).toBe(320);
    expect(resolveProxyRttMs({} as ClaudeLlmProxyRecord)).toBe(null);
  });

  test("resolveProxyFirstByteMs reads firstByteMs", () => {
    expect(resolveProxyFirstByteMs({ firstByteMs: 512 } as ClaudeLlmProxyRecord)).toBe(512);
  });

  test("resolveProxyTtftMs prefers ttftMs for streaming only", () => {
    const streaming = {
      ttftMs: 820,
      firstByteMs: 400,
      isStreaming: true,
    } as ClaudeLlmProxyRecord;
    expect(resolveProxyTtftMs(streaming)).toBe(820);

    const nonStreaming = {
      ttftMs: 820,
      firstByteMs: 400,
      isStreaming: false,
    } as ClaudeLlmProxyRecord;
    expect(resolveProxyTtftMs(nonStreaming)).toBe(null);
  });
});
