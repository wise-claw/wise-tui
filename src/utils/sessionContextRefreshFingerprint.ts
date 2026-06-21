import type { ClaudeSession } from "../types";

const DEFAULT_STREAM_BUCKET_CHARS = 280;
const CONGESTED_STREAM_BUCKET_CHARS = 560;

/** 流式正文按长度分桶，避免每个 token 重算上下文指标 / breakdown。 */
export function sessionContextRefreshFingerprint(
  session: ClaudeSession,
  options?: { congested?: boolean; bucketChars?: number },
): string {
  const bucket =
    options?.bucketChars ??
    (options?.congested ? CONGESTED_STREAM_BUCKET_CHARS : DEFAULT_STREAM_BUCKET_CHARS);
  const last = session.messages[session.messages.length - 1];
  const previewBucket =
    last?.content && last.content.length > 0 ? Math.floor(last.content.length / bucket) : 0;
  const partsLen =
    last?.parts?.reduce((sum, part) => {
      if (part.type === "text" || part.type === "reasoning") return sum + part.text.length;
      return sum;
    }, 0) ?? 0;
  const partsBucket = partsLen > 0 ? Math.floor(partsLen / bucket) : 0;
  return [
    session.status,
    session.createdAt,
    session.messages.length,
    last?.id ?? "",
    last?.role ?? "",
    previewBucket,
    partsBucket,
  ].join(":");
}
