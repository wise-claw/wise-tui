import {
  EXECUTION_ENVIRONMENT_ENGINE_MENTION_NAMES,
  EXECUTION_ENVIRONMENT_MENTION_NAME,
} from "../constants/executionEnvironmentDispatch";
import type { DefaultInstructionResolveContext } from "./resolveComposerDefaultInstructionOutbound";
import {
  defaultInstructionAliasValues,
  resolveComposerDefaultInstructionOutbound,
} from "./resolveComposerDefaultInstructionOutbound";

/** 规范化默认指令（如 `/autopilot`）。 */
export function normalizeComposerDefaultInstruction(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/")) return trimmed;
  if (/^[\w-]+$/.test(trimmed)) return `/${trimmed}`;
  return trimmed;
}

/** 输入框前缀 chip 展示：`[/autopilot]` */
export function formatComposerDefaultInstructionChip(instruction: string): string {
  const normalized = normalizeComposerDefaultInstruction(instruction);
  return normalized ? `[${normalized}]` : "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function plainStartsWithInstruction(plain: string, instruction: string): boolean {
  const trimmed = plain.trim();
  const normalized = normalizeComposerDefaultInstruction(instruction);
  if (!trimmed || !normalized) return false;
  const lower = trimmed.toLowerCase();
  const instrLower = normalized.toLowerCase();
  return (
    lower === instrLower ||
    lower.startsWith(`${instrLower} `) ||
    lower.startsWith(`${instrLower}\n`)
  );
}

const KNOWN_MULTI_TOKEN_AT_MENTION_NAMES = [
  ...Object.values(EXECUTION_ENVIRONMENT_ENGINE_MENTION_NAMES),
  EXECUTION_ENVIRONMENT_MENTION_NAME,
].sort((left, right) => right.length - left.length);

function isAtMentionTailBoundary(tail: string): boolean {
  return !tail || !/[\p{L}\p{N}_-]/u.test(tail);
}

function consumeKnownMultiTokenAtMention(text: string, atIndex: number): number | null {
  for (const mentionName of KNOWN_MULTI_TOKEN_AT_MENTION_NAMES) {
    for (const prefix of ["@", "＠"] as const) {
      const token = `${prefix}${mentionName}`;
      if (!text.startsWith(token, atIndex)) continue;
      const tail = text[atIndex + token.length] ?? "";
      if (isAtMentionTailBoundary(tail)) {
        return atIndex + token.length;
      }
    }
  }
  return null;
}

/** 解析正文开头的 @ 对象前缀（可连续多个，如 `@终端1 @终端2`）。 */
export function splitLeadingAtMentionPrefix(text: string): { mentionPrefix: string; body: string } {
  let pos = 0;
  const len = text.length;
  while (pos < len) {
    if (pos > 0) {
      while (pos < len && /\s/u.test(text[pos]!)) pos += 1;
      if (pos >= len) break;
    }
    const ch = text[pos];
    if (ch !== "@" && ch !== "＠") break;
    const knownEnd = consumeKnownMultiTokenAtMention(text, pos);
    if (knownEnd != null) {
      pos = knownEnd;
      continue;
    }
    pos += 1;
    while (pos < len && !/\s/u.test(text[pos]!)) pos += 1;
  }
  return {
    mentionPrefix: text.slice(0, pos).trimEnd(),
    body: text.slice(pos).trimStart(),
  };
}

function segmentContainsInstruction(segment: string, candidates: readonly string[]): boolean {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeComposerDefaultInstruction(candidate);
    if (!normalized || seen.has(normalized.toLowerCase())) continue;
    seen.add(normalized.toLowerCase());
    const trimmed = segment.trim();
    if (!trimmed) continue;
    if (plainStartsWithInstruction(trimmed, normalized)) return true;
    const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(normalized)}(?:\\s|$)`, "iu");
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

/** 是否应在发送时为该正文自动添加默认指令。 */
export function shouldApplyComposerDefaultInstruction(
  plain: string,
  instruction: string,
  resolveContext?: DefaultInstructionResolveContext,
): boolean {
  const outbound = resolveComposerDefaultInstructionOutbound(instruction, resolveContext);
  if (!outbound) return false;
  const trimmed = plain.trim();
  if (!trimmed) return true;

  const { mentionPrefix, body } = splitLeadingAtMentionPrefix(trimmed);
  const target = mentionPrefix ? body : trimmed;
  const aliases = defaultInstructionAliasValues(instruction, resolveContext);

  if (segmentContainsInstruction(target, aliases)) return false;
  if (target && target.startsWith("/")) return false;
  return true;
}

/**
 * 为待发正文添加默认指令：
 * - 无 @ 对象：前缀到正文前（如 `/autopilot 你好`）
 * - 有 @ 对象：插入到 @ 对象之后（如 `@终端1 /autopilot 你好`）
 */
export function applyComposerDefaultInstruction(
  plain: string,
  instruction: string,
  resolveContext?: DefaultInstructionResolveContext,
): string {
  const outbound = resolveComposerDefaultInstructionOutbound(instruction, resolveContext);
  if (!outbound) return plain;
  const trimmed = plain.trim();
  if (!shouldApplyComposerDefaultInstruction(trimmed, instruction, resolveContext)) {
    return trimmed;
  }
  if (!trimmed) return outbound;

  const { mentionPrefix, body } = splitLeadingAtMentionPrefix(trimmed);
  if (!mentionPrefix) {
    return body ? `${outbound} ${body}` : outbound;
  }
  if (!body) return `${mentionPrefix} ${outbound}`;
  return `${mentionPrefix} ${outbound} ${body}`;
}

/** 若配置了默认指令且会作用于该正文，返回实际执行的斜杠命令（供气泡展示）。 */
export function resolveAppliedComposerDefaultInstruction(
  plain: string,
  instruction: string,
  resolveContext?: DefaultInstructionResolveContext,
): string {
  const outbound = resolveComposerDefaultInstructionOutbound(instruction, resolveContext);
  if (!outbound) return "";
  if (!shouldApplyComposerDefaultInstruction(plain.trim(), instruction, resolveContext)) return "";
  return outbound;
}
