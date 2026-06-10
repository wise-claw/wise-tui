import type { ClaudeLlmProxyRecord } from "../services/claudeLlmProxy";

/** 从代理记录读取 TTFT（仅流式有意义；非流式返回 null）。 */
export function resolveProxyTtftMs(record: ClaudeLlmProxyRecord): number | null {
  if (!record.isStreaming) return null;
  if (record.ttftMs != null && record.ttftMs > 0) {
    return record.ttftMs;
  }
  return null;
}

export function resolveProxyRttMs(record: ClaudeLlmProxyRecord): number | null {
  if (record.rttMs != null && record.rttMs > 0) {
    return record.rttMs;
  }
  return null;
}

export function resolveProxyFirstByteMs(record: ClaudeLlmProxyRecord): number | null {
  if (record.firstByteMs != null && record.firstByteMs > 0) {
    return record.firstByteMs;
  }
  return null;
}

/** 与 Rust `sse_capture_has_first_token` 对齐，供单测与旧记录标记。 */
export function ssePreviewHasFirstToken(preview: string): boolean {
  const s = preview;
  if (s.includes("text_delta")) return true;
  if (s.includes("thinking_delta")) return true;
  if (s.includes("content_block_delta") && (s.includes('"text"') || s.includes("thinking"))) {
    return true;
  }
  if (s.includes('"delta":{"content"') || s.includes('"delta": {"content"')) return true;
  if (s.includes('"type":"thinking"') || s.includes('"type": "thinking"')) return true;
  if (s.includes("message_delta") && s.includes('"text"')) return true;
  if (
    s.includes("content_block_start") &&
    (s.includes('"type":"text"') || s.includes('"type": "text"'))
  ) {
    return true;
  }
  if (s.includes("reasoning_content") || s.includes("reasoning_delta")) return true;
  return false;
}
