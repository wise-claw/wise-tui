import type { ClaudeMessage, ClaudeSession } from "../types";
import { isToolOnlyUserMessage } from "../utils/claudeChatMessageDisplay";

/** 单条助手气泡：取 `parts` 中**最后一条** `type === "text"` 的可见内容；若无则退回 `content`。 */
export function assistantMessageVisiblePlainText(msg: ClaudeMessage): string {
  if (msg.role !== "assistant") {
    return "";
  }
  const parts = msg.parts ?? [];
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const p = parts[i];
    if (p?.type === "text" && typeof p.text === "string") {
      const t = p.text.trim();
      if (t.length > 0) {
        return t;
      }
    }
  }
  return msg.content.trim();
}

/** 会话中最近一条助手可见文本（与 App 侧验收解析同源，供完成回调兜底）。 */
export function extractLatestAssistantPlainText(session: ClaudeSession | undefined): string {
  if (!session) {
    return "";
  }
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const msg = session.messages[i];
    if (msg.role !== "assistant") {
      continue;
    }
    const one = assistantMessageVisiblePlainText(msg);
    if (one) {
      return one;
    }
  }
  return "";
}

/**
 * 最近一条助手消息里，**最后一个 tool_use 之后**的可见 `text` 段落（多段以双换行拼接）。
 * 可用于只关心「工具执行之后」结论文本的场景（与 Claude Code 侧栏「最终结论文本」对齐）。
 * 若本条无 `tool_use`，返回本条合并可见正文；若**有 tool 但其后无 text**，返回空串（由钉钉解析层对整条正文做尾部摘要，避免把工具前的长分析发满钉钉）。
 */
export function extractLatestAssistantPostToolPlainText(session: ClaudeSession | undefined): string {
  if (!session) {
    return "";
  }
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const msg = session.messages[i];
    if (msg.role !== "assistant") {
      continue;
    }
    const parts = msg.parts ?? [];
    let lastToolIdx = -1;
    for (let j = 0; j < parts.length; j += 1) {
      if (parts[j].type === "tool_use") {
        lastToolIdx = j;
      }
    }
    const afterTool: string[] = [];
    for (let j = 0; j < parts.length; j += 1) {
      const p = parts[j];
      if (p.type !== "text" || typeof p.text !== "string") {
        continue;
      }
      const t = p.text.trim();
      if (!t) {
        continue;
      }
      if (j > lastToolIdx) {
        afterTool.push(t);
      }
    }
    if (afterTool.length > 0) {
      return afterTool.join("\n\n").trim();
    }
    // 有工具但其后无可见 text：不返回整段 content（否则与「仅发最后结论」相悖），交给钉钉解析层用尾部段落等策略。
    if (lastToolIdx >= 0) {
      return "";
    }
    if (msg.content.trim()) {
      return msg.content.trim();
    }
  }
  return "";
}

/** 团队验收等场景：流式缓冲与会话 messages 偶发不同步时，取长的一侧以免截断导致无法解析末尾 JSON。 */
export function mergeAssistantPlainTextPreferLonger(payloadRaw: string, session: ClaudeSession | undefined): string {
  const fromPayload = payloadRaw.trim();
  const fromSession = extractLatestAssistantPlainText(session).trim();
  if (!fromSession) return fromPayload;
  if (!fromPayload) return fromSession;
  return fromSession.length > fromPayload.length ? fromSession : fromPayload;
}

function createSystemTextMessage(text: string) {
  return {
    id: Date.now(),
    role: "system" as const,
    content: text,
    parts: [{ type: "text" as const, text }],
    timestamp: Date.now(),
  };
}

function createUserTextMessage(text: string) {
  return {
    id: Date.now(),
    role: "user" as const,
    content: text,
    parts: [{ type: "text" as const, text }],
    timestamp: Date.now(),
  };
}

/**
 * 当 `targetId` 已是某标签的 `session.id` 时，只按 id 匹配；否则再允许 `claudeSessionId` 匹配。
 * 避免：主会话迁移前的 tab id 被误记在员工子标签的 `claudeSessionId` 上时，向锚点追加派发气泡会写入两条会话。
 */
function sessionMatchesCrossTabTargetId(sessions: ClaudeSession[], session: ClaudeSession, targetId: string): boolean {
  const tid = targetId.trim();
  if (!tid) return false;
  const anyTabHasThisId = sessions.some((s) => s.id === tid);
  if (anyTabHasThisId) {
    return session.id === tid;
  }
  const cid = session.claudeSessionId?.trim();
  return session.id === tid || cid === tid;
}

