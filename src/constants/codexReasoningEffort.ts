/**
 * Codex app-server `turn/start.effort` 档位（对齐 ChatGPT「推理强度」）。
 * 档位名与协议 `supportedReasoningEfforts[].reasoningEffort` 一致；UI 用中文标签。
 */

export const CODEX_REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "ultra",
] as const;

export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];

export const CODEX_REASONING_EFFORT_DEFAULT: CodexReasoningEffort = "medium";

export const CODEX_REASONING_EFFORT_LABELS: Record<CodexReasoningEffort, string> = {
  minimal: "极低",
  low: "轻度",
  medium: "中",
  high: "高",
  xhigh: "极高",
  ultra: "最高",
};

export const CODEX_REASONING_EFFORT_HINTS: Record<CodexReasoningEffort, string> = {
  minimal: "最快响应，推理最少",
  low: "较低延迟",
  medium: "默认平衡",
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
