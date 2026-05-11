/**
 * 解析 Claude 完成事件 payload 中的成功标记；与 Rust `ClaudeCompletePayload`（camelCase）及旧版 boolean 兼容。
 * 若对象未带 `success` 字段，勿默认失败（否则多会话 / invocation 通道易误报「执行失败」）。
 */
export function resolveClaudeCompleteSuccess(payload: unknown): boolean {
  if (typeof payload === "boolean") return payload;
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    const o = payload as Record<string, unknown>;
    if (typeof o.success === "boolean") return o.success;
    if (!("success" in o)) return true;
    if (o.success === null || o.success === undefined) return true;
  }
  return false;
}
