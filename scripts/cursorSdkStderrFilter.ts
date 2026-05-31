/** @cursor/sdk 经 Connect RPC 流式传输时，偶发 HTTP/2 关闭噪声会写入 stderr，但 run 仍可能成功。 */
export function isCursorSdkNoiseStderr(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  const normalized = trimmed.toLowerCase();
  if (normalized.includes("nghttp2_frame_size_error")) return true;
  if (normalized.includes("err_http2_stream_error")) return true;
  if (normalized.includes("@connectrpc/connect")) return true;
  if (normalized.includes("node_modules/@connectrpc")) return true;
  if (normalized.includes("connecterror")) return true;
  if (normalized.includes("connect-error")) return true;
  if (normalized.includes("node-universal-client")) return true;
  if (normalized.includes("code.canceled")) return true;
  if (normalized.includes("fetch requests can only be canceled")) return true;
  if (/^\d+\s*\|/.test(trimmed)) return true;
  if (/^code:\s*\d+/.test(normalized)) return true;
  if (normalized.includes("metadata: headers")) return true;
  if (normalized.includes("details: []")) return true;
  if (/^\s*(\^|\|)\s*$/.test(trimmed)) return true;
  if (/^\s*at\s+\S/.test(trimmed)) return true;
  if (normalized.includes("rawmessage:")) return true;
  return false;
}

export function installCursorSdkStderrFilter(): () => void {
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((err?: Error) => void),
    cb?: (err?: Error) => void,
  ) => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    if (isCursorSdkNoiseStderr(text)) {
      if (typeof encoding === "function") encoding();
      else if (cb) cb();
      return true;
    }
    return original(chunk, encoding as BufferEncoding, cb);
  }) as typeof process.stderr.write;
  return () => {
    process.stderr.write = original as typeof process.stderr.write;
  };
}
