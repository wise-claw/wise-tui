import type { ClaudeMessage, ClaudeSession } from "../types";
import { assistantMessageVisiblePlainText } from "./claudeSessionState";
import {
  hasRenderableChatMessageBody,
  isSystemMessageDisplayNoiseText,
  isToolOnlyUserMessage,
  parseDispatchRecord,
  systemMessagePlainText,
  userMessagePlainTextForDisplay,
} from "../utils/claudeChatMessageDisplay";

export const MAIN_SESSION_CONTEXT_MARKER = "【主会话上下文】";

/** 终端 worker 注入主会话 transcript 时的字符上限（CLI `-p` 与 UI 种子共用）。 */
export const TERMINAL_MAIN_SESSION_CONTEXT_MAX_CHARS = 16_000;

export function isMainSessionContextSeedMessage(message: ClaudeMessage): boolean {
  if (message.role !== "system") return false;
  return systemMessagePlainText(message).trim().startsWith(MAIN_SESSION_CONTEXT_MARKER);
}

function isTerminalDispatchSystemMessage(message: ClaudeMessage): boolean {
  if (message.role !== "system") return false;
  const text = systemMessagePlainText(message).trim();
  if (!text) return true;
  if (parseDispatchRecord(text)) return true;
  if (isMainSessionContextSeedMessage(message)) return true;
  return isSystemMessageDisplayNoiseText(text);
}

/** 从主会话挑选可镜像到终端 worker 的用户/助手消息。 */
export function selectMessagesForTerminalContext(
  messages: readonly ClaudeMessage[],
): ClaudeMessage[] {
  const out: ClaudeMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      if (isTerminalDispatchSystemMessage(message)) continue;
    }
    if (message.role === "user" && isToolOnlyUserMessage(message)) continue;
    if (!hasRenderableChatMessageBody(message)) continue;
    if (message.role !== "user" && message.role !== "assistant") continue;
    out.push(message);
  }
  return out;
}

function trimMessagesToCharBudget(messages: readonly ClaudeMessage[], maxChars: number): ClaudeMessage[] {
  if (messages.length === 0 || maxChars <= 0) return [];
  const kept: ClaudeMessage[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    const text =
      message.role === "user"
        ? userMessagePlainTextForDisplay(message)
        : assistantMessageVisiblePlainText(message);
    const len = text.trim().length;
    if (len === 0) continue;
    if (total + len > maxChars && kept.length > 0) break;
    kept.unshift(message);
    total += len;
  }
  return kept;
}

function cloneContextMessage(message: ClaudeMessage, timestamp: number): ClaudeMessage {
  return {
    ...message,
    timestamp,
    parts: message.parts?.map((part) => ({ ...part })),
  };
}

export function formatMainSessionContextForCli(
  messages: readonly ClaudeMessage[],
  maxChars: number = TERMINAL_MAIN_SESSION_CONTEXT_MAX_CHARS,
): string | null {
  const selected = trimMessagesToCharBudget(selectMessagesForTerminalContext(messages), maxChars);
  if (selected.length === 0) return null;
  const lines: string[] = ["以下是派发前主会话中的对话记录，供你理解上下文并执行当前任务：", ""];
  for (const message of selected) {
    if (message.role === "user") {
      const text = userMessagePlainTextForDisplay(message).trim();
      if (text) lines.push(`用户：${text}`, "");
    } else if (message.role === "assistant") {
      const text = assistantMessageVisiblePlainText(message).trim();
      if (text) lines.push(`助手：${text}`, "");
    }
  }
  const body = lines.join("\n").trim();
  if (!body) return null;
  if (body.length <= maxChars) return body;
  return `${body.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function buildMainSessionContextSeedMessages(
  messages: readonly ClaudeMessage[],
  maxChars: number = TERMINAL_MAIN_SESSION_CONTEXT_MAX_CHARS,
): ClaudeMessage[] {
  const selected = trimMessagesToCharBudget(selectMessagesForTerminalContext(messages), maxChars);
  if (selected.length === 0) return [];
  const baseTs = Date.now();
  return [
    {
      id: baseTs,
      role: "system",
      content: `${MAIN_SESSION_CONTEXT_MARKER}以下为派发前主会话中的对话：`,
      timestamp: baseTs,
      parts: [
        {
          type: "text",
          text: `${MAIN_SESSION_CONTEXT_MARKER}以下为派发前主会话中的对话：`,
        },
      ],
    },
    ...selected.map((message, index) => cloneContextMessage(message, baseTs + index + 1)),
  ];
}

export function buildTerminalDispatchWithMainContext(
  _mainSession: ClaudeSession,
  outboundPrompt: string,
): {
  outboundPrompt: string;
  contextSeedMessages: ClaudeMessage[];
} {
  return { outboundPrompt: outboundPrompt.trim(), contextSeedMessages: [] };
}
