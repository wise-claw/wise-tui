import type { ClaudeMessage, ClaudeSession, MessagePart } from "../types";

type ToolUsePart = Extract<MessagePart, { type: "tool_use" }>;

/** 单轮助手消息中 text+reasoning 合计上限，避免流式拼接撑爆主线程内存 */
export const MAX_ASSISTANT_TEXT_REASONING_CHARS = 600_000;

/** 单条 tool_use 的 output 字符串上限（error 同理），避免巨型工具回包常驻内存 */
const MAX_TOOL_PART_OUTPUT_CHARS = 400_000;

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

export function mergeAssistantParts(existingParts: MessagePart[], incomingParts: MessagePart[]): MessagePart[] {
  const merged = [...existingParts];
  for (const part of incomingParts) {
    if (part.type === "text") {
      const lastText = merged[merged.length - 1];
      if (lastText?.type === "text") {
        merged[merged.length - 1] = { ...lastText, text: lastText.text + part.text };
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
      merged[merged.length - 1] = { ...lastReason, text: lastReason.text + part.text };
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

export function appendAssistantStreamParts(session: ClaudeSession, parts: MessagePart[]): ClaudeSession {
  if (parts.length === 0) return session;
  const lastMsg = session.messages[session.messages.length - 1];
  if (lastMsg?.role === "assistant") {
    const mergedParts = mergeAssistantParts(lastMsg.parts, parts);
    const merged: ClaudeMessage = {
      ...lastMsg,
      parts: mergedParts,
      content: textContentFromParts(mergedParts),
    };
    const capped = enforceAssistantMessageMemoryLimits(merged);
    return {
      ...session,
      messages: [...session.messages.slice(0, -1), capped],
    };
  }
  const built = buildAssistantMessage(parts);
  const cappedNew = enforceAssistantMessageMemoryLimits(built);
  return {
    ...session,
    messages: [...session.messages, cappedNew],
  };
}
