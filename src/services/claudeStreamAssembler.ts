import type { ClaudeMessage, ClaudeSession, MessagePart } from "../types";
import { isToolOnlyUserMessage } from "../utils/claudeChatMessageDisplay";
type ToolUsePart = Extract<MessagePart, { type: "tool_use" }>;

/** 单轮助手消息中 text+reasoning 合计上限，避免流式拼接撑爆主线程内存 */
export const MAX_ASSISTANT_TEXT_REASONING_CHARS = 36_000;

/** 单条 tool_use 的 output 字符串上限（error 同理），避免巨型工具回包常驻内存 */
const MAX_TOOL_PART_OUTPUT_CHARS = 18_000;

/**
 * 为截断提示预留空间：strip 后 text+reasoning 不超过 (MAX - TEXT_REASONING_HEADROOM)，再 prepend 提示后仍 ≤ MAX。
 */
const TEXT_REASONING_HEADROOM = 220;

function countTextReasoningChars(parts: MessagePart[]): number {
  let n = 0;
  for (const p of parts) {
    if (p.type === "text" || p.type === "reasoning") {
      n += p.text.length;
    }
  }
  return n;
}

function stripTextReasoningFromStart(parts: MessagePart[], removeCount: number): MessagePart[] {
  if (removeCount <= 0) {
    return [...parts];
  }
  let remaining = removeCount;
  const out: MessagePart[] = [];
  for (const p of parts) {
    if (p.type === "tool_use") {
      out.push(p);
      continue;
    }
    const len = p.text.length;
    if (len <= remaining) {
      remaining -= len;
      continue;
    }
    const sliceText = p.text.slice(remaining);
    remaining = 0;
    if (sliceText.length > 0) {
      out.push(p.type === "text" ? { type: "text", text: sliceText } : { type: "reasoning", text: sliceText });
    }
  }
  return out;
}

function prependTextReasoningNotice(parts: MessagePart[], omittedChars: number): MessagePart[] {
  if (omittedChars <= 0) {
    return parts;
  }
  const notice = `…[已省略较早前 ${String(omittedChars)} 字以控制内存]\n\n`;
  const idx = parts.findIndex((p) => p.type === "text" || p.type === "reasoning");
  if (idx < 0) {
    return [{ type: "text", text: notice.trimEnd() }, ...parts];
  }
  const next = [...parts];
  const fp = next[idx];
  if (fp.type === "text") {
    next[idx] = { type: "text", text: notice + fp.text };
  } else if (fp.type === "reasoning") {
    next[idx] = { type: "reasoning", text: notice + fp.text };
  }
  return next;
}

function capToolUseOutputs(parts: MessagePart[]): MessagePart[] {
  const tailKeep = MAX_TOOL_PART_OUTPUT_CHARS - 120;
  return parts.map((p) => {
    if (p.type !== "tool_use") {
      return p;
    }
    let next: ToolUsePart = p;
    if (typeof p.output === "string" && p.output.length > MAX_TOOL_PART_OUTPUT_CHARS) {
      const tail = p.output.slice(-tailKeep);
      next = {
        ...next,
        output: `…[工具输出过长已截断，仅保留末尾约 ${String(tailKeep)} 字]\n\n${tail}`,
      };
    }
    if (typeof p.error === "string" && p.error.length > MAX_TOOL_PART_OUTPUT_CHARS) {
      const tail = p.error.slice(-tailKeep);
      next = {
        ...next,
        error: `…[工具错误信息过长已截断，仅保留末尾约 ${String(tailKeep)} 字]\n\n${tail}`,
      };
    }
    return next;
  });
}

