import type { ClaudeMessage, ClaudeSession, MessagePart, ToolUsePart } from "../types";
import {
  isClaudeHarnessInjectedStreamText,
  stripClaudeHarnessInjectedStreamText,
} from "../services/claudeStreamParser";
import { buildComposerInsertFromPlainText } from "../services/claudeComposerPrompt";

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
const SYSTEM_MESSAGE_DISPLAY_NOISE = [
  /^Claude 系统错误:\s*unknown\s*$/i,
  /^Claude Hook 启动中/,
];

export function isSystemMessageDisplayNoiseText(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return true;
  return SYSTEM_MESSAGE_DISPLAY_NOISE.some((pattern) => pattern.test(normalized));
}

export function isAssistantDisplayNoiseText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized.length > 0 && ASSISTANT_DISPLAY_NOISE_TEXT.has(normalized);
}

/** 去掉空白与零宽字符后是否仍无可见正文。 */
export function isBlankDisplayText(text: string): boolean {
  return text.replace(/[\s\u00a0\u200b\u200c\u200d\ufeff]/g, "").length === 0;
}

function toolUsePartHasVisiblePayload(part: ToolUsePart): boolean {
  if (part.output?.trim() || part.error?.trim()) return true;
  if (part.name.trim()) return true;
  const input = part.input;
  if (!input || typeof input !== "object") return false;
  for (const value of Object.values(input as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) return true;
    if (Array.isArray(value) && value.some((item) => typeof item === "string" && item.trim())) {
      return true;
    }
  }
  return false;
}

/** 单条 part 是否在消息列表中有展示价值（空白/占位句不计）。 */
export function isRenderableMessagePart(part: MessagePart): boolean {
  switch (part.type) {
    case "text": {
      if (isBlankDisplayText(part.text)) return false;
      if (isAssistantDisplayNoiseText(part.text)) return false;
      const stripped = stripClaudeHarnessInjectedStreamText(part.text);
      if (!stripped || isClaudeHarnessInjectedStreamText(stripped)) return false;
      return true;
    }
    case "reasoning":
      return !isBlankDisplayText(part.text);
    case "tool_use":
      return toolUsePartHasVisiblePayload(part);
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
  const content = msg.content ?? "";
  if (isBlankDisplayText(content)) return false;
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
  /** 执行环境派发：Claude Code / Codex CLI 等（与 `目标` 同源，兼容仅写 `引擎` 的历史记录） */
  engineName?: string;
  targetSessionId?: string;
  /** 执行环境派发批次 id（`exec-env-batch:…`） */
  dispatchBatchId?: string;
  taskId?: string;
  dispatchTime?: string;
  /** 终端派发时写入的可执行正文摘要 */
  dispatchContent?: string;
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
    if (key === "引擎") meta.engineName = value;
    if (key === "分发会话") meta.targetSessionId = value;
    if (key === "批次") meta.dispatchBatchId = value;
    if (key === "任务ID") meta.taskId = value;
    if (key === "时间") meta.dispatchTime = value;
    if (key === "正文") meta.dispatchContent = value;
  }
  return meta;
}

export function parseDispatchRecordDisplayTimeMs(time: string | undefined): number | null {
  const trimmed = time?.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (match) {
    const [, y, mo, d, h, mi, s] = match;
    return new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s),
    ).getTime();
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

const DISPATCH_CONTENT_PLACEHOLDER = "（无正文）";

function normalizedDispatchContentForSentence(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed === DISPATCH_CONTENT_PLACEHOLDER) return undefined;
  return trimmed;
}

/** 从终端 worker 会话首条可展示用户消息回填派发正文（兼容无「正文」字段的历史记录）。 */
export function resolveDispatchContentFromWorkerSession(
  sessions: readonly ClaudeSession[],
  workerSessionId: string,
): string | undefined {
  const key = workerSessionId.trim();
  if (!key) return undefined;
  const worker = sessions.find((item) => item.id === key || item.claudeSessionId === key);
  if (!worker) return undefined;
  const idx = indexOfFirstRenderableUserMessage(worker.messages);
  if (idx < 0) return undefined;
  const text = userMessagePlainTextForDisplay(worker.messages[idx]!);
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed || undefined;
}

export function enrichDispatchRecordMeta(
  meta: DispatchRecordMeta,
  sessions?: readonly ClaudeSession[],
): DispatchRecordMeta {
  if (normalizedDispatchContentForSentence(meta.dispatchContent)) return meta;
  const workerId = meta.targetSessionId?.trim();
  if (!workerId || !sessions?.length) return meta;
  const fromWorker = resolveDispatchContentFromWorkerSession(sessions, workerId);
  if (!fromWorker) return meta;
  return { ...meta, dispatchContent: fromWorker };
}

