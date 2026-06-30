import { CLAUDE_DISK_JSONL_TAIL_LINES_RELOAD } from "../constants/claudeMessageListWindow";
import type { ClaudeSession } from "../types";
import { parseClaudeSessionJsonlLines } from "../utils/claudeSessionJsonl";

/** 与 Claude Code 默认 200k 窗口对齐的近似上限（UI 估算，非官方计数）。 */
export const DEFAULT_MAX_CONTEXT_TOKENS = 200_000;

/** 状态栏提示：上下文占用偏高 */
export const CONTEXT_WARN_PERCENT = 75;

/** 发送用户消息前主动 `/compact` 的阈值 */
export const CONTEXT_AUTO_COMPACT_BEFORE_SEND_PERCENT = 75;

/** 会话空闲时在后台主动 `/compact` 的阈值（早于发送前阈值，减少发送卡顿） */
export const CONTEXT_BACKGROUND_COMPACT_PERCENT = 60;

/** 后台压缩成功后，发送前可跳过重复 compact 的有效期 */
export const CONTEXT_BACKGROUND_COMPACT_FRESH_MS = 180_000;

/** 后台压缩失败后重试冷却 */
export const CONTEXT_BACKGROUND_COMPACT_COOLDOWN_MS = 120_000;

/**
 * 压缩相关 sysmsg 相邻写入去重窗口。
 * 同会话在窗口内写入同 token 的 sysmsg 会复用上一条，避免"自动 + 手动 + 重试"叠三条相同语义的提示。
 */
export const COMPRESS_NOTICE_DEBOUNCE_MS = 3_000;

/** 压缩提示归一化 token，供 sysmsg / status hint / 失败 hint 共享，避免同事实不同字面。 */
export type CompactNoticeKind = "auto-before-send" | "auto-after-send" | "overflow-retry" | "manual";

export interface CompactNoticeTokens {
  /** 写入气泡的 sysmsg 全文。 */
  sysmsg: string;
  /** 写入 status bar / 圆环下方提示的短文案（应避免与 sysmsg 字面重复）。 */
  hint: string;
}

/**
 * 生成「压缩进行中」共享文案对：`sysmsg` 进气泡，`hint` 进底栏。
 * 不同 kind（auto/overflow/manual）共享同一组事实字段，让状态栏与气泡不再描述同一件事两遍。
 */
export function composeCompactNoticeTokens(
  metrics: SessionContextMetrics,
  kind: CompactNoticeKind,
): CompactNoticeTokens {
  const header = `上下文约 ${metrics.ctxPercent}%（约 ${metrics.estimatedTokens.toLocaleString("zh-CN")} tokens）`;
  switch (kind) {
    case "auto-before-send":
      return {
        sysmsg: `${header}，发送前自动 /compact 压缩历史…`,
        hint: "自动压缩中",
      };
    case "auto-after-send":
      return {
        // 先发后压：本轮已发出，等当前 turn 收尾后转后台，体感上消息不卡。
        sysmsg: `${header}，当前消息照常发送，本轮回复后会在后台自动 /compact 压缩历史。`,
        hint: "后台整理",
      };
    case "overflow-retry":
      return {
        sysmsg: `${header}，检测到溢出，压缩历史后重试发送…`,
        hint: "压缩后重试",
      };
    case "manual":
      return {
        sysmsg: `正在执行 /compact 压缩会话历史…（${header}）`,
        hint: "正在压缩",
      };
  }
}

/** 大块 Skill / 工作流斜杠命令：单轮注入上下文多，提前压缩 */
export const CONTEXT_AUTO_COMPACT_HEAVY_SKILL_PERCENT = 60;

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

