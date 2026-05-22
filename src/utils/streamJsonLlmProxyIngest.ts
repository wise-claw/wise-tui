import type { ClaudeLlmProxyRecord } from "../services/claudeLlmProxy";

const MAX_PREVIEW_CHARS = 24_000;
let streamSeq = 0;

function unwrapStreamRoot(j: Record<string, unknown>): Record<string, unknown> {
  const typ = typeof j.type === "string" ? j.type : "";
  if (typ === "stream_event" && j.event !== null && typeof j.event === "object") {
    return j.event as Record<string, unknown>;
  }
  return j;
}

/**
 * 当 HTTP 代理未截获流量时，从 Claude Code `stream-json` stdout 兜底生成可展示记录。
 */
export function tryIngestStreamJsonLineForLlmProxy(line: string): ClaudeLlmProxyRecord | null {
  const t = line.trim();
  if (!t.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(t) as Record<string, unknown>;
    const root = unwrapStreamRoot(parsed);
    const typ = typeof root.type === "string" ? root.type : "";
    if (typ === "content_block_delta" || typ === "message_delta") {
      return null;
    }
    if (typ === "assistant") {
      const msg = root.message;
      if (msg === null || typeof msg !== "object") return null;
      const content = (msg as Record<string, unknown>).content;
      if (!Array.isArray(content) || content.length === 0) return null;
    } else if (typ !== "user" && typ !== "result") {
      return null;
    }

    const pretty = JSON.stringify(root, null, 2);
    const truncated = pretty.length > MAX_PREVIEW_CHARS;
    const body = truncated ? `${pretty.slice(0, MAX_PREVIEW_CHARS)}…[truncated]` : pretty;

    const path =
      typ === "user"
        ? "/stream-json/user"
        : typ === "result"
          ? "/stream-json/result"
          : "/stream-json/assistant";

    const isUser = typ === "user";

    return {
      id: `stream-${Date.now()}-${streamSeq++}`,
      timestampMs: Date.now(),
      method: "POST",
      path,
      upstreamUrl: "",
      statusCode: typ === "result" ? 200 : null,
      requestBodyPreview: isUser ? body : "",
      responseBodyPreview: isUser ? "" : body,
      requestBytes: isUser ? body.length : 0,
      responseBytes: isUser ? 0 : body.length,
      durationMs: 0,
      isStreaming: typ === "assistant",
      requestTruncated: truncated && isUser,
      responseTruncated: truncated && !isUser,
      upstream: "stream-json（stdout 兜底）",
    };
  } catch {
    return null;
  }
}
