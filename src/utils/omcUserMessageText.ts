import type { ClaudeMessage, ClaudeSession } from "../types";
import { isToolOnlyUserMessage } from "./claudeChatMessageDisplay";

/** 单条用户消息的完整可读正文（含 `parts` 内 text，与主栏逻辑一致） */
export function userMessagePlainText(msg: ClaudeMessage): string {
  if (msg.role !== "user") return "";
  // 纯 tool_use parts 的 user 消息（orphan tool_result / 折叠失败场景）不应被视作
  // OMC 派发 payload——它们的 stdout / error 文本不应触发「发现派发正文」等下游逻辑。
  if (isToolOnlyUserMessage(msg)) return "";
  const fromParts =
    msg.parts
      ?.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n\n") ?? "";
  const trimmed = fromParts.trim();
  if (trimmed) return trimmed;
  return msg.content.trim();
}

/** 从用户下发正文中解析任务 ID（`buildTaskExecutionPrompt` 的「任务ID：」或旧版 `taskId:` 行）。 */
export function parseOmcDispatchTaskIdFromUserText(text: string): string {
  const zh = text.match(/任务ID[：:]\s*(\S+)/);
  if (zh?.[1]?.trim()) return zh[1].trim();
  const legacy = text.match(/taskId:\s*([^\n]+)/i);
  return legacy?.[1]?.trim() ?? "unknown-task";
}

const OMC_SLASH_DISPATCH = /^(\/(?:autopilot|ultraqa|verify|team))\b/i;

/** 从正文取 OMC 斜杠指令（兼容旧版 `OMC command:` 行）。 */
export function parseOmcSlashCommandFromUserText(text: string): string | null {
  const legacy = text.match(/OMC command:\s*(\/\S+)/i);
  if (legacy?.[1]?.trim()) return legacy[1].trim();
  const m = text.trim().match(OMC_SLASH_DISPATCH);
  return m?.[1] ?? null;
}

/** 是否为 OMC 派发用户消息（旧版 `OMC command:` 或单行 `/autopilot …`）。 */
export function messageTextLooksLikeOmcDispatch(text: string): boolean {
  if (text.includes("OMC command:")) return true;
  return OMC_SLASH_DISPATCH.test(text.trim());
}

/**
 * 从会话末尾向前的每条用户消息正文（仅非空）。
 * OMC 批量/worker 的派发正文常在 parts 中，不能只看 `content`。
 */
export function listUserPlainTextsLatestFirst(session: ClaudeSession): Array<{ text: string; timestamp: number }> {
  const out: Array<{ text: string; timestamp: number }> = [];
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const msg = session.messages[i];
    if (msg.role !== "user") continue;
    const text = userMessagePlainText(msg);
    if (text) out.push({ text, timestamp: msg.timestamp });
  }
  return out;
}

/** 自末尾向前首个含 OMC 派发行（避免为每条会话构建完整用户文本列表）。 */
export function findLatestUserOmcDispatchPayload(session: ClaudeSession): { text: string; timestamp: number } | null {
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const msg = session.messages[i];
    if (msg.role !== "user") continue;
    const text = userMessagePlainText(msg);
    if (!messageTextLooksLikeOmcDispatch(text)) continue;
    return { text, timestamp: msg.timestamp };
  }
  return null;
}

export function sessionHasOmcDispatchInAnyUserMessage(session: ClaudeSession): boolean {
  return findLatestUserOmcDispatchPayload(session) !== null;
}
