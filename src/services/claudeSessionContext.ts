import { CLAUDE_DISK_JSONL_TAIL_LINES_RELOAD } from "../constants/claudeMessageListWindow";
import type { ClaudeSession } from "../types";
import { parseClaudeSessionJsonlLines } from "../utils/claudeSessionJsonl";

/** 与 Claude Code 默认 200k 窗口对齐的近似上限（UI 估算，非官方计数）。 */
export const DEFAULT_MAX_CONTEXT_TOKENS = 200_000;

/** 状态栏提示：上下文占用偏高 */
export const CONTEXT_WARN_PERCENT = 75;

/** 发送用户消息前主动 `/compact` 的阈值 */
export const CONTEXT_AUTO_COMPACT_BEFORE_SEND_PERCENT = 88;

/** 大块 Skill / 工作流斜杠命令：单轮注入上下文多，提前压缩 */
export const CONTEXT_AUTO_COMPACT_HEAVY_SKILL_PERCENT = 72;

/** 内存估算偏高时主动读磁盘 jsonl 尾部以对齐 resume 历史 */
export const CONTEXT_DISK_ESTIMATE_LOAD_PERCENT = 70;

/** jsonl 尾部采样已满时保守抬高估算（真实 transcript 通常更长） */
export const CONTEXT_SATURATED_TAIL_MIN_PERCENT = 92;

/** 一次性注入大量参考文档的 Claude Code 内置斜杠命令 */
export const HEAVY_CONTEXT_SLASH_COMMAND_LABELS: ReadonlySet<string> = new Set([
  "batch",
  "claude-api",
  "code-review",
  "debug",
  "deep-research",
  "insights",
  "init",
]);

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

export function estimateTokensFromMessages(messages: readonly ClaudeSession["messages"][number][]): number {
  let total = 0;
  for (const message of messages) {
    total += estimateMessageTokens(message);
  }
  return total;
}

export function estimateSessionTokens(session: ClaudeSession): number {
  return estimateTokensFromMessages(session.messages);
}

/** 从 Claude Code 磁盘 `*.jsonl` 行估算上下文（员工/团队标签内存消息为空时仍可对齐 resume 历史）。 */
export function estimateTokensFromJsonlLines(lines: readonly string[]): number {
  const trimmed = lines.map((line) => line.trim()).filter(Boolean);
  if (trimmed.length === 0) return 0;
  const messages = parseClaudeSessionJsonlLines([...trimmed]);
  if (messages.length > 0) {
    return estimateTokensFromMessages(messages);
  }
  let textChars = 0;
  for (const line of trimmed) {
    textChars += line.length;
  }
  return Math.max(0, Math.round(textChars / 4));
}

export type LoadClaudeJsonlForContextEstimate = (
  repositoryPath: string,
  claudeSessionId: string,
  options?: { tailLines?: number | null },
) => Promise<string[]>;

/**
 * 员工/团队派发会话常因标签未激活而 `messages=[]`，但磁盘 transcript 已很长；
 * 发送前需读 jsonl 才能正确触发自动 `/compact`。
 */
export function shouldLoadDiskForContextEstimate(session: ClaudeSession): boolean {
  const claudeSid = session.claudeSessionId?.trim();
  if (!claudeSid || !session.repositoryPath?.trim()) return false;
  if (session.messages.length === 0) return true;
  if (session.diskTranscriptPartial) return true;
  return getSessionContextMetrics(session).ctxPercent >= CONTEXT_DISK_ESTIMATE_LOAD_PERCENT;
}

export async function resolveSessionContextMetricsForSend(
  session: ClaudeSession,
  loadJsonl: LoadClaudeJsonlForContextEstimate,
): Promise<SessionContextMetrics> {
  const memory = getSessionContextMetrics(session);
  if (!shouldLoadDiskForContextEstimate(session)) {
    return memory;
  }
  const cc = session.claudeSessionId!.trim();
  const rp = session.repositoryPath.trim();
  try {
    const tailLines = await loadJsonl(rp, cc, {
      tailLines: CLAUDE_DISK_JSONL_TAIL_LINES_RELOAD,
    });
    let diskTokens = estimateTokensFromJsonlLines(tailLines);
    const tailSaturated = tailLines.length >= CLAUDE_DISK_JSONL_TAIL_LINES_RELOAD;
    if (tailSaturated) {
      const saturatedFloor = Math.round(
        (DEFAULT_MAX_CONTEXT_TOKENS * CONTEXT_SATURATED_TAIL_MIN_PERCENT) / 100,
      );
      diskTokens = Math.max(diskTokens, saturatedFloor);
    }
    const estimatedTokens = Math.max(memory.estimatedTokens, diskTokens);
    return {
      estimatedTokens,
      ctxPercent: estimateContextPercent(estimatedTokens),
    };
  } catch {
    return memory;
  }
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

/** 从用户输入提取首个斜杠命令 label（不含 `/`）。 */
export function extractSlashCommandLabel(prompt: string): string | null {
  const trimmed = prompt.trim();
  if (!trimmed.startsWith("/")) return null;
  const label = trimmed.slice(1).trim().split(/\s+/)[0]?.toLowerCase();
  return label || null;
}

/** 会一次性加载大块 Skill / 工作流上下文的斜杠命令。 */
export function isHeavyContextSlashPrompt(prompt: string): boolean {
  const label = extractSlashCommandLabel(prompt);
  return label != null && HEAVY_CONTEXT_SLASH_COMMAND_LABELS.has(label);
}

export function resolveAutoCompactThresholdPercent(outgoingPrompt: string): number {
  if (isHeavyContextSlashPrompt(outgoingPrompt)) {
    return CONTEXT_AUTO_COMPACT_HEAVY_SKILL_PERCENT;
  }
  return CONTEXT_AUTO_COMPACT_BEFORE_SEND_PERCENT;
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
  metricsOverride?: SessionContextMetrics,
): AutoCompactBeforeSendPlan {
  const metrics = metricsOverride ?? getSessionContextMetrics(session);
  if (isCompactSlashPrompt(outgoingPrompt)) {
    return { ...metrics, needed: false };
  }
  const claudeSid = session.claudeSessionId?.trim();
  if (!claudeSid) {
    return { ...metrics, needed: false };
  }
  const threshold = resolveAutoCompactThresholdPercent(outgoingPrompt);
  return {
    ...metrics,
    needed: metrics.ctxPercent >= threshold,
  };
}

export function formatContextStatusHint(
  metrics: SessionContextMetrics,
  outgoingPrompt?: string,
): string {
  const threshold = outgoingPrompt
    ? resolveAutoCompactThresholdPercent(outgoingPrompt)
    : CONTEXT_AUTO_COMPACT_BEFORE_SEND_PERCENT;
  if (metrics.ctxPercent >= threshold) {
    if (outgoingPrompt && isHeavyContextSlashPrompt(outgoingPrompt)) {
      return "大块 Skill 发送前将自动压缩历史";
    }
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

export function buildContextOverflowFailureHint(): string {
  return (
    "上下文仍超出模型限制。请发送 /compact 并附带聚焦说明，或 /clear 开新会话；" +
    "大块 Skill（如 /claude-api、/deep-research）建议在压缩后或新会话中使用。"
  );
}