function enforceAssistantMessageMemoryLimits(message: ClaudeMessage): ClaudeMessage {
  if (message.role !== "assistant") {
    return message;
  }
  let parts = capToolUseOutputs([...message.parts]);
  const trBefore = countTextReasoningChars(parts);
  if (trBefore <= MAX_ASSISTANT_TEXT_REASONING_CHARS) {
    const content = textContentFromParts(parts);
    return { ...message, parts, content };
  }
  const stripTarget = MAX_ASSISTANT_TEXT_REASONING_CHARS - TEXT_REASONING_HEADROOM;
  const remove = trBefore - stripTarget;
  parts = stripTextReasoningFromStart(parts, remove);
  const trAfter = countTextReasoningChars(parts);
  const omitted = Math.max(0, trBefore - trAfter);
  parts = prependTextReasoningNotice(parts, omitted);
  const content = textContentFromParts(parts);
  return { ...message, parts, content };
}

/** 与 `MAX_ASSISTANT_TEXT_REASONING_CHARS` 对齐的流式缓冲上限，避免 ref 与 messages 双份巨型字符串 */
export function capAssistantStreamBufferText(buffer: string): string {
  if (buffer.length <= MAX_ASSISTANT_TEXT_REASONING_CHARS) {
    return buffer;
  }
  const tail = buffer.slice(-(MAX_ASSISTANT_TEXT_REASONING_CHARS - TEXT_REASONING_HEADROOM));
  const omitted = buffer.length - tail.length;
  return `…[已省略流式缓冲前 ${String(omitted)} 字]\n\n${tail}`;
}

/**
 * 合并相邻 text 片段，按前缀包含关系去重避免拼接翻倍。对称处理两个方向：
 *
 * - incoming 是 existing 的扩展（以 existing 开头或相等）：用 incoming 替换。result 全文、
 *   thinking 全量重放等累积超集场景。
 * - incoming 是 existing 的严格前缀（existing 以 incoming 开头）：保留 existing 丢弃 incoming。
 *   倒序重放/截断重发场景（理论边界；正常 delta 增量是 existing 的接续，无前缀关系）。
 *
 * 正常 text_delta/thinking_delta 增量片段与 existing 无前缀关系，走拼接分支不受影响。
 */
export function mergeTextPartsByContainment(existing: string, incoming: string): string {
  if (existing.length > 0) {
    if (incoming === existing || incoming.startsWith(existing)) {
      return incoming;
    }
    if (existing.startsWith(incoming)) {
      return existing;
    }
  }
  return existing + incoming;
}

export function mergeAssistantParts(existingParts: MessagePart[], incomingParts: MessagePart[]): MessagePart[] {
  const merged = [...existingParts];
  for (const part of incomingParts) {
    if (part.type === "text") {
      const lastText = merged[merged.length - 1];
      if (lastText?.type === "text") {
        merged[merged.length - 1] = { ...lastText, text: mergeTextPartsByContainment(lastText.text, part.text) };
      } else {
        merged.push(part);
      }
      continue;
    }

    if (part.type === "tool_use") {
      const existing = merged.find((p) => p.type === "tool_use" && p.id === part.id);
      if (existing) {
        const idx = merged.indexOf(existing);
        merged[idx] = { ...existing, ...part };
      } else {
        merged.push(part);
      }
      continue;
    }

    const lastReason = merged[merged.length - 1];
    if (lastReason?.type === "reasoning") {
      // 与 text 分支对称：thinking 全量重发/重放时 incoming 可能以 existing 开头或相等，
      // 直接拼接会致思考翻倍。用 containment 合并避免重复，正常 thinking_delta 增量走拼接。
      merged[merged.length - 1] = {
        ...lastReason,
        text: mergeTextPartsByContainment(lastReason.text, part.text),
      };
    } else {
      merged.push(part);
    }
  }
  return merged;
}

function textContentFromParts(parts: MessagePart[]): string {
  return parts.filter((p) => p.type === "text").map((p) => p.text).join("");
}

function buildAssistantMessage(parts: MessagePart[]): ClaudeMessage {
  return {
    id: Date.now(),
    role: "assistant",
    content: textContentFromParts(parts),
    parts: [...parts],
    timestamp: Date.now(),
  };
}

export function isToolResultUpdatePart(part: MessagePart): part is ToolUsePart {
  if (part.type !== "tool_use") return false;
  return (
    part.status === "completed" ||
    part.status === "error" ||
    Boolean(part.output?.trim()) ||
    Boolean(part.error?.trim())
  );
}