function resolveDispatchRecordDisplayTarget(meta: DispatchRecordMeta): string {
  const explicit = meta.targetName?.trim() || meta.engineName?.trim();
  if (explicit) return explicit;
  if (meta.dispatchType?.trim() === "执行环境") return "执行环境";
  return "未知目标";
}

/** 主会话系统气泡：任务分发记录展示句（保存时间在运行面板展示，气泡不含时间）。 */
export function formatDispatchRecordSentence(meta: DispatchRecordMeta): string {
  const target = resolveDispatchRecordDisplayTarget(meta);
  const content = normalizedDispatchContentForSentence(meta.dispatchContent);
  if (content) {
    return `${target} 执行 ${content}。`;
  }
  if (meta.dispatchType === "团队流程") {
    return `${target} 发起了团队流程任务。`;
  }
  return `${target} 执行了任务。`;
}

function messagePartPlainTextForCopy(part: MessagePart): string {
  switch (part.type) {
    case "text": {
      const text = part.text.trim();
      return text && !isAssistantDisplayNoiseText(part.text) ? text : "";
    }
    case "reasoning": {
      const text = part.text.trim();
      return text ? `[思考过程]\n${text}` : "";
    }
    case "tool_use": {
      const label = part.name.trim() || "工具";
      const body = part.output?.trim() || part.error?.trim() || "";
      return body ? `[${label}]\n${body}` : `[${label}]`;
    }
    default:
      return "";
  }
}

/** 单条会话消息可复制纯文本（不含 Markdown 渲染差异）。 */
export function chatMessagePlainTextForCopy(msg: ClaudeMessage): string {
  const parts = msg.parts;
  if (Array.isArray(parts) && parts.length > 0) {
    const segments = parts
      .filter(isRenderableMessagePart)
      .map(messagePartPlainTextForCopy)
      .filter(Boolean);
    const joined = segments.join("\n\n").trim();
    if (joined) return joined;
  }
  const content = (msg.content ?? "").trim();
  if (msg.role === "assistant" && isAssistantDisplayNoiseText(content)) return "";
  return content;
}

/** 系统消息复制/填入：派发记录取可执行正文，其余取原始系统文本。 */
function resolveSystemSessionActionText(
  msg: ClaudeMessage,
  sessions?: readonly ClaudeSession[],
): string {
  const raw = systemMessagePlainText(msg).trim();
  const dispatch = parseDispatchRecord(raw);
  if (dispatch) {
    const enriched = enrichDispatchRecordMeta(dispatch, sessions);
    return normalizedDispatchContentForSentence(enriched.dispatchContent) ?? "";
  }
  return raw;
}

/** 列表复制按钮使用的最终文本（终端/团队派发记录与填入输入框一致，取可执行正文）。 */
export function resolveChatMessageCopyText(
  msg: ClaudeMessage,
  sessions?: readonly ClaudeSession[],
): string {
  if (msg.role === "system") {
    return resolveSystemSessionActionText(msg, sessions);
  }
  return chatMessagePlainTextForCopy(msg);
}

/** 填入会话输入框的正文：用户消息取原文；系统派发记录同 {@link resolveChatMessageCopyText}。 */
export function resolveChatMessageComposerInsertText(
  msg: ClaudeMessage,
  sessions?: readonly ClaudeSession[],
): string {
  const payload = resolveChatMessageComposerInsertPayload(msg, sessions);
  return payload?.composerMain ?? "";
}

export interface ChatMessageComposerInsertPayload {
  /** 会话气泡/历史列表中的完整纯文本（含 `附图：@` 行，供复制等沿用） */
  fullText: string;
  /** 填入 Semi 编辑器的正文（有附图时已去掉尾缀） */
  composerMain: string;
  attachmentPaths: string[];
}

/** 消息行「填入输入框」：正文 + 从 `附图：@` 解析的落盘路径。 */
export function resolveChatMessageComposerInsertPayload(
  msg: ClaudeMessage,
  sessions?: readonly ClaudeSession[],
): ChatMessageComposerInsertPayload | null {
  let fullText = "";
  if (msg.role === "user") {
    if (isToolOnlyUserMessage(msg)) return null;
    fullText = userMessagePlainTextForDisplay(msg);
  } else if (msg.role === "system") {
    fullText = resolveSystemSessionActionText(msg, sessions);
  } else {
    return null;
  }
  const trimmed = fullText.trim();
  if (!trimmed) return null;
  const { composerMain, attachmentPaths } = buildComposerInsertFromPlainText(trimmed);
  if (!composerMain.trim() && attachmentPaths.length === 0) return null;
  return { fullText: trimmed, composerMain, attachmentPaths };
}
