/**
 * Wise ultracode 模式与 Claude Code effort 的对齐常量。
 *
 * - `ULTRACODE_CLAUDE_EFFORT_LEVEL`：写入 spawn settings（`effortLevel` /
 *   `env.CLAUDE_CODE_EFFORT_LEVEL`），供 OMC / Claude Code settings 消费。
 * - `ULTRACODE_SPAWN_CLI_EFFORT`：透传 `--effort` 时使用；当前 Claude CLI 仅接受
 *   low/medium/high/xhigh/max，不接受 `ultracode`，故 ultracode 激活时用 `max` 兜底。
 */
export const ULTRACODE_CLAUDE_EFFORT_LEVEL = "ultracode" as const;

/** ultracode 激活时 spawn CLI 的 `--effort` 档位（原生 CLI 合法值）。 */
export const ULTRACODE_SPAWN_CLI_EFFORT = "max" as const;

export type UltracodeClaudeEffortLevel = typeof ULTRACODE_CLAUDE_EFFORT_LEVEL;

/** spawn `--effort` / settings `effortLevel` 合法取值（对齐 Claude Code CLI）。 */
export const CLAUDE_EFFORT_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  ULTRACODE_CLAUDE_EFFORT_LEVEL,
] as const;

export type ClaudeEffortLevel = (typeof CLAUDE_EFFORT_LEVELS)[number];

export function isClaudeEffortLevel(value: string): value is ClaudeEffortLevel {
  return (CLAUDE_EFFORT_LEVELS as readonly string[]).includes(value);
}