export function setSessionRunningWithUserPrompt(
  sessions: ClaudeSession[],
  sessionId: string,
  prompt: string,
): ClaudeSession[] {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    return {
      ...session,
      status: "running",
      messages: [...session.messages, createUserTextMessage(prompt)],
    };
  });
}

/**
 * 与 `setSessionRunningWithUserPrompt` 相同地把会话标为 running 并准备新一轮 invoke，
 * 但若已有「首条可展示用户消息」（非纯 tool_use），则改写其正文而非再追加一条，供顶部 sticky 编辑后重发。
 */
export function setSessionRunningReplacingFirstUserBubble(
  sessions: ClaudeSession[],
  sessionId: string,
  prompt: string,
): ClaudeSession[] {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    const messages = [...session.messages];
    const idx = messages.findIndex((m) => m.role === "user" && !isToolOnlyUserMessage(m));
    const textPart = { type: "text" as const, text: prompt };
    if (idx < 0) {
      return {
        ...session,
        status: "running",
        messages: [...messages, createUserTextMessage(prompt)],
      };
    }
    const prev = messages[idx]!;
    messages[idx] = {
      ...prev,
      content: prompt,
      parts: [textPart],
      timestamp: Date.now(),
    };
    return { ...session, status: "running", messages };
  });
}

/** 改写「最后一条」可展示用户消息正文（用于 sticky 锚在最新一轮用户气泡上）。 */
export function setSessionRunningReplacingLastUserBubble(
  sessions: ClaudeSession[],
  sessionId: string,
  prompt: string,
): ClaudeSession[] {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    const messages = [...session.messages];
    let idx = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]!;
      if (m.role === "user" && !isToolOnlyUserMessage(m)) {
        idx = i;
        break;
      }
    }
    const textPart = { type: "text" as const, text: prompt };
    if (idx < 0) {
      return {
        ...session,
        status: "running",
        messages: [...messages, createUserTextMessage(prompt)],
      };
    }
    const prev = messages[idx]!;
    messages[idx] = {
      ...prev,
      content: prompt,
      parts: [textPart],
      timestamp: Date.now(),
    };
    return { ...session, status: "running", messages };
  });
}

/** 改写指定下标的可展示用户消息正文（用于 sticky 随滚动锚到某条「我的」消息后编辑重发）。 */
export function setSessionRunningReplacingUserBubbleAtIndex(
  sessions: ClaudeSession[],
  sessionId: string,
  messageIndex: number,
  prompt: string,
): ClaudeSession[] {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    const messages = [...session.messages];
    const idx = Math.floor(messageIndex);
    const prev = idx >= 0 && idx < messages.length ? messages[idx] : undefined;
    const textPart = { type: "text" as const, text: prompt };
    if (!prev || prev.role !== "user" || isToolOnlyUserMessage(prev)) {
      return {
        ...session,
        status: "running",
        messages: [...messages, createUserTextMessage(prompt)],
      };
    }
    messages[idx] = {
      ...prev,
      content: prompt,
      parts: [textPart],
      timestamp: Date.now(),
    };
    return { ...session, status: "running", messages };
  });
}

/**
 * Esc「撤回刚发」：去掉本轮流式产生的尾随 assistant，再去掉与之对应的那条 user。
 * 会话标为 cancelled，以便后续 `claude-complete` 早退，避免把已撤回的轮次又 finalize 进消息列表。
 */
export function retractLastClaudeTurnFromSession(session: ClaudeSession): ClaudeSession {
  let messages = [...session.messages];
  while (messages.length > 0 && messages[messages.length - 1]!.role === "assistant") {
    messages = messages.slice(0, -1);
  }
  if (messages.length > 0 && messages[messages.length - 1]!.role === "user") {
    messages = messages.slice(0, -1);
  }
  return { ...session, messages, status: "cancelled" as const };
}

/** 仅追加用户消息（不触发 invoke、不改会话状态），供直连批量 OMC 等在锚点标签展示派发正文。 */
export function appendUserMessageBySessionOrClaudeId(
  sessions: ClaudeSession[],
  targetId: string,
  text: string,
): ClaudeSession[] {
  const trimmed = text.trim();
  if (!trimmed) return sessions;
  return sessions.map((session) => {
    if (!sessionMatchesCrossTabTargetId(sessions, session, targetId)) return session;
    return {
      ...session,
      messages: [...session.messages, createUserTextMessage(trimmed)],
    };
  });
}

