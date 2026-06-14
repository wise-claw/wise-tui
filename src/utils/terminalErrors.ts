/** 判断终端 IPC/PTY 错误是否属于预期断开，无需打扰用户。 */
export function shouldIgnoreTerminalError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return (
    lower.includes("terminal session not found") ||
    lower.includes("terminal session exited") ||
    lower.includes("broken pipe") ||
    lower.includes("input/output error") ||
    lower.includes("os error 5") ||
    lower.includes("eio") ||
    lower.includes("not connected") ||
    lower.includes("closed")
  );
}
