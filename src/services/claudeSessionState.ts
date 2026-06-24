import type { ClaudeMessage, ClaudeSession, SessionExecutionEngine } from "../types";
import { assistantMessagePostToolTextParts } from "../utils/assistantOrphanMarkdown";
import { isToolOnlyUserMessage, systemMessagePlainText, userMessagePlainTextForDisplay } from "../utils/claudeChatMessageDisplay";
import { sessionHadRecentClaudeTurnFailureNotice } from "../utils/claudeSessionTurnFailure";
import { CLAUDE_NO_VISIBLE_REPLY_FAILURE_HINT } from "../utils/claudeTurnCompleteGate";
import { isClaudeTurnWaitControlError } from "../utils/claudeTurnCompleteWaiter";
import { isMainSessionContextSeedMessage } from "./terminalDispatchContext";

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

function createUserTextMessage(text: string, defaultInstructionApplied?: string) {
  return {
    id: Date.now(),
    role: "user" as const,
    content: text,
    parts: [{ type: "text" as const, text }],
    timestamp: Date.now(),
    ...(defaultInstructionApplied?.trim()
      ? { defaultInstructionApplied: defaultInstructionApplied.trim() }
      : {}),
  };
}

function createAssistantTextMessage(text: string) {
  const trimmed = text.trim();
  return {
    id: Date.now(),
    role: "assistant" as const,
    content: trimmed,
    parts: [{ type: "text" as const, text: trimmed }],
    timestamp: Date.now(),
  };
}

/** complete 前流式缓冲已有正文但 messages 未落盘时，补一条助手气泡避免 UI 闪一下后变空。 */
export function appendAssistantPreviewTextMessage(
  sessions: ClaudeSession[],
  targetId: string,
  previewText: string,
): ClaudeSession[] {
  const trimmed = previewText.trim();
  if (!trimmed) return sessions;
  const matches = buildCrossTabTargetMatcher(sessions, targetId);
  return sessions.map((session) => {
    if (!matches(session)) return session;
    const messages = [...session.messages];
    const last = messages[messages.length - 1];
    if (last?.role !== "assistant") {
      return {
        ...session,
        messages: [...messages, createAssistantTextMessage(trimmed)],
      };
    }
    const parts = last.parts ?? [];
    const hasTools = parts.some((p) => p.type === "tool_use");
    if (!hasTools && assistantMessageVisiblePlainText(last).trim().length > 0) {
      return session;
    }
    const existingPostTool = assistantMessagePostToolTextParts(parts).trim();
    // 末条 assistant 已有「工具后总结」文本，说明流式总结已正常落盘：此安全网本意是
    // 「缓冲有正文但 messages 未落盘时补一条避免闪空」，已落盘时不应再用整轮 previewRaw
    // 覆盖总结 part（previewRaw 取整轮缓冲，含 intro/引导语，会污染总结并致引导语重复）。
    if (existingPostTool.length > 0) return session;
    if (hasTools) {
      // 走到这里 existingPostTool 必为空：末条 assistant 有工具但无工具后总结，
      // 流式缓冲的正文未落进 parts，补一条 post-tool text part 兜底避免闪空。
      const nextParts = [...parts, { type: "text" as const, text: trimmed }];
      messages[messages.length - 1] = {
        ...last,
        content: trimmed,
        parts: nextParts,
        timestamp: Date.now(),
      };
      return { ...session, messages };
    }
    return {
      ...session,
      messages: [...messages, createAssistantTextMessage(trimmed)],
    };
  });
}

/**
 * 构建「跨标签目标匹配」谓词。语义与原 sessionMatchesCrossTabTargetId 完全一致：
 * 当 `targetId` 已是某标签的 `session.id` 时，只按 id 匹配；否则再允许 `claudeSessionId` 匹配。
 * 避免：主会话迁移前的 tab id 被误记在员工子标签的 `claudeSessionId` 上时，向锚点追加派发气泡会写入两条会话。
 *
 * 性能：原实现把对 sessions 的 O(n) `some` 放进 `sessions.map` 回调里，整体 O(n²)；
 * 这里把 `anyTabHasThisId` 提到 map 之外只算一次，调用点降为 O(n)。
 */