/**
 * result 事件整段文本与末条 assistant 现有 text parts 的权威对齐。
 *
 * result 事件的 `json.result` 是整轮最终文本，delta（text_delta）已增量累积进末条 text part。
 * 直接把 result 整段经 {@link mergeAssistantParts} 拼接会正文翻倍；简单跳过又会丢失 delta 未流的尾巴
 * （长驻会话 complete 后不磁盘重载，尾巴丢失会留存到手动刷新）。
 *
 * 以 result 为权威做前缀对齐：result 是现有 text 拼接的超集时，把「尾巴」作为新 text part 返回
 * （{@link appendAssistantStreamParts} 会把它放到末条末尾--末尾是 tool_use 时新增 text part 在工具后，
 * 对齐磁盘态 [intro, tool_use, 总结]；末尾是 text 时合并，content 仍正确）。完全相同/子集/不连续时
 * 返回空（跳过，依赖 delta 已覆盖或 complete 后磁盘重载）。末条无 text 时原样返回兜底防闪空。
 *
 * 范围限定：existingText 取现有 text parts 无分隔拼接，resultText 含段间分隔；多 text block（如
 * [intro, tool_use, 总结] 两块均已被 delta 流过）时二者前缀匹配失败走 disjoint->[]，此时两块已在、
 * 无内容丢失，reconcile 无尾巴回收收益。尾巴回收仅对「单 text block 且 delta 只流了前缀」有效。
 *
 * 缓冲累积（assistantStreamTextByTabRef）与 complete 的 previewRaw 不受影响。
 */
export function reconcileResultFullTextParts(opts: {
  resultParts: MessagePart[];
  existingParts: MessagePart[];
  lastAssistantHasText: boolean;
}): MessagePart[] {
  const { resultParts, existingParts, lastAssistantHasText } = opts;
  // 末条无可见 text：result 早于 delta 到达等，原样注入兜底防闪空
  if (!lastAssistantHasText) {
    return resultParts;
  }
  const existingText = existingParts
    .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
  const resultText = resultParts
    .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
  if (!resultText) {
    return [];
  }
  if (!existingText) {
    return resultParts;
  }
  // result 与现有完全相同：delta 已覆盖，跳过避免翻倍
  if (resultText === existingText) {
    return [];
  }
  // result 是现有超集（delta 流了前缀，result 含尾巴）：返回尾巴，由 mergeAssistantParts 追加到末尾
  if (resultText.startsWith(existingText)) {
    const tail = resultText.slice(existingText.length);
    return tail.trim() ? [{ type: "text", text: tail }] : [];
  }
  // 现有已含 result（result 是现有子集，如 delta 流得比 result 更长）：跳过
  if (existingText.startsWith(resultText)) {
    return [];
  }
  // 不连续（result 与 delta 分歧）：保守跳过，依赖 complete 后磁盘重载落盘规范文本
  return [];
}

export function partitionStreamMessageParts(parts: MessagePart[]): {
  toolResults: ToolUsePart[];
  streamParts: MessagePart[];
} {
  const toolResults: ToolUsePart[] = [];
  const streamParts: MessagePart[] = [];
  for (const part of parts) {
    if (isToolResultUpdatePart(part)) {
      toolResults.push(part);
    } else {
      streamParts.push(part);
    }
  }
  return { toolResults, streamParts };
}

function mergeToolUseWithUpdate(part: ToolUsePart, update: ToolUsePart): ToolUsePart {
  return {
    ...part,
    ...update,
    name: part.name.trim() ? part.name : update.name,
    input: Object.keys(part.input ?? {}).length > 0 ? part.input : update.input,
  };
}

