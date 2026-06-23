/**
 * opencode 启动默认权限设置的纯逻辑工具：解析、序列化、模式切换、permission JSON 格式化。
 *
 * 与 Rust 侧 `OpencodeDefaultSettings`（camelCase serde）对应：
 * - `mode == "auto"`（或缺省）：后端保留 `--dangerously-skip-permissions`（自动批准，现状）；
 * - `mode == "custom"`：后端移除 skip，把 `permissionJson` 注入 `OPENCODE_PERMISSION` 环境变量
 *   （allow/ask/deny 规则全部生效）。
 *
 * `permissionJson` 是 `OPENCODE_PERMISSION` 的内容（permission 规则 JSON 文本），
 * 嵌套在外层 settings JSON 的 `permissionJson` 字段里。
 */

export type OpencodePermissionMode = "auto" | "custom";

/** 占位示例（禁止 rm -rf 与 git push）。 */
export const OPENCODE_PERMISSION_PLACEHOLDER = `{
  "bash": {
    "rm -rf *": "deny",
    "git push *": "deny"
  }
}`;

/**
 * 把 settings 文本解析为对象。空文本返回空对象 `{}`；非法或非对象返回 `null`。
 */
export function parseOpencodeDefaultSettings(text: string): Record<string, unknown> | null {
  const t = text.trim();
  if (!t) return {};
  let obj: unknown;
  try {
    obj = JSON.parse(t);
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return null;
  return obj as Record<string, unknown>;
}

/** 读取权限模式；未设置或非法返回 `null`（UI 上 null 等同 `auto` = 现状）。 */
export function extractOpencodeMode(text: string): OpencodePermissionMode | null {
  const obj = parseOpencodeDefaultSettings(text);
  if (!obj) return null;
  const v = obj["mode"];
  return v === "auto" || v === "custom" ? v : null;
}

/** 读取 `permissionJson` 文本；未设置或非法返回空串。 */
export function extractOpencodePermissionJson(text: string): string {
  const obj = parseOpencodeDefaultSettings(text);
  if (!obj) return "";
  const v = obj["permissionJson"];
  return typeof v === "string" ? v : "";
}

/**
 * 序列化模式 + permissionJson 为 JSON 文本。
 * - `mode == null` 或 `"auto"`：返回空串（auto 模式不使用规则，等同现状）；
 * - `mode == "custom"`：存 `{mode:"custom", permissionJson?}`；permissionJson 为空时不存该字段。
 */
export function serializeOpencodeDefaultSettings(
  mode: OpencodePermissionMode | null,
  permissionJson: string | null,
): string {
  if (mode === null || mode === "auto") return "";
  const pj = (permissionJson ?? "").trim();
  const obj: Record<string, string> = { mode: "custom" };
  if (pj) obj["permissionJson"] = pj;
  return JSON.stringify(obj, null, 2);
}

/**
 * 切换权限模式。
 * - 切到 `custom`：保留已有 permissionJson；
 * - 切到 `auto`：清空（返回空串，auto 模式不使用规则）。
 */
export function toggleOpencodeMode(text: string, mode: OpencodePermissionMode): string {
  if (mode === "auto") return "";
  const existing = extractOpencodePermissionJson(text);
  return serializeOpencodeDefaultSettings("custom", existing);
}

/**
 * 格式化 permission JSON 文本（`OPENCODE_PERMISSION` 的内容）。
 * 空文本返回空串；非法 JSON 抛错。
 */
export function formatPermissionJson(text: string): string {
  const t = text.trim();
  if (!t) return "";
  const obj = JSON.parse(t);
  return JSON.stringify(obj, null, 2);
}

/** 校验 permission JSON 文本合法（空文本视为合法 = 不注入 env）。 */
export function isValidPermissionJson(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}