function buildCrossTabTargetMatcher(
  sessions: ClaudeSession[],
  targetId: string,
): (session: ClaudeSession) => boolean {
  const tid = targetId.trim();
  if (!tid) return () => false;
  const anyTabHasThisId = sessions.some((s) => s.id === tid);
  if (anyTabHasThisId) {
    return (session: ClaudeSession) => session.id === tid;
  }
  return (session: ClaudeSession) => {
    const cid = session.claudeSessionId?.trim();
    return session.id === tid || cid === tid;
  };
}

export function setSessionRunningWithUserPrompt(
  sessions: ClaudeSession[],
  sessionId: string,
  prompt: string,
  defaultInstructionApplied?: string,
): ClaudeSession[] {
  const trimmed = prompt.trim();
  if (!trimmed) return sessions;
  const applied = defaultInstructionApplied?.trim() || undefined;
  const matches = buildCrossTabTargetMatcher(sessions, sessionId);
  return sessions.map((session) => {
    if (!matches(session)) return session;
    const last = session.messages[session.messages.length - 1];
    if (last?.role === "user" && !isToolOnlyUserMessage(last)) {
      if (userMessagePlainTextForDisplay(last).trim() === trimmed) {
        return applied
          ? {
              ...session,
              status: "running" as const,
              messages: session.messages.map((message, index, all) =>
                index === all.length - 1 ? { ...message, defaultInstructionApplied: applied } : message,
              ),
            }
          : { ...session, status: "running" as const };
      }
    }
    return {
      ...session,
      status: "running",
      messages: [...session.messages, createUserTextMessage(trimmed, applied)],
    };
  });
}

/** 终端派发等强制新回合：单次提交里清空旧 `claudeSessionId` 并写入用户气泡，避免分两次 setState 竞态。 */
function isNoVisibleReplySystemMessage(message: ClaudeMessage): boolean {
  if (message.role !== "system") return false;
  const text = typeof message.content === "string" ? message.content : "";
  return text.includes(CLAUDE_NO_VISIBLE_REPLY_FAILURE_HINT);
}

export function beginSessionTurnWithUserPrompt(
  sessions: ClaudeSession[],
  sessionId: string,
  prompt: string,
  opts?: {
    forceFreshClaudeSession?: boolean;
    prependMessages?: ClaudeMessage[];
    defaultInstructionApplied?: string;
  },
): ClaudeSession[] {
  const applied = opts?.defaultInstructionApplied?.trim() || undefined;
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    const priorMessages = opts?.forceFreshClaudeSession
      ? session.messages.filter(
          (message) =>
            !isNoVisibleReplySystemMessage(message) && !isMainSessionContextSeedMessage(message),
        )
      : session.messages;
    const prepend = opts?.prependMessages ?? [];
    return {
      ...session,
      status: "running",
      claudeSessionId: opts?.forceFreshClaudeSession ? null : session.claudeSessionId,
      messages: [...priorMessages, ...prepend, createUserTextMessage(prompt, applied)],
    };
  });
}

/**
 * 与 `setSessionRunningWithUserPrompt` 相同地把会话标为 running 并准备新一轮 invoke，
 * 但若已有「首条可展示用户消息」（非纯 tool_use），则改写其正文而非再追加一条，供顶部 sticky 编辑后重发。
 */
function patchUserBubbleMessage(
  prev: ClaudeMessage,
  prompt: string,
  defaultInstructionApplied?: string,
): ClaudeMessage {
  const applied = defaultInstructionApplied?.trim() || undefined;
  return {
    ...prev,
    content: prompt,
    parts: [{ type: "text" as const, text: prompt }],
    timestamp: Date.now(),
    defaultInstructionApplied: applied,
  };
}

export function setSessionRunningReplacingFirstUserBubble(
  sessions: ClaudeSession[],
  sessionId: string,
  prompt: string,
  defaultInstructionApplied?: string,
): ClaudeSession[] {
  const applied = defaultInstructionApplied?.trim() || undefined;
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    const messages = [...session.messages];
    const idx = messages.findIndex((m) => m.role === "user" && !isToolOnlyUserMessage(m));
    if (idx < 0) {
      return {
        ...session,
        status: "running",
        messages: [...messages, createUserTextMessage(prompt, applied)],
      };
    }
    messages[idx] = patchUserBubbleMessage(messages[idx]!, prompt, applied);
    return { ...session, status: "running", messages };
  });
}

