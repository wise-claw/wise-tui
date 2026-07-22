/**
 * codex 启动默认沙箱/审批设置的纯逻辑工具：解析、序列化、「取消沙箱限制」开关。
 *
 * 与 Rust 侧 `CodexDefaultSettings`（camelCase serde）对应：用户配置作为 JSON 对象，
 * 由后端 `execute_codex_code` 读取后注入 `codex exec`：
 * - fresh：`-s <sandboxMode>` + 可选 `-c approval_policy=…`
 * - resume：`-c sandbox_mode=…`（resume 无 `-s`，必须覆盖以免旧 read-only 会话写不了）
 */

/** sandbox_mode 取值。 */
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

/** approval_policy 取值。 */
export type CodexApprovalPolicy = "untrusted" | "on-request" | "never";

/** 占位示例（取消沙箱限制 = danger-full-access + never）。 */
export const CODEX_DEFAULT_SETTINGS_PLACEHOLDER = `{
  "sandboxMode": "danger-full-access",
  "approvalPolicy": "never"
}`;

/**
 * 把 settings 文本解析为对象。空文本返回空对象 `{}`；非法或非对象（数组/原始值）返回 `null`。
 */
export function parseCodexDefaultSettings(text: string): Record<string, unknown> | null {
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

/** 读取 `sandboxMode`；未设置或非法返回 `null`（UI 上 null = 「默认」= 后端回退 workspace-write）。 */
export function extractCodexSandboxMode(text: string): string | null {
  const obj = parseCodexDefaultSettings(text);
  if (!obj) return null;
  const v = obj["sandboxMode"];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** 读取 `approvalPolicy`；未设置或非法返回 `null`（UI 上 null = 「默认」= 后端不传 `-c`）。 */
export function extractCodexApprovalPolicy(text: string): string | null {
  const obj = parseCodexDefaultSettings(text);
  if (!obj) return null;
  const v = obj["approvalPolicy"];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** 是否处于「取消沙箱限制」状态（`sandboxMode=danger-full-access` 且 `approvalPolicy=never`）。 */
export function isFullAccessInCodexSettings(text: string): boolean {
  return (
    extractCodexSandboxMode(text) === "danger-full-access" &&
    extractCodexApprovalPolicy(text) === "never"
  );
}

/**
 * 序列化 `sandboxMode`/`approvalPolicy` 为 JSON 文本。两者都为空（null/空串）时返回空串（等同不注入）。
 */
export function serializeCodexDefaultSettings(
  sandboxMode: string | null,
  approvalPolicy: string | null,
): string {
  const obj: Record<string, string> = {};
  const sm = sandboxMode?.trim();
  const ap = approvalPolicy?.trim();
  if (sm) obj["sandboxMode"] = sm;
  if (ap) obj["approvalPolicy"] = ap;
  if (Object.keys(obj).length === 0) return "";
  return JSON.stringify(obj, null, 2);
}

/**
 * 开启/关闭「取消沙箱限制」。
 * - 开启：置 `sandboxMode=danger-full-access` + `approvalPolicy=never`；
 * - 关闭：清这两项（codex 配置仅此两字段，结果为空串）。
 * 当前文本非法时按空对象处理。
 */
export function toggleFullAccessInCodexSettings(text: string, enabled: boolean): string {
  if (enabled) {
    return serializeCodexDefaultSettings("danger-full-access", "never");
  }
  const obj = parseCodexDefaultSettings(text) ?? {};
  delete obj["sandboxMode"];
  delete obj["approvalPolicy"];
  if (Object.keys(obj).length === 0) return "";
  return JSON.stringify(obj, null, 2);
}
