/**
 * Codex 推理强度偏好。default 只用于 Wise UI/存储，RPC 省略 effort，
 * 由原生线程及配置解析；其它值为显式 `turn/start.effort` 覆盖。
 */

export const CODEX_REASONING_EFFORTS = [
  "default",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "ultra",
] as const;

export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];

export const CODEX_REASONING_EFFORT_DEFAULT: CodexReasoningEffort = "default";

export const CODEX_REASONING_EFFORT_LABELS: Record<CodexReasoningEffort, string> = {
  default: "跟随 Codex",
  minimal: "极低",
  low: "轻度",
  medium: "中",
  high: "高",
  xhigh: "极高",
  ultra: "最高",
};

export const CODEX_REASONING_EFFORT_HINTS: Record<CodexReasoningEffort, string> = {
  default: "沿用当前 Codex 线程或原生配置的推理强度",
  minimal: "最快响应，推理最少",
  low: "较低延迟",
  medium: "平衡推理与速度",
  high: "更深入推理",
  xhigh: "高强度推理",
  ultra: "最强推理（含多代理编排）",
};

export function isCodexReasoningEffort(value: unknown): value is CodexReasoningEffort {
  return (
    typeof value === "string" &&
    (CODEX_REASONING_EFFORTS as readonly string[]).includes(value)
  );
}

export function normalizeCodexReasoningEffort(
  value: unknown,
  fallback: CodexReasoningEffort = CODEX_REASONING_EFFORT_DEFAULT,
): CodexReasoningEffort {
  if (isCodexReasoningEffort(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (isCodexReasoningEffort(trimmed)) return trimmed;
  }
  return fallback;
}

export function codexReasoningEffortLabel(effort: CodexReasoningEffort): string {
  return CODEX_REASONING_EFFORT_LABELS[effort];
}
