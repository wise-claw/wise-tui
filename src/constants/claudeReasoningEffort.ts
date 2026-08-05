/**
 * Claude Code CLI `--effort` 档位（对齐 Composer「推理强度」）。
 * 含 `ultracode`：Claude Code 原生档（约等于 xhigh + 自动工作流编排）。
 * 与 OMC UltracodeChip（注入 system-prompt 并强制 `--effort max`）相互独立。
 */

export const CLAUDE_REASONING_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultracode",
] as const;

export type ClaudeReasoningEffort = (typeof CLAUDE_REASONING_EFFORTS)[number];

export const CLAUDE_REASONING_EFFORT_DEFAULT: ClaudeReasoningEffort = "high";

export const CLAUDE_REASONING_EFFORT_LABELS: Record<ClaudeReasoningEffort, string> = {
  low: "轻度",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高",
  ultracode: "编排",
};

export const CLAUDE_REASONING_EFFORT_HINTS: Record<ClaudeReasoningEffort, string> = {
  low: "最快响应，推理最少",
  medium: "较低延迟",
  high: "默认平衡",
  xhigh: "更深入推理",
  max: "最强推理，不限思考深度",
  ultracode: "xhigh + 自动工作流编排（Claude Code 原生）",
};

export function isClaudeReasoningEffort(value: unknown): value is ClaudeReasoningEffort {
  return (
    typeof value === "string" &&
    (CLAUDE_REASONING_EFFORTS as readonly string[]).includes(value)
  );
}

export function normalizeClaudeReasoningEffort(
  value: unknown,
  fallback: ClaudeReasoningEffort = CLAUDE_REASONING_EFFORT_DEFAULT,
): ClaudeReasoningEffort {
  if (isClaudeReasoningEffort(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (isClaudeReasoningEffort(trimmed)) return trimmed;
  }
  return fallback;
}

export function claudeReasoningEffortLabel(effort: ClaudeReasoningEffort): string {
  return CLAUDE_REASONING_EFFORT_LABELS[effort];
}
