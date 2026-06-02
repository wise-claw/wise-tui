import { describe, expect, test } from "bun:test";
import type { ClaudeLlmProxyRecord } from "../services/claudeLlmProxy";
import { resolveProxyTtftMs, ssePreviewHasFirstToken } from "./llmProxyTtft";

describe("llmProxyTtft", () => {
  test("ssePreviewHasFirstToken detects anthropic delta", () => {
    const sample = `event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"Hi"}}`;
    expect(ssePreviewHasFirstToken(sample)).toBe(true);
    expect(ssePreviewHasFirstToken('event: message_start\ndata: {}')).toBe(false);
  });

  test("resolveProxyTtftMs prefers ttftMs", () => {
    const rec = {
      ttftMs: 820,
      firstByteMs: 400,
      isStreaming: true,
    } as ClaudeLlmProxyRecord;
    expect(resolveProxyTtftMs(rec)).toBe(820);
  });
});
