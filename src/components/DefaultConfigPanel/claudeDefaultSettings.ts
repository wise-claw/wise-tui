/**
 * Claude 启动默认 `--settings` 的纯逻辑工具：解析、校验、格式化、ultracode 开关。
 * 与 Rust 侧 `build_claude_spawn_settings_payload` 的语义对应——用户 settings 作为顶层对象，
 * 由后端合并进 FCC 认证 settings 文件后经单一 `--settings` 注入。
 */

/** 占位示例。 */
export const CLAUDE_DEFAULT_SETTINGS_PLACEHOLDER = `{"ultracode": true}`;

/** `--permission-mode` 合法取值（对齐 claude code CLI）。 */
export const CLAUDE_PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
] as const;
export type ClaudePermissionMode = (typeof CLAUDE_PERMISSION_MODES)[number];

/**
 * 把 settings 文本解析为对象。空文本返回空对象 `{}`；非法或非对象（数组/原始值）返回 `null`。
 */
export function parseClaudeDefaultSettings(text: string): Record<string, unknown> | null {
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

/** 当前 settings 文本是否启用 ultracode（顶层 `ultracode: true`）。 */
export function isUltracodeEnabledInSettings(text: string): boolean {
  const obj = parseClaudeDefaultSettings(text);
  if (!obj) return false;
  return obj["ultracode"] === true;
}

/**
 * 读取 `permissionMode`（camelCase，与 Rust `extract_claude_permission_mode` 对齐）。
 * 非合法取值/未设置/空文本/非法 JSON 返回 `null`（后端回退 `bypassPermissions`）。
 */
export function extractPermissionMode(text: string): ClaudePermissionMode | null {
  const obj = parseClaudeDefaultSettings(text);
  if (!obj) return null;
  const v = obj["permissionMode"];
  if (typeof v !== "string") return null;
  return (CLAUDE_PERMISSION_MODES as readonly string[]).includes(v)
    ? (v as ClaudePermissionMode)
    : null;
}

/**
 * 设置 `permissionMode`，返回新的 settings JSON 文本。
 * - 传入合法值：置该键（保留其它键）；
 * - 传入 `null`：移除该键（后端回退默认 `bypassPermissions`）；
 * - 结果为空对象时返回空串。
 * 当前文本非法时按空对象处理。
 */
export function setPermissionModeInSettings(
  text: string,
  mode: ClaudePermissionMode | null,
): string {
  const obj = parseClaudeDefaultSettings(text) ?? {};
  if (mode) {
    obj["permissionMode"] = mode;
  } else {
    delete obj["permissionMode"];
  }
  if (Object.keys(obj).length === 0) return "";
  return JSON.stringify(obj, null, 2);
}

/**
 * 开启/关闭 ultracode 键，返回新的 settings JSON 文本。
 * - 开启：在当前对象上置 `ultracode: true`；
 * - 关闭：删除 `ultracode` 键；
 * - 结果为空对象时返回空串（等同不注入）。
 * 当前文本非法时按空对象处理。
 */
export function toggleUltracodeInSettings(text: string, enabled: boolean): string {
  const obj = parseClaudeDefaultSettings(text) ?? {};
  if (enabled) {
    obj["ultracode"] = true;
  } else {
    delete obj["ultracode"];
  }
  if (Object.keys(obj).length === 0) return "";
  return JSON.stringify(obj, null, 2);
}

/**
 * 当前 settings 是否显式禁用 bash 沙箱（`sandbox.enabled === false`）。
 *
 * 沙箱是 Claude Code 独立于 permission mode 的 OS 级文件系统/网络隔离
 * （macOS Seatbelt / Linux bubblewrap）：即使 `--permission-mode bypassPermissions`
 * （wise-tui 已默认启用，绕过权限提示），沙箱若启用仍会限制 Bash 命令的文件/网络访问。
 * 注入 `{"sandbox":{"enabled":false}}` 即显式关闭。
 */
export function isSandboxDisabledInSettings(text: string): boolean {
  const obj = parseClaudeDefaultSettings(text);
  if (!obj) return false;
  const sandbox = obj["sandbox"];
  return (
    typeof sandbox === "object" &&
    sandbox !== null &&
    !Array.isArray(sandbox) &&
    (sandbox as Record<string, unknown>)["enabled"] === false
  );
}

/**
 * 开启/关闭「取消沙箱限制」。
 * - 开启：在 `sandbox` 对象上置 `enabled: false`（保留 sandbox 下其它键，如 allowWrite）；
 * - 关闭：移除 `sandbox.enabled`；若 `sandbox` 仅剩空对象则一并移除 `sandbox` 键。
 * 当前文本非法时按空对象处理。
 */
export function toggleSandboxDisabledInSettings(text: string, disabled: boolean): string {
  const obj = parseClaudeDefaultSettings(text) ?? {};
  if (disabled) {
    const existing = obj["sandbox"];
    const sandboxObj =
      typeof existing === "object" && existing !== null && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    sandboxObj["enabled"] = false;
    obj["sandbox"] = sandboxObj;
  } else {
    const existing = obj["sandbox"];
    if (typeof existing === "object" && existing !== null && !Array.isArray(existing)) {
      const sandboxObj = { ...(existing as Record<string, unknown>) };
      delete sandboxObj["enabled"];
      if (Object.keys(sandboxObj).length === 0) {
        delete obj["sandbox"];
      } else {
        obj["sandbox"] = sandboxObj;
      }
    }
  }
  if (Object.keys(obj).length === 0) return "";
  return JSON.stringify(obj, null, 2);
}

/**
 * 格式化 settings JSON 文本。空文本返回空串；非法或非对象抛错。
 */
export function formatClaudeDefaultSettings(text: string): string {
  const t = text.trim();
  if (!t) return "";
  const obj = JSON.parse(t);
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("必须是 JSON 对象");
  }
  return JSON.stringify(obj, null, 2);
}