export interface BackgroundAutoCompactPlan extends SessionContextMetrics {
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
 * 若近期已在后台压缩且占用仍低于发送阈值，则跳过以免重复阻塞。
 */
export function planAutoCompactBeforeSend(
  session: ClaudeSession,
  outgoingPrompt: string,
  metricsOverride?: SessionContextMetrics,
  recentBackgroundCompactAtMs?: number | null,
  nowMs: number = Date.now(),
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
  if (
    recentBackgroundCompactAtMs != null &&
    nowMs - recentBackgroundCompactAtMs <= CONTEXT_BACKGROUND_COMPACT_FRESH_MS &&
    metrics.ctxPercent < threshold
  ) {
    return { ...metrics, needed: false };
  }
  return {
    ...metrics,
    needed: metrics.ctxPercent >= threshold,
  };
}

/** 会话空闲且上下文偏高时，是否应在后台静默 `/compact`。 */
export function planBackgroundAutoCompact(
  session: ClaudeSession,
  metricsOverride?: SessionContextMetrics,
  recentBackgroundCompactAtMs?: number | null,
  nowMs: number = Date.now(),
): BackgroundAutoCompactPlan {
  const metrics = metricsOverride ?? getSessionContextMetrics(session);
  const claudeSid = session.claudeSessionId?.trim();
  if (!claudeSid) {
    return { ...metrics, needed: false };
  }
  if (session.status === "running" || session.status === "connecting") {
    return { ...metrics, needed: false };
  }
  // 先发后压场景下，background 可能紧跟 user turn 触发；fresh 窗口内不再叠加，
  // 避免连发多条「后台整理」sysmsg 或把刚压缩过的 transcript 立刻再压一遍。
  if (
    recentBackgroundCompactAtMs != null &&
    nowMs - recentBackgroundCompactAtMs <= CONTEXT_BACKGROUND_COMPACT_FRESH_MS
  ) {
    return { ...metrics, needed: false };
  }
  return {
    ...metrics,
    needed: metrics.ctxPercent >= CONTEXT_BACKGROUND_COMPACT_PERCENT,
  };
}

export function formatContextStatusHint(
  metrics: SessionContextMetrics,
  outgoingPrompt?: string,
  backgroundCompactInFlight?: boolean,
): string {
  // 状态栏 hint 只展示短标签，避免与气泡 sysmsg 重复表达同一件事；
  // 详细数值（百分比 / token 数）由圆环和气泡承载。
  if (backgroundCompactInFlight) {
    return "后台整理中";
  }
  const threshold = outgoingPrompt
    ? resolveAutoCompactThresholdPercent(outgoingPrompt)
    : CONTEXT_AUTO_COMPACT_BEFORE_SEND_PERCENT;
  if (metrics.ctxPercent >= threshold) {
    // 先发后压：到达阈值后本轮消息照常发送，turn 收尾时后台自动压缩。
    // 文案避免"将同步压缩"的暗示，统一描述成后台行为。
    if (outgoingPrompt && isHeavyContextSlashPrompt(outgoingPrompt)) {
      return "大块 Skill 后台整理";
    }
    return "后台自动整理";
  }
  if (metrics.ctxPercent >= CONTEXT_BACKGROUND_COMPACT_PERCENT) {
    return "空闲时自动整理";
  }
  if (metrics.ctxPercent >= CONTEXT_WARN_PERCENT) {
    return "上下文偏高";
  }
  return "";
}

/** 先发后压：告知用户本轮消息照常发送，turn 收尾后转后台压缩。 */
export function buildAutoCompactAfterSendSystemMessage(metrics: SessionContextMetrics): string {
  return composeCompactNoticeTokens(metrics, "auto-after-send").sysmsg;
}

export function buildContextOverflowRetrySystemMessage(metrics?: SessionContextMetrics): string {
  if (!metrics) {
    return "检测到上下文溢出，正在压缩历史后重试发送…";
  }
  return composeCompactNoticeTokens(metrics, "overflow-retry").sysmsg;
}

export function buildContextOverflowFailureHint(): string {
  // 单行短提示：失败细节走 status bar hint 与本地斜杠命令提示，气泡只放一行
  // 简洁说明，避免与前一条「压缩中」sysmsg 重复表达同一件事。
  return "上下文仍超出模型限制，请发送 /compact 并附带聚焦说明，或 /clear 开新会话。";
}
