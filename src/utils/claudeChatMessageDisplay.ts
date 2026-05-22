import type { ClaudeMessage, MessagePart } from "../types";

export function isToolOnlyUserMessage(msg: ClaudeMessage): boolean {
  const parts = msg.parts;
  return msg.role === "user" && Array.isArray(parts) && parts.length > 0 && parts.every((p) => p.type === "tool_use");
}

/** 会话列表中首条「可展示的用户消息」（非纯 tool_use）下标；无则 -1。 */
export function indexOfFirstRenderableUserMessage(messages: readonly ClaudeMessage[]): number {
  return messages.findIndex((m) => m.role === "user" && !isToolOnlyUserMessage(m));
}

/** 会话列表中最后一条「可展示的用户消息」（非纯 tool_use）下标；无则 -1。 */
export function indexOfLastRenderableUserMessage(messages: readonly ClaudeMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    if (m.role === "user" && !isToolOnlyUserMessage(m)) {
      return i;
    }
  }
  return -1;
}

/** Claude 助手流中的无展示价值占位句（仍可能出现在 parts 里）。 */
const ASSISTANT_DISPLAY_NOISE_TEXT = new Set(["no response requested.", "no response requested"]);

/** 会话 UI 中应跳过的系统占位/噪声文案（含历史已写入的消息）。 */
const SYSTEM_MESSAGE_DISPLAY_NOISE = [/^Claude 系统错误:\s*unknown\s*$/i];

export function isSystemMessageDisplayNoiseText(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return true;
  return SYSTEM_MESSAGE_DISPLAY_NOISE.some((pattern) => pattern.test(normalized));
}

export function isAssistantDisplayNoiseText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized.length > 0 && ASSISTANT_DISPLAY_NOISE_TEXT.has(normalized);
}

/** 单条 part 是否在消息列表中有展示价值（空白/占位句不计）。 */
export function isRenderableMessagePart(part: MessagePart): boolean {
  switch (part.type) {
    case "text": {
      const trimmed = part.text.trim();
      return trimmed.length > 0 && !isAssistantDisplayNoiseText(part.text);
    }
    case "reasoning":
      return part.text.trim().length > 0;
    case "tool_use":
      return true;
    default:
      return false;
  }
}

/** 消息行是否应在主会话列表中渲染（无正文则整行跳过）。 */
export function hasRenderableChatMessageBody(msg: ClaudeMessage): boolean {
  if (msg.role === "system") {
    const text = systemMessagePlainText(msg).trim();
    return text.length > 0 && !isSystemMessageDisplayNoiseText(text);
  }
  const parts = msg.parts;
  if (Array.isArray(parts) && parts.length > 0) {
    return parts.some(isRenderableMessagePart);
  }
  const content = (msg.content ?? "").trim();
  if (!content) return false;
  if (msg.role === "assistant" && isAssistantDisplayNoiseText(content)) return false;
  return true;
}

/** 列表中当前条之前最近一条「可渲染」消息下标；无则 -1。 */
export function indexOfPreviousRenderableMessage(
  messages: readonly ClaudeMessage[],
  fromIndex: number,
): number {
  for (let i = fromIndex - 1; i >= 0; i -= 1) {
    if (hasRenderableChatMessageBody(messages[i]!)) return i;
  }
  return -1;
}

/** 用户气泡的纯文本（用于 sticky 摘要等）。 */

export function userMessagePlainTextForDisplay(msg: ClaudeMessage): string {
  const fromParts = msg.parts
    ?.filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n\n");
  if (fromParts?.trim()) return fromParts;
  return (msg.content ?? "").trim();
}

/** 用于判断连续消息是否可合并为同一块；工具调用与 Claude 同组 */
export function getMessageSenderGroupKey(msg: ClaudeMessage): string {
  if (msg.role === "system") return "system";
  if (msg.role === "assistant") return "assistant";
  if (msg.role === "user") {
    if (isToolOnlyUserMessage(msg)) return "assistant";
    return "user:normal";
  }
  return msg.role;
}

export function systemMessagePlainText(msg: ClaudeMessage): string {
  const fromParts = msg.parts
    ?.filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n\n");
  if (fromParts?.trim()) return fromParts;
  return msg.content;
}

export interface DispatchRecordMeta {
  dispatchType?: string;
  targetName?: string;
  targetSessionId?: string;
  taskId?: string;
  dispatchTime?: string;
}

export function parseDispatchRecord(text: string): DispatchRecordMeta | null {
  const lines = text.split("\n").map((line) => line.trim());
  if (lines[0] !== "任务分发记录") return null;
  const meta: DispatchRecordMeta = {};
  for (const line of lines.slice(1)) {
    if (!line.startsWith("- ")) continue;
    const payload = line.slice(2);
    const idx = payload.indexOf("：");
    if (idx < 0) continue;
    const key = payload.slice(0, idx).trim();
    const value = payload.slice(idx + 1).trim();
    if (!value) continue;
    if (key === "类型") meta.dispatchType = value;
    if (key === "目标") meta.targetName = value;
    if (key === "分发会话") meta.targetSessionId = value;
    if (key === "任务ID") meta.taskId = value;
    if (key === "时间") meta.dispatchTime = value;
  }
  return meta;
}
