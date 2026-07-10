/**
 * Wise ultracode 模式与 Claude Code effort 的对齐常量。
 *
 * - `ULTRACODE_SPAWN_CLI_EFFORT`：ultracode 激活时 spawn CLI 的 `--effort` 档位；
 *   Claude CLI 仅接受 low/medium/high/xhigh/max，故用 `max` 兜底。
 * - settings JSON 的 `effortLevel` 不接受 `ultracode`（见 claude-code-settings.schema.json），
 *   默认配置开关只写顶层 `ultracode: true`。
 */
export const ULTRACODE_SPAWN_CLI_EFFORT = "max" as const;
