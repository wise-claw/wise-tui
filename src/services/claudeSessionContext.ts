import type { ClaudeSession } from "../types";

/** 与 Claude Code 默认 200k 窗口对齐的近似上限（UI 估算，非官方计数）。 */
export const DEFAULT_MAX_CONTEXT_TOKENS = 200_000;

/** 状态栏提示：上下文占用偏高 */
export const CONTEXT_WARN_PERCENT = 75;

/** 发送用户消息前主动 `/compact` 的阈值 */
export const CONTEXT_AUTO_COMPACT_BEFORE_SEND_PERCENT = 88;

/** Claude Code 内置 `/compact` 命令（压缩磁盘 transcript 历史） */
export const CLAUDE_COMPACT_SLASH_PROMPT = "/compact";

export interface SessionContextMetrics {
  estimatedTokens: number;
  ctxPercent: number;
}

/** 状态栏 ctx 占用色阶：<50% 绿，50–80% 黄，80–95% 橙，≥95% 红 */
export type ContextPercentTone = "ok" | "caution" | "high" | "critical";

export function getContextPercentTone(ctxPercent: number): ContextPercentTone {
  if (ctxPercent >= 95) return "critical";
  if (ctxPercent >= 80) return "high";
  if (ctxPercent >= 50) return "caution";
  return "ok";
}

export function contextPercentToneClassName(tone: ContextPercentTone): string {
  return `app-claude-ctx-tone--${tone}`;
}

export interface AutoCompactBeforeSendPlan extends SessionContextMetrics {
  needed: boolean;
}

export function estimateMessageTokens(message: ClaudeSession["messages"][number]): number {
  let textChars = message.content.length;
  for (const part of message.parts) {
    if (part.type === "text" || part.type === "reasoning") {
      textChars += part.text.length;
    } else if (part.type === "tool_use") {
      textChars += part.name.length;
      textChars += JSON.stringify(part.input ?? {}).length;
      textChars += (part.output ?? "").length;
      textChars += (part.error ?? "").length;
    }
  }
  return Math.max(0, Math.round(textChars / 4));
}

export function estimateSessionTokens(session: ClaudeSession): number {
  let textChars = 0;
  for (const message of session.messages) {
    textChars += message.content.length;
    for (const part of message.parts) {
      if (part.type === "text" || part.type === "reasoning") {
        textChars += part.text.length;
      } else if (part.type === "tool_use") {
        textChars += part.name.length;
        textChars += JSON.stringify(part.input ?? {}).length;
        textChars += (part.output ?? "").length;
        textChars += (part.error ?? "").length;
      }
    }
  }
  return Math.max(0, Math.round(textChars / 4));
}

export function estimateContextPercent(
  estimatedTokens: number,
  maxContextTokens: number = DEFAULT_MAX_CONTEXT_TOKENS,
): number {
  if (maxContextTokens <= 0) return 0;
  return Math.min(100, Math.round((estimatedTokens / maxContextTokens) * 100));
}

export function getSessionContextMetrics(session: ClaudeSession): SessionContextMetrics {
  const estimatedTokens = estimateSessionTokens(session);
  return {
    estimatedTokens,
    ctxPercent: estimateContextPercent(estimatedTokens),
  };
}

/** 用户已在发送 `/compact`（或带聚焦说明的变体）时不再套一层自动压缩。 */
export function isCompactSlashPrompt(prompt: string): boolean {
  const trimmed = prompt.trim().toLowerCase();
  return trimmed === "/compact" || trimmed.startsWith("/compact ");
}

/** 识别 Claude API / CLI 常见的上下文溢出报错文案。 */
export function looksLikeContextOverflowError(message: string): boolean {
  const m = message.toLowerCase();
  if (!m.trim()) return false;
  if (m.includes("prompt is too long")) return true;
  if (m.includes("context length")) return true;
  if (m.includes("maximum context")) return true;
  if (m.includes("context window")) return true;
  if (m.includes("too many tokens")) return true;
  if (m.includes("context_limit")) return true;
  if (m.includes("request_too_large")) return true;
  if (m.includes("exceeds") && m.includes("token")) return true;
  if (m.includes("input is too long")) return true;
  return false;
}

/**
 * 是否应在发送本轮用户消息前先跑一轮 `/compact`。
 * 需要已有 Claude `session_id`（磁盘 jsonl 可 resume）；新会话无历史可压。
 */
export function planAutoCompactBeforeSend(
  session: ClaudeSession,
  outgoingPrompt: string,
): AutoCompactBeforeSendPlan {
  const metrics = getSessionContextMetrics(session);
  if (isCompactSlashPrompt(outgoingPrompt)) {
    return { ...metrics, needed: false };
  }
  const claudeSid = session.claudeSessionId?.trim();
  if (!claudeSid) {
    return { ...metrics, needed: false };
  }
  return {
    ...metrics,
    needed: metrics.ctxPercent >= CONTEXT_AUTO_COMPACT_BEFORE_SEND_PERCENT,
  };
}

export function formatContextStatusHint(metrics: SessionContextMetrics): string {
  if (metrics.ctxPercent >= CONTEXT_AUTO_COMPACT_BEFORE_SEND_PERCENT) {
    return "发送前将自动压缩历史";
  }
  if (metrics.ctxPercent >= CONTEXT_WARN_PERCENT) {
    return "上下文偏高，可用 /compact";
  }
  return "";
}

export function buildAutoCompactSystemMessage(metrics: SessionContextMetrics): string {
  return (
    `上下文约 ${metrics.ctxPercent}%（约 ${metrics.estimatedTokens.toLocaleString("zh-CN")} tokens），` +
    "正在自动执行 /compact 压缩历史…"
  );
}

export function buildContextOverflowRetrySystemMessage(): string {
  return "检测到上下文溢出，正在压缩历史后重试发送…";
}