export function appendSystemMessageBySessionId(
  sessions: ClaudeSession[],
  sessionId: string,
  text: string,
): ClaudeSession[] {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    return {
      ...session,
      messages: [...session.messages, createSystemTextMessage(text)],
    };
  });
}

export function appendSystemMessageBySessionOrClaudeId(
  sessions: ClaudeSession[],
  targetId: string,
  text: string,
): ClaudeSession[] {
  return sessions.map((session) => {
    if (!sessionMatchesCrossTabTargetId(sessions, session, targetId)) return session;
    return {
      ...session,
      messages: [...session.messages, createSystemTextMessage(text)],
    };
  });
}

/**
 * 侧栏「执行中」、监控「员工忙碌」等：前端 `status` 为 running/connecting **或**
 * 宿主 `list_running_claude_sessions` 仍包含该标签的 `claudeSessionId` 时视为仍在跑。
 * 避免 UI 已 idle、子进程仍在时把员工/会话误判为空闲。
 */
export function isClaudeSessionRunningInHostOrUi(
  session: ClaudeSession,
  registryRunningClaudeSessionIds: ReadonlySet<string> | undefined | null,
): boolean {
  if (session.status === "running" || session.status === "connecting") {
    return true;
  }
  if (!registryRunningClaudeSessionIds || registryRunningClaudeSessionIds.size === 0) {
    return false;
  }
  const sid = session.claudeSessionId?.trim() ?? "";
  return sid.length > 0 && registryRunningClaudeSessionIds.has(sid);
}

/**
 * 将各标签的 `status` 与宿主 `list_running_claude_sessions` 注册表对齐。
 *
 * 此前仅对「当前活动 / 双栏伴生」标签在切到时拉一次注册表，后台的主会话、员工独立标签、团队流程会话
 * 若错过 `claude-complete`，会一直卡在 running/connecting；反之亦可能未标 running。
 *
 * `registryBootstrapDeadlineBySid`：resume/再次发送时标签上已有 `claudeSessionId`，但子进程要等首行
 * `system/init` 后宿主才 `register`；轮询若只看注册表会把这段窗口误判为「已不跑」而提前把 UI 打成 idle。
 *
 * `registryKnownSessionIds`：宿主在 `mark_completed` 之后、`remove` 之前会短暂保留 `status: completed/cancelled`
 * 的条目；若降级判断仅用 `status===running` 的集合，会把该 sid 当成「已不在表」而误把 UI 打成 idle。
 */
export function reconcileSessionStatusesWithRunningRegistry(
  sessions: ClaudeSession[],
  runningClaudeSessionIds: ReadonlySet<string>,
  registryBootstrapDeadlineBySid?: ReadonlyMap<string, number> | null,
  registryKnownSessionIds?: ReadonlySet<string> | null,
): ClaudeSession[] {
  const now = Date.now();
  let changed = false;
  const next = sessions.map((s) => {
    const sid = (s.claudeSessionId ?? "").trim();
    if (!sid) return s;
    const inRunningRegistry = runningClaudeSessionIds.has(sid);
    const knownInRegistry =
      registryKnownSessionIds != null ? registryKnownSessionIds.has(sid) : inRunningRegistry;
    const uiBusy = s.status === "running" || s.status === "connecting";
    if (!knownInRegistry && uiBusy) {
      const until = registryBootstrapDeadlineBySid?.get(sid);
      if (until !== undefined && now < until) {
        return s;
      }
      changed = true;
      return { ...s, status: "idle" as const };
    }
    if (inRunningRegistry && !uiBusy) {
      if (s.status === "error" || s.status === "cancelled") return s;
      changed = true;
      return { ...s, status: "running" as const };
    }
    return s;
  });
  return changed ? next : sessions;
}

export function finalizeSessionAfterComplete(params: {
  sessions: ClaudeSession[];
  targetId: string;
  success: boolean;
  noAssistantReply: boolean;
}): ClaudeSession[] {
  const { sessions, targetId, success, noAssistantReply } = params;
  return sessions.map((session) => {
    if (!sessionMatchesCrossTabTargetId(sessions, session, targetId)) return session;
    const isUserCancelled = session.status === "cancelled";
    const noReplyFailureMessage = isUserCancelled
      ? "消息已撤销"
      : "Claude 未成功完成本轮请求（未产出可见回复）。请检查 Hook 配置与 Claude CLI 权限。";
    const messages =
      !success && noAssistantReply
        ? [
            ...session.messages,
            createSystemTextMessage(noReplyFailureMessage),
          ]
        : session.messages;
    return {
      ...session,
      status: success ? "completed" : "cancelled",
      messages,
    };
  });
}

