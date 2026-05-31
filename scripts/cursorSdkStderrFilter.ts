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

/** SDK / Connect 偶发把长度前缀、纯数字等噪声写到 stdout，Rust 侧只认 NDJSON 事件。 */
export function isCursorSdkNoiseStdout(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (!trimmed.startsWith("{")) return true;
  if (/^\d+$/.test(trimmed)) return true;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return true;
    const type = (parsed as { type?: unknown }).type;
    return typeof type !== "string" || type.trim().length === 0;
  } catch {
    return true;
  }
}

let bridgeStdoutWriteDepth = 0;

export function withBridgeStdoutWrite<T>(fn: () => T): T {
  bridgeStdoutWriteDepth += 1;
  try {
    return fn();
  } finally {
    bridgeStdoutWriteDepth -= 1;
  }
}

export function installCursorSdkStdoutGuard(): () => void {
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((err?: Error) => void),
    cb?: (err?: Error) => void,
  ) => {
    if (bridgeStdoutWriteDepth > 0) {
      return original(chunk, encoding as BufferEncoding, cb);
    }
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    if (isCursorSdkNoiseStdout(text)) {
      if (typeof encoding === "function") encoding();
      else if (cb) cb();
      return true;
    }
    if (process.env.WISE_CURSOR_BRIDGE_DEBUG === "1") {
      return original(chunk, encoding as BufferEncoding, cb);
    }
    if (typeof encoding === "function") encoding();
    else if (cb) cb();
    return true;
  }) as typeof process.stdout.write;
  return () => {
    process.stdout.write = original as typeof process.stdout.write;
  };
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
