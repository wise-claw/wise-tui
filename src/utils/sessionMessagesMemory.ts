import {
  IN_MEMORY_GLOBAL_MESSAGES_BUDGET,
  IN_MEMORY_MESSAGE_PART_TEXT_MAX,
  IN_MEMORY_SESSION_MESSAGES_MAX,
} from "../constants/claudeMessageListWindow";
import type { ClaudeMessage, ClaudeSession, MessagePart } from "../types";
import { parseClaudeSessionJsonlLines } from "./claudeSessionJsonl";

export function capSessionMessagesForMemory(
  messages: ClaudeMessage[],
  max: number = IN_MEMORY_SESSION_MESSAGES_MAX,
): ClaudeMessage[] {
  if (messages.length <= max) return messages;
  return messages.slice(-max);
}

function capPartText(text: string, max: number = IN_MEMORY_MESSAGE_PART_TEXT_MAX): string {
  if (text.length <= max) return text;
  return text.slice(-max);
}

/** 截断单条消息内过大的 text / reasoning / tool 输出，避免少数巨型 part 占满堆。 */
export function trimMessagePartsForMemory(
  messages: ClaudeMessage[],
  partTextMax: number = IN_MEMORY_MESSAGE_PART_TEXT_MAX,
): ClaudeMessage[] {
  let changed = false;
  const next = messages.map((message) => {
    if (!message.parts?.length) return message;
    let partsChanged = false;
    const parts = message.parts.map((part) => {
      if (part.type === "text" || part.type === "reasoning") {
        if (part.text.length <= partTextMax) return part;
        partsChanged = true;
        return { ...part, text: capPartText(part.text, partTextMax) };
      }
      if (part.type === "tool_use") {
        let nextPart: MessagePart = part;
        if (typeof part.output === "string" && part.output.length > partTextMax) {
          partsChanged = true;
          nextPart = { ...nextPart, output: capPartText(part.output, partTextMax) };
        }
        if (typeof part.error === "string" && part.error.length > partTextMax) {
          partsChanged = true;
          nextPart = {
            ...(nextPart as Extract<MessagePart, { type: "tool_use" }>),
            error: capPartText(part.error, partTextMax),
          };
        }
        return nextPart;
      }
      return part;
    });
    if (!partsChanged) return message;
    changed = true;
    const content =
      message.role === "assistant"
        ? parts
            .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
            .map((p) => p.text)
            .join("")
        : message.content;
    return { ...message, parts, content };
  });
  return changed ? next : messages;
}

interface SessionMemoryCapCacheEntry {
  max: number;
  result: ClaudeSession;
}

// 流式期间 applySessionsMemoryCap 每帧对每个 session 调用 applySessionMemoryCap，
// 但绝大多数 session 的 messages 引用未变（通常只有活动标签在流式追加）。
// 用 WeakMap 记住「同一 session 对象 + 同一 max 上次的处理结果」：session 对象引用不变 ⇒
// 其 messages / transcriptMemoryUnlimited / diskTranscriptPartial 均不变 ⇒ 结果确定可复用，
// 从而跳过 O(总 parts) 的 trimMessagePartsForMemory 遍历。session 被丢弃时缓存条目自动 GC，
// 不会泄漏。messages 引用变化时调用方必定产生新的 session 对象 ⇒ 缓存未命中 ⇒ 重新计算，
// 裁剪时机不遗漏。
const sessionMemoryCapCache = new WeakMap<ClaudeSession, SessionMemoryCapCacheEntry>();

function computeSessionMemoryCap(
  session: ClaudeSession,
  max: number = IN_MEMORY_SESSION_MESSAGES_MAX,
): ClaudeSession {
  if (session.transcriptMemoryUnlimited) {
    const trimmed = trimMessagePartsForMemory(session.messages);
    if (trimmed === session.messages) return session;
    return { ...session, messages: trimmed };
  }
  let messages = session.messages;
  let partial = session.diskTranscriptPartial ?? false;
  if (messages.length > max) {
    messages = capSessionMessagesForMemory(messages, max);
    partial = true;
  }
  const trimmed = trimMessagePartsForMemory(messages);
  if (trimmed === session.messages && messages === session.messages && !partial) return session;
  if (trimmed === session.messages && messages === session.messages) {
    return partial === session.diskTranscriptPartial ? session : { ...session, diskTranscriptPartial: partial };
  }
  return {
    ...session,
    messages: trimmed,
    diskTranscriptPartial: partial || trimmed.length < session.messages.length,
  };
}

