import type { ClaudeMessage, ClaudeSession } from "../types";
import {
  isDisplayNoiseUserMessageText,
  userMessagePlainTextForDisplay,
} from "./claudeChatMessageDisplay";
import {
  CODE_REVIEW_PROMPT_SIGNATURE,
  CODE_REVIEW_SESSION_LABEL,
} from "./codeReviewPromptSession";
import { extractImportantUserInputForDisplay } from "./userMessageImportantInput";

function messagesHaveDisplayUser(messages: readonly ClaudeMessage[]): boolean {
  return messages.some((msg) => {
    if (msg.role !== "user") return false;
    const text = userMessagePlainTextForDisplay(msg).trim();
    return Boolean(text) && !isDisplayNoiseUserMessageText(text);
  });
}

/** 尾部截断后的助手正文常以标点/markdown 中段开头，不宜当侧栏标题。 */
function looksLikeMidTruncatedPreview(text: string): boolean {
  const trimmed = text.trimStart();
  if (!trimmed) return true;
  return /^[)\]}、，。；：,.!?\-*#|>]/.test(trimmed);
}

/** 侧栏短标题：去掉常见 markdown 标记，避免 `**系统能力**` 原样上屏。 */
function normalizeListPreviewText(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 列表标题用用户真正输入：去掉附图路径、注入块，保留发送正文。 */
function normalizeUserPreviewText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith(CODE_REVIEW_PROMPT_SIGNATURE)) return CODE_REVIEW_SESSION_LABEL;
  const display = extractImportantUserInputForDisplay(trimmed);
  const compact = display.compactText.trim();
  if (compact) return compact;
  if (display.attachmentPaths.length > 0) return "附图";
  return trimmed;
}

/** 从内存消息推导侧栏/列表短标题（优先首条可展示用户正文）。 */
export function deriveSessionListPreviewFromMessages(
  messages: readonly ClaudeMessage[],
): string {
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i]!;
    if (msg.role !== "user") continue;
    const raw = userMessagePlainTextForDisplay(msg).trim();
    if (!raw || isDisplayNoiseUserMessageText(raw)) continue;
    const text = normalizeUserPreviewText(raw);
    if (!text) continue;
    return text;
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]!;
    if (msg.role !== "assistant") continue;
    const text = normalizeListPreviewText(msg.content ?? "");
    if (!text || looksLikeMidTruncatedPreview(text)) continue;
    return text;
  }
  return "";
}

/**
 * 侧栏标题源：优先用户真正发出的正文（去掉附图路径 / 注入块）。
 * 服务端 threadName 是摘要，只在没有用户气泡时作兜底。
 */
export function resolveSessionListPreviewSource(
  session: Pick<ClaudeSession, "messages" | "diskPreview" | "threadName">,
): string {
  const hasUser = messagesHaveDisplayUser(session.messages);
  if (hasUser) {
    const derived = deriveSessionListPreviewFromMessages(session.messages);
    if (derived) return derived;
  }
  const diskPreview = session.diskPreview?.trim() ?? "";
  if (diskPreview) {
    return normalizeUserPreviewText(diskPreview) || diskPreview;
  }
  const threadName = session.threadName?.trim() ?? "";
  if (threadName) return threadName;
  return deriveSessionListPreviewFromMessages(session.messages);
}

/** 丢弃/截断 messages 前：若尚无 diskPreview，用当前消息锁住列表标题。 */
export function retainSessionListPreviewOnMessageDrop(
  session: Pick<ClaudeSession, "messages" | "diskPreview" | "diskTranscriptPartial">,
): string | undefined {
  const existing = session.diskPreview?.trim();
  if (existing) return session.diskPreview;
  // 当前 messages 已是尾部窗口时首条消息不是会话开头，不能拿来当标题。
  if (session.diskTranscriptPartial) return session.diskPreview;
  const derived = deriveSessionListPreviewFromMessages(session.messages);
  return derived || session.diskPreview;
}