/** 改写「最后一条」可展示用户消息正文（用于 sticky 锚在最新一轮用户气泡上）。 */
export function setSessionRunningReplacingLastUserBubble(
  sessions: ClaudeSession[],
  sessionId: string,
  prompt: string,
  defaultInstructionApplied?: string,
): ClaudeSession[] {
  const applied = defaultInstructionApplied?.trim() || undefined;
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
    if (idx < 0) {
      return {
        ...session,
        status: "running",
        messages: [...messages, createUserTextMessage(prompt, applied)],
      };
    }
    messages[idx] = patchUserBubbleMessage(messages[idx]!, prompt, applied);
    return { ...session, status: "running", messages };
  });
}

/** 改写指定下标的可展示用户消息正文（用于 sticky 随滚动锚到某条「我的」消息后编辑重发）。 */
export function setSessionRunningReplacingUserBubbleAtIndex(
  sessions: ClaudeSession[],
  sessionId: string,
  messageIndex: number,
  prompt: string,
  defaultInstructionApplied?: string,
): ClaudeSession[] {
  const applied = defaultInstructionApplied?.trim() || undefined;
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    const messages = [...session.messages];
    const idx = Math.floor(messageIndex);
    const prev = idx >= 0 && idx < messages.length ? messages[idx] : undefined;
    if (!prev || prev.role !== "user" || isToolOnlyUserMessage(prev)) {
      return {
        ...session,
        status: "running",
        messages: [...messages, createUserTextMessage(prompt, applied)],
      };
    }
    messages[idx] = patchUserBubbleMessage(prev, prompt, applied);
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
  const matches = buildCrossTabTargetMatcher(sessions, targetId);
  return sessions.map((session) => {
    if (!matches(session)) return session;
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

/** 回合执行失败时写入会话；内部 turn waiter 超时/取消不入库（自动派发场景避免刷屏）。 */
export function applyClaudeExecuteFailureNotice(
  sessions: ClaudeSession[],
  sessionId: string,
  err: unknown,
  opts: { hasClaudeSessionId: boolean },
): ClaudeSession[] {
  if (isClaudeTurnWaitControlError(err)) {
    return sessions.map((session) => {
      if (session.id !== sessionId) return session;
      if (session.status === "running" || session.status === "connecting") {
        return { ...session, status: "idle" as const };
      }
      return session;
    });
  }
  const text = opts.hasClaudeSessionId ? `发送失败: ${err}` : `启动失败: ${err}`;
  return appendSystemMessageBySessionId(
    sessions.map((session) =>
      session.id === sessionId ? { ...session, status: "error" as const } : session,
    ),
    sessionId,
    text,
  );
}

export function appendSystemMessageBySessionOrClaudeId(
  sessions: ClaudeSession[],
  targetId: string,
  text: string,
): ClaudeSession[] {
  const trimmed = text.trim();
  if (!trimmed) return sessions;
  const matches = buildCrossTabTargetMatcher(sessions, targetId);
  return sessions.map((session) => {
    if (!matches(session)) return session;
    const last = session.messages[session.messages.length - 1];
    if (
      last?.role === "system" &&
      (last.content.trim() === trimmed ||
        systemMessagePlainText(last).trim() === trimmed)
    ) {
      return session;
    }
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
function sessionRegistryIds(session: ClaudeSession): string[] {
  const ids = new Set<string>();
  const claudeSid = (session.claudeSessionId ?? "").trim();
  const tabId = session.id.trim();
  if (claudeSid) ids.add(claudeSid);
  if (tabId) ids.add(tabId);
  return [...ids];
}

export function reconcileSessionStatusesWithRunningRegistry(
  sessions: ClaudeSession[],
  runningClaudeSessionIds: ReadonlySet<string>,
  registryBootstrapDeadlineBySid?: ReadonlyMap<string, number> | null,
  registryKnownSessionIds?: ReadonlySet<string> | null,
): ClaudeSession[] {
  const now = Date.now();
  let changed = false;
  const next = sessions.map((s) => {
    const registryIds = sessionRegistryIds(s);
    if (registryIds.length === 0) return s;
    const inRunningRegistry = registryIds.some((id) => runningClaudeSessionIds.has(id));
    const knownInRegistry = registryIds.some((id) =>
      registryKnownSessionIds != null
        ? registryKnownSessionIds.has(id)
        : runningClaudeSessionIds.has(id),
    );
    const uiBusy = s.status === "running" || s.status === "connecting";
    if (!knownInRegistry && uiBusy) {
      const hasBootstrapGrace = registryIds.some((id) => {
        const until = registryBootstrapDeadlineBySid?.get(id);
        return until !== undefined && now < until;
      });
      if (hasBootstrapGrace) {
        return s;
      }
      changed = true;
      return { ...s, status: "idle" as const };
    }
    // 长驻单轮结束后注册表为 completed，若 UI 未收到 complete 事件会一直 running。
    if (knownInRegistry && !inRunningRegistry && uiBusy) {
      changed = true;
      return { ...s, status: "idle" as const };
    }
    if (inRunningRegistry && !uiBusy) {
      if (s.status === "error" || s.status === "cancelled") return s;
      if (s.status === "idle" && sessionHadRecentClaudeTurnFailureNotice(s.messages)) return s;
      changed = true;
      return { ...s, status: "running" as const };
    }
    return s;
  });
  return changed ? next : sessions;
}

/** 按执行引擎返回「无可见回复」时的系统提示（避免 Cursor 回合误用 Claude Hook 文案）。 */
export function resolveNoReplyFailureMessage(
  executionEngine: SessionExecutionEngine | undefined,
  cancelled: boolean,
): string {
  if (cancelled) return "消息已撤销";
  if (executionEngine === "cursor") {
    return "Cursor SDK 本轮未产出可见回复。请检查 API Key、网络与模型（推荐 Auto 或 composer-2.5），或在 /demo.html 运行诊断。";
  }
  if (executionEngine === "codex") {
    return "Codex 本轮未产出可见回复。请检查 API Key 与 Codex CLI 配置。";
  }
  if (executionEngine === "opencode") {
    return "OpenCode 本轮未产出可见回复。请检查 provider 凭据、模型配置与 OpenCode CLI。";
  }
  return "Claude 未成功完成本轮请求（未产出可见回复）。请检查 Hook 配置与 Claude CLI 权限。";
}

export function finalizeSessionAfterComplete(params: {
  sessions: ClaudeSession[];
  targetId: string;
  success: boolean;
  noAssistantReply: boolean;
  /** 长驻 streaming：单轮结束后置 idle，子进程仍存活，便于继续发下一条。 */
  streamingResident?: boolean;
  executionEngine?: SessionExecutionEngine;
}): ClaudeSession[] {
  const {
    sessions,
    targetId,
    success,
    noAssistantReply,
    streamingResident = false,
    executionEngine,
  } = params;
  const matches = buildCrossTabTargetMatcher(sessions, targetId);
  return sessions.map((session) => {
    if (!matches(session)) return session;
    const isUserCancelled = session.status === "cancelled";
    const noReplyFailureMessage = resolveNoReplyFailureMessage(executionEngine, isUserCancelled);
    const shouldAppendNoReplyFailure =
      !success &&
      noAssistantReply &&
      !session.messages.some(
        (message) =>
          message.role === "system" &&
          (typeof message.content === "string" ? message.content : "").includes(
            CLAUDE_NO_VISIBLE_REPLY_FAILURE_HINT,
          ),
      );
    const messages = shouldAppendNoReplyFailure
      ? [...session.messages, createSystemTextMessage(noReplyFailureMessage)]
      : session.messages;
    const nextStatus = success
      ? streamingResident
        ? ("idle" as const)
        : ("completed" as const)
      : streamingResident
        ? ("idle" as const)
        : ("cancelled" as const);
    return {
      ...session,
      status: nextStatus,
      messages,
    };
  });
}

