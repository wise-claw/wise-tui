import type { ClaudeMessage, ClaudeSession } from "../types";
import {
  isDisplayNoiseUserMessageText,
  userMessagePlainTextForDisplay,
} from "./claudeChatMessageDisplay";
import {
  CODE_REVIEW_PROMPT_SIGNATURE,
  CODE_REVIEW_SESSION_LABEL,
} from "./codeReviewPromptSession";

/** 从内存消息推导侧栏/列表短标题（优先首条可展示用户正文）。 */
export function deriveSessionListPreviewFromMessages(
  messages: readonly ClaudeMessage[],
): string {
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i]!;
    if (msg.role !== "user") continue;
    const text = userMessagePlainTextForDisplay(msg).trim();
    if (!text || isDisplayNoiseUserMessageText(text)) continue;
    if (text.startsWith(CODE_REVIEW_PROMPT_SIGNATURE)) return CODE_REVIEW_SESSION_LABEL;
    return text;
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]!;
    if (msg.role !== "assistant") continue;
    const text = (msg.content ?? "").trim();
    if (text) return text;
  }
  return "";
}

/**
 * 侧栏标题源：内存消息 → diskPreview。
 * 调用方再做截断 / 「新会话」回落。
 */
export function resolveSessionListPreviewSource(
  session: Pick<ClaudeSession, "messages" | "diskPreview">,
): string {
  const derived = deriveSessionListPreviewFromMessages(session.messages);
  if (derived) return derived;
  const diskPreview = session.diskPreview?.trim() ?? "";
  // 消息被淘汰后只剩 diskPreview，仍需避免 harness prompt 上屏。
  if (diskPreview.startsWith(CODE_REVIEW_PROMPT_SIGNATURE)) return CODE_REVIEW_SESSION_LABEL;
  return diskPreview;
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
