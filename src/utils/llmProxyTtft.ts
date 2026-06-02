import type { ClaudeLlmProxyRecord } from "../services/claudeLlmProxy";

/** 从代理记录读取 TTFT；无字段时对旧记录尝试从 SSE 预览推断（仅知「有 token」，无精确毫秒）。 */
export function resolveProxyTtftMs(record: ClaudeLlmProxyRecord): number | null {
  if (record.ttftMs != null && record.ttftMs > 0) {
    return record.ttftMs;
  }
  if (record.firstByteMs != null && record.firstByteMs > 0 && !record.isStreaming) {
    return record.firstByteMs;
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
  return false;
}
