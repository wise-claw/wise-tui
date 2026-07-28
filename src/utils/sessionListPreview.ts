import type { ClaudeMessage, ClaudeSession } from "../types";
import {
  isDisplayNoiseUserMessageText,
  userMessagePlainTextForDisplay,
} from "./claudeChatMessageDisplay";

/** 从内存消息推导侧栏/列表短标题（优先首条可展示用户正文）。 */
export function deriveSessionListPreviewFromMessages(
  messages: readonly ClaudeMessage[],
): string {
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i]!;
    if (msg.role !== "user") continue;
    const text = userMessagePlainTextForDisplay(msg).trim();
    if (!text || isDisplayNoiseUserMessageText(text)) continue;
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
  return (
    deriveSessionListPreviewFromMessages(session.messages) ||
    session.diskPreview?.trim() ||
    ""
  );
}

/** 丢弃/截断 messages 前：若尚无 diskPreview，用当前消息锁住列表标题。 */
export function retainSessionListPreviewOnMessageDrop(
  session: Pick<ClaudeSession, "messages" | "diskPreview">,
): string | undefined {
  const existing = session.diskPreview?.trim();
  if (existing) return session.diskPreview;
  const derived = deriveSessionListPreviewFromMessages(session.messages);
  return derived || session.diskPreview;
}
