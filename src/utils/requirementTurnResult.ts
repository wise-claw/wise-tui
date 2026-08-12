import type { ClaudeMessage, ToolUsePart } from "../types";
import { classifyToolActivity } from "./toolGroupActivitySummary";

/**
 * 需求会话「执行结果」判定：需求派发到会话执行完成后，不能只看回合完成状态，
 * 还要看执行结果是否表明需求真的被处理，才允许把需求置为「待验证」。
 *
 * 规则（全部满足才算处理完成）：
 * 1. 最终助手正文没有出现明确的「无法完成 / 未能实现 / 需要补充信息」等未完成信号；
 * 2. 最后一轮有实际执行动作（完成的文件编辑 / 命令 / 其它工具调用），
 *    仅纯文本回复（未做任何事）不算真正处理。
 */

/** 最终回复中表示「需求没有被真正处理」的明确信号。 */
const NON_COMPLETION_SIGNAL_PATTERNS: RegExp[] = [
  /(?:无法|未能|不能|没法|难以)(?:完成|实现|处理|继续|交付)/,
  /(?:暂时无法|暂无法|暂时不能)/,
  /(?:尚未|还未|仍未)(?:完成|实现|处理)/,
  /(?:需要|请)(?:你|您)?(?:再)?(?:提供|补充|完善|确认).{0,12}(?:信息|资料|细节|需求|权限)/,
  /超出.{0,8}(?:能力|处理)范围/,
  /\b(?:unable|not able|failed)\s+to\s+(?:complete|implement|finish|process|proceed)\b/i,
  /\b(?:cannot|can'?t|could not|couldn'?t)\s+(?:complete|implement|finish|process|proceed)\b/i,
  /\b(?:task|requirement|work)\s+(?:is|was|remains|stays)\s+(?:incomplete|unfinished|blocked|stalled)\b/i,
  /\bnot\s+feasible\b/i,
];

/** 最终助手正文是否包含「未完成 / 无法实现」等明确信号。 */
export function hasRequirementTurnNonCompletionSignal(previewRaw: string): boolean {
  const text = typeof previewRaw === "string" ? previewRaw.trim() : "";
  if (!text) return false;
  return NON_COMPLETION_SIGNAL_PATTERNS.some((pattern) => pattern.test(text));
}

/** 最后一轮（最近一次可展示用户消息之后）的 assistant tool_use 部件，顺序与消息相反。 */
function lastTurnToolParts(messages: readonly ClaudeMessage[]): ToolUsePart[] {
  const parts: ToolUsePart[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (message.role === "system") continue;
    if (message.role === "user") {
      // 纯工具结果回执不算新一轮用户输入；含正文的用户消息才是轮次边界。
      const partsOfUser = message.parts ?? [];
      const onlyToolResults =
        partsOfUser.length > 0 && partsOfUser.every((part) => part.type === "tool_use");
      if (!onlyToolResults) break;
      continue;
    }
    if (message.role === "assistant") {
      for (const part of message.parts ?? []) {
        if (part.type === "tool_use") parts.push(part);
      }
    }
  }
  return parts;
}

/**
 * 最后一轮是否有「实际执行动作」：完成的编辑 / 命令 / 其它工具调用。
 * 纯探索（read/glob/ls 等）与纯搜索不视为真正处理；错误状态的工具调用也不计入。
 */
export function requirementTurnHasWorkEvidence(messages: readonly ClaudeMessage[]): boolean {
  for (const part of lastTurnToolParts(messages)) {
    const finished =
      part.status === "completed" || Boolean(part.output?.trim());
    if (!finished) continue;
    const kind = classifyToolActivity(part);
    if (kind === "edit" || kind === "command" || kind === "tool") return true;
  }
  return false;
}

export interface RequirementTurnResultInput {
  messages: readonly ClaudeMessage[];
  previewRaw: string;
}

/** 需求会话执行结果是否表明「真的处理完成」。 */
export function requirementTurnResultProcessed(input: RequirementTurnResultInput): boolean {
  if (hasRequirementTurnNonCompletionSignal(input.previewRaw)) return false;
  return requirementTurnHasWorkEvidence(input.messages ?? []);
}
