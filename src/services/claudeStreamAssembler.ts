import type { ClaudeMessage, ClaudeSession, MessagePart } from "../types";
import { isToolOnlyUserMessage } from "../utils/claudeChatMessageDisplay";
import {
  assistantTextJoinedFromParts,
  shouldStartNewAssistantTextPart,
} from "../utils/assistantTextParts";
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
 * 计算下一轮流式助手缓冲文本（complete 时 previewRaw 的 fromRef 源）。
 *
 * - result 事件（isResultFullText=true）：result 给的是整轮权威最终文本，直接覆盖缓冲对齐权威。
 *   若用追加（prevAssist + text），缓冲已含 delta 累积的 intro/总结，再追加整轮文本会翻倍 ->
 *   complete 时 fromRef 取此缓冲、previewRaw 取最长拿到翻倍文本 -> notifyCompletion 通知内容翻倍。
 *   text 为空时保持 prevAssist（result 无文本，不覆盖）。
 * - delta 事件（isResultFullText=false）：增量追加 prevAssist + text。
 *
 * `text` 由调用方从 parts 过滤拼接（reasoning 不入缓冲，调用方已排除）。返回未截断文本，
 * 由调用方 {@link capAssistantStreamBufferText} 截断。
 */
export function computeAssistantStreamBufferText(
  prevAssist: string,
  text: string,
  isResultFullText: boolean,
): string {
  if (isResultFullText) {
    return text || prevAssist;
  }
  return prevAssist + text;
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

export type MergeAssistantPartsOptions = {
  /** content_block_start(text) 后首个 delta：另起 text part，对齐 JSONL 多 block。 */
  startNewTextBlock?: boolean;
  /** content_block_start(thinking) 后首个 delta：另起 reasoning part。 */
  startNewReasoningBlock?: boolean;
};

export function mergeAssistantParts(
  existingParts: MessagePart[],
  incomingParts: MessagePart[],
  options?: MergeAssistantPartsOptions,
): MessagePart[] {
  const merged = [...existingParts];
  const incomingTextPartCount = incomingParts.filter((part) => part.type === "text").length;
  const multiTextIncomingBatch = incomingTextPartCount > 1;
  let incomingTextOrdinal = 0;
  let startNewTextBlock = options?.startNewTextBlock === true;
  let startNewReasoningBlock = options?.startNewReasoningBlock === true;

  for (const part of incomingParts) {
    if (part.type === "text") {
      incomingTextOrdinal += 1;
      // assistant 快照一次携带多个 text block（常见于 tool 后总结 + 说明点），磁盘 JSONL
      // 会保留为独立 part，渲染层 buildMergedTextGroups 以 \n\n 拼接。流式 merge 若用
      // mergeTextPartsByContainment 直接拼接，会把末段/列表压成一段（刷新后段落才清晰）。
      const lastText = merged[merged.length - 1];
      const keepSeparateTextBlock =
        startNewTextBlock
        || (multiTextIncomingBatch && incomingTextOrdinal > 1)
        || (lastText?.type === "text"
          && shouldStartNewAssistantTextPart(lastText.text, part.text));
      if (startNewTextBlock) startNewTextBlock = false;
      if (keepSeparateTextBlock) {
        merged.push(part);
      } else if (lastText?.type === "text") {
        merged[merged.length - 1] = {
          ...lastText,
          text: mergeTextPartsByContainment(lastText.text, part.text),
        };
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
    if (startNewReasoningBlock) {
      startNewReasoningBlock = false;
      merged.push(part);
    } else if (lastReason?.type === "reasoning") {
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
  return assistantTextJoinedFromParts(parts);
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
 * 范围说明：existingText 与 resultText 均以段间分隔 "\n\n" 拼接 text parts，对齐渲染与 result 整轮
 * 文本的段间分隔。多 text block（如 [intro, tool_use, 总结]）时仍可前缀对齐：delta 流过 intro + 总结
 * (部分) 时 existingText = "intro\n\n总结(部分)"，resultText = "intro\n\n总结(完整)"，超集命中 ->
 * 回收总结尾巴。仅当 result 与 delta 内容真正分歧（不连续）时才走 disjoint->[] 保守跳过。
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
  // text parts 之间用段间分隔 "\n\n" 拼接，对齐 result 整轮文本的段间分隔：流式态 text part
  // 之间隔着 tool_use/reasoning block，渲染与 result 整轮文本均以 \n\n 分段。无分隔拼接会让
  // 多 text block（intro + tool_use + 总结）前缀匹配失败走 disjoint，致总结尾巴丢失
  // （流式缺尾巴、刷新磁盘态有尾巴 -> 实时与刷新不一致）。
  const existingText = assistantTextJoinedFromParts(existingParts);
  const resultText = assistantTextJoinedFromParts(resultParts);
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
  // result 是现有超集（delta 流了前缀，result 含尾巴）：返回尾巴，由 mergeAssistantParts 追加到末尾。
  // tail 前导空白是否保留取决于它将落位的 part 类型（mergeAssistantParts 按 existingParts 末条类型判定，
  // 此处 existingParts 与之同源、result 事件前已 sync flush 待应用 delta、ref 已更新，二者末条类型一致）：
  //   - 末条是 text：tail 合并进现有 text part，前导换行是段内分隔，保留；
  //   - 末条是 tool_use/reasoning 等：tail 新增 text part，渲染 join("\n\n") 已加段间分隔，
  //     tail 前导换行多余会致「tool_use 后 \n\n + tail 前导 \n\n」双重换行，裁掉。
  if (resultText.startsWith(existingText)) {
    const tail = resultText.slice(existingText.length);
    if (!tail.trim()) return [];
    const lastExisting = existingParts[existingParts.length - 1];
    const tailText = lastExisting?.type === "text" ? tail : tail.replace(/^\s+/, "");
    return tailText ? [{ type: "text", text: tailText }] : [];
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
  return { ...message, parts: nextParts, content: assistantTextJoinedFromParts(nextParts) };
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

export function appendAssistantStreamParts(
  session: ClaudeSession,
  parts: MessagePart[],
  mergeOptions?: MergeAssistantPartsOptions,
): ClaudeSession {
  if (parts.length === 0) return session;
  const lastMsg = session.messages[session.messages.length - 1];
  let nextMessages: ClaudeSession["messages"];
  if (lastMsg?.role === "assistant") {
    const mergedParts = mergeAssistantParts(lastMsg.parts, parts, mergeOptions);
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