export function applySessionMemoryCap(
  session: ClaudeSession,
  max: number = IN_MEMORY_SESSION_MESSAGES_MAX,
): ClaudeSession {
  // 同一 session 对象 + 同一 max 的处理结果是确定性的：对象引用不变即所有输入字段不变，
  // 直接复用上次结果，跳过逐 part 遍历。这是多屏流式变慢的核心根因修复点。
  const cached = sessionMemoryCapCache.get(session);
  if (cached !== undefined && cached.max === max) {
    return cached.result;
  }
  const result = computeSessionMemoryCap(session, max);
  sessionMemoryCapCache.set(session, { max, result });
  return result;
}

export interface SessionsMemoryCapOptions {
  /** 活动/多屏伴生/运行中标签：全局预算紧张时仍尽量保留正文 */
  keepSessionIds?: ReadonlySet<string>;
  globalMessagesBudget?: number;
  perSessionMax?: number;
}

function enforceGlobalMessagesBudget(
  sessions: ClaudeSession[],
  keepSessionIds: ReadonlySet<string>,
  budget: number,
): { sessions: ClaudeSession[]; changed: boolean } {
  // 仅在 keepSessionIds 非空时由 applySessionsMemoryCap 调用；reduce 只对 session 数求和（O(n)，n=标签数），
  // 成本远低于逐 part 的 trimMessagePartsForMemory（已由 applySessionMemoryCap 的 WeakMap 缓存跳过）。
  // 故这里维持原样，不做增量维护，避免引入跨帧 total 状态与裁剪时序风险。
  let total = sessions.reduce((sum, session) => sum + session.messages.length, 0);
  if (total <= budget) {
    return { sessions, changed: false };
  }

  const candidates = sessions
    .filter(
      (session) =>
        session.messages.length > 0 &&
        !session.transcriptMemoryUnlimited &&
        !keepSessionIds.has(session.id) &&
        session.status !== "running" &&
        session.status !== "connecting",
    )
    .sort((a, b) => b.messages.length - a.messages.length);

  if (candidates.length === 0) {
    return { sessions, changed: false };
  }

  const dropIds = new Set<string>();
  for (const session of candidates) {
    if (total <= budget) break;
    dropIds.add(session.id);
    total -= session.messages.length;
  }
  if (dropIds.size === 0) {
    return { sessions, changed: false };
  }

  return {
    sessions: sessions.map((session) =>
      dropIds.has(session.id)
        ? {
            ...session,
            messages: [],
            diskTranscriptPartial:
              Boolean(session.claudeSessionId?.trim()) ||
              Boolean(session.diskTranscriptPartial),
          }
        : session,
    ),
    changed: true,
  };
}

export function applySessionsMemoryCap(
  sessions: readonly ClaudeSession[],
  options?: SessionsMemoryCapOptions,
): ClaudeSession[] {
  const perSessionMax = options?.perSessionMax ?? IN_MEMORY_SESSION_MESSAGES_MAX;
  const budget = options?.globalMessagesBudget ?? IN_MEMORY_GLOBAL_MESSAGES_BUDGET;

  let changed = false;
  let next = sessions.map((session) => {
    const capped = applySessionMemoryCap(session, perSessionMax);
    if (capped !== session) changed = true;
    return capped;
  });

  if (options?.keepSessionIds && options.keepSessionIds.size > 0) {
    const enforced = enforceGlobalMessagesBudget(next, options.keepSessionIds, budget);
    if (enforced.changed) {
      changed = true;
      next = enforced.sessions;
    }
  }

  return changed ? next : (sessions as ClaudeSession[]);
}

/** 将 jsonl 行解析为 UI 消息，并按内存上限截断；调用方传入 tail 请求行数用于判断是否 partial。 */
export function sessionMessagesFromJsonlLines(
  lines: readonly string[],
  options: {
    tailRequestLines: number;
    memoryMax?: number;
    /** 全量 jsonl（非尾部窗口）时不因行数饱和标记 partial */
    fullTranscript?: boolean;
    /** 历史恢复：保留解析出的全部消息条数，不受 64 条 cap */
    unlimitedMessageCount?: boolean;
  },
): { messages: ClaudeMessage[]; diskTranscriptPartial: boolean } {
  const parsed = parseClaudeSessionJsonlLines(lines as string[]);
  const unlimited = options.unlimitedMessageCount === true;
  const messages = unlimited
    ? trimMessagePartsForMemory(parsed)
    : trimMessagePartsForMemory(
        capSessionMessagesForMemory(parsed, options.memoryMax ?? IN_MEMORY_SESSION_MESSAGES_MAX),
      );
  const tailSaturated =
    !options.fullTranscript && lines.length >= options.tailRequestLines;
  const memoryTruncated = !unlimited && parsed.length > messages.length;
  return {
    messages,
    diskTranscriptPartial: tailSaturated || memoryTruncated,
  };
}