function assistantMessageWithMergedToolParts(
  message: ClaudeMessage,
  updates: readonly ToolUsePart[],
  matchedIds: Set<string>,
): ClaudeMessage | null {
  if (message.role !== "assistant") return null;
  let touched = false;
  const nextParts = message.parts.map((part) => {
    if (part.type !== "tool_use") return part;
    const update = updates.find((u) => u.id === part.id);
    if (!update) return part;
    touched = true;
    matchedIds.add(part.id);
    return mergeToolUseWithUpdate(part, update);
  });
  if (!touched) return null;
  const textContent = nextParts
    .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
  return { ...message, parts: nextParts, content: textContent };
}

/** 将 tool_result 更新合并进已有 assistant 消息里对应的 tool_use（按 id）。 */
export function applyToolResultPartsToMessages(
  messages: readonly ClaudeMessage[],
  updates: readonly ToolUsePart[],
): { messages: ClaudeMessage[]; matchedIds: ReadonlySet<string> } {
  if (updates.length === 0) {
    return { messages: [...messages], matchedIds: new Set<string>() };
  }
  const matchedIds = new Set<string>();
  let changed = false;
  const nextMessages = messages.map((message) => {
    const merged = assistantMessageWithMergedToolParts(message, updates, matchedIds);
    if (!merged) return message;
    changed = true;
    return merged;
  });
  return { messages: changed ? nextMessages : [...messages], matchedIds };
}

/**
 * JSONL 回放：将紧随 assistant tool_use 的纯 tool_result 用户行 fold 进对应 tool_use，
 * 与流式 `applyToolResultPartsToSession` 行为对齐。
 */
export function foldToolResultUserMessagesIntoAssistant(messages: readonly ClaudeMessage[]): ClaudeMessage[] {
  let result: ClaudeMessage[] = [];
  for (const msg of messages) {
    if (!isToolOnlyUserMessage(msg)) {
      result.push(msg);
      continue;
    }
    const updates = msg.parts.filter(
      (part): part is ToolUsePart => part.type === "tool_use" && isToolResultUpdatePart(part),
    );
    if (updates.length === 0) {
      result.push(msg);
      continue;
    }
    const applied = applyToolResultPartsToMessages(result, updates);
    result = applied.messages;
    const orphans = updates.filter((update) => !applied.matchedIds.has(update.id));
    if (orphans.length === 0) continue;
    // 孤儿 user 消息：`content` 留空，避免 stdout 表格被下游当成用户正文渲染。
    // 工具结果输出仍存于 `parts[*].output` / `parts[*].error`，由 MessagePartsDisplay
    // 通过 ToolUsePartDisplay 渲染（带 "工具结果" / "失败" 标签）。
    result.push({
      ...msg,
      parts: orphans,
      content: "",
    });
  }
  return result;
}

/** 将 stream-json 中的 tool_result 合并进历史 assistant 消息里对应的 tool_use（按 id）。 */
export function applyToolResultPartsToSession(session: ClaudeSession, parts: MessagePart[]): ClaudeSession {
  const updates = parts.filter(isToolResultUpdatePart);
  if (updates.length === 0) return session;
  const { messages, matchedIds } = applyToolResultPartsToMessages(session.messages, updates);
  if (matchedIds.size === 0) return session;
  return { ...session, messages };
}

export function appendAssistantStreamParts(session: ClaudeSession, parts: MessagePart[]): ClaudeSession {
  if (parts.length === 0) return session;
  const lastMsg = session.messages[session.messages.length - 1];
  let nextMessages: ClaudeSession["messages"];
  if (lastMsg?.role === "assistant") {
    const mergedParts = mergeAssistantParts(lastMsg.parts, parts);
    const merged: ClaudeMessage = {
      ...lastMsg,
      parts: mergedParts,
      content: textContentFromParts(mergedParts),
    };
    const capped = enforceAssistantMessageMemoryLimits(merged);
    nextMessages = [...session.messages.slice(0, -1), capped];
  } else {
    const built = buildAssistantMessage(parts);
    const cappedNew = enforceAssistantMessageMemoryLimits(built);
    nextMessages = [...session.messages, cappedNew];
  }
  return {
    ...session,
    messages: nextMessages,
  };
}
