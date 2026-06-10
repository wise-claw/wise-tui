import { startTransition, type MutableRefObject } from "react";
import { sessionUsesStreamingConnection } from "../constants/claudeConnection";
import type { ClaudeSession, MessagePart } from "../types";
import {
  appendAssistantStreamParts,
  applyToolResultPartsToSession,
  capAssistantStreamBufferText,
  partitionStreamMessageParts,
} from "./claudeStreamAssembler";
import {
  extractCodexResumeSessionIdFromStreamLine,
  extractCursorAgentIdFromCompletePayload,
  extractCursorAgentIdFromStreamLine,
  extractResultErrorMessageFromStreamLine,
  formatClaudeResultErrorForSessionUi,
  isClaudeHarnessInjectedStreamText,
  isClaudeToolCallParseFailureText,
  shouldClearCodexResumeSessionFromStreamLine,
  stripClaudeHarnessInjectedStreamText,
} from "./claudeStreamParser";
import {
  appendAssistantPreviewTextMessage,
  appendSystemMessageBySessionOrClaudeId,
  extractLatestAssistantPlainText,
  finalizeSessionAfterComplete,
} from "./claudeSessionState";
import { isTerminalWorkerWiseTab } from "./terminalDispatch";
import {
  latestTerminalTurnHasAssistant,
  latestTurnHasVisibleAssistantContent,
  ONESHOT_DEFERRED_COMPLETE_RETRY_DELAYS_MS,
  shouldDeferOneshotTurnComplete,
  shouldForceFinalizeDeferredOneshotComplete,
} from "../hooks/useClaudeSessions.transcript";
import { isExplicitClaudeCompleteFailure } from "../utils/resolveClaudeCompleteSuccess";
import {
  isStaleClaudeCompleteForSession,
  resolveExpectedTurnNonceForTab,
  shouldApplyClaudeTurnComplete,
} from "../utils/claudeTurnCompleteGate";
import { preservesWorkerWiseTabId } from "../utils/sessionExecuteResolve";

type SetSessions = (updater: (prev: ClaudeSession[]) => ClaudeSession[]) => void;
type SetActiveSessionId = (updater: (prev: string | null) => string | null) => void;

interface ExtractPartsResult {
  parts: MessagePart[];
  isInit: boolean;
  sessionId: string | null;
}

interface RuntimeDeps {
  sessionsRef: MutableRefObject<ClaudeSession[]>;
  streamingTargetIdRef: MutableRefObject<string | null>;
  sessionIdMapRef: MutableRefObject<Map<string, string>>;
  lastStreamLineBySessionRef: MutableRefObject<Map<string, { line: string; at: number }>>;
  lastStreamTextBySessionRef: MutableRefObject<Map<string, { text: string; at: number }>>;
  lastUserSendNonceRef: MutableRefObject<number>;
  /** 按标签会话 id 累积流式助手可见文本，支持多会话并行时互不串台 */
  assistantStreamTextByTabRef: MutableRefObject<Map<string, string>>;
  setSessions: SetSessions;
  setActiveSessionId: SetActiveSessionId;
  ingestClaudeStreamLineForHub: (sessionId: string, line: string) => void;
  ingestAskUserQuestionFromMessageParts: (sessionId: string, parts: readonly MessagePart[]) => void;
  ingestStreamAssistText: (sessionId: string, text: string) => void;
  ingestTodosFromSessionMessages: (sessionId: string, messages: ClaudeSession["messages"]) => void;
  finalizeTodosAfterSuccessfulTurn: (sessionId: string, messages: ClaudeSession["messages"]) => void;
  migrateSessionKey: (from: string, to: string) => void;
  notifyCompletion: (payload: { tid: string; success: boolean; nonce: number; previewRaw: string; structuredVerdict?: unknown }) => void;
  parseStreamLineSessionId: (line: string) => string | null;
  resolveTabIdForClaudeStream: (
    sessions: ClaudeSession[],
    lineSid: string | null,
    refTid: string | null,
  ) => string | null;
  resolveTabIdFromCompletePayload: (
    payload: unknown,
    sessions: ClaudeSession[],
    refTid: string | null,
  ) => string | null;
  resolveSuccessFromCompletePayload: (payload: unknown) => boolean;
  extractSystemErrorMessageFromStreamLine: (line: string) => string | null;
  extractPartsFromStreamLine: (line: string) => ExtractPartsResult;
  /** 临时 tab id 合并为 Claude `session_id` 时通知宿主（用于双栏右侧绑定 id 同步） */
  onSessionTabIdMigrated?: (fromTabId: string, toClaudeSessionId: string) => void;
  /** `system.init` 绑定 Claude `session_id`（含保留 Wise 标签 id 的终端 worker） */
  onClaudeSessionIdAssigned?: (tabId: string, claudeSessionId: string) => void;
  /** 与 `executeSession` 写入的轮次 nonce 对齐；全局 `claude-complete` 用于通知去重，避免误用「当前最新」nonce */
  expectedTurnNonceByTabIdRef?: MutableRefObject<Map<string, number>>;
  /** 任意 stdout 行到达时重置「无可见输出」看门狗（Hook 阶段可能尚无助手正文）。 */
  onStreamActivity?: (tabId: string) => void;
  /**
   * 一轮流式结束后用磁盘 `*.jsonl` 覆盖内存消息，与 Claude Code 原生会话对齐。
   * 流式路径会把多行 delta 压成少量气泡并带去重，仅靠内存会与 jsonl 条数不一致。
   */
  reloadTranscriptFromDisk?: (input: {
    tabId: string;
    repositoryPath: string;
    claudeSessionId: string;
  }) => void | Promise<void>;
}


function extractStructuredVerdictFromCompletePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return undefined;
  const obj = payload as Record<string, unknown>;
  return obj.structuredVerdict ?? obj.workflowAcceptanceVerdictPayload ?? obj.verdictPayload;
}

function isDocumentHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState !== "visible";
}

/** 窗口 hidden 时仍须解析 Hub 的行（权限 / 追问 / init 等）。 */
function streamLineNeedsHubWhileHidden(line: string): boolean {
  return (
    line.includes("control_request") ||
    line.includes("sdk_control_request") ||
    line.includes("AskUserQuestion") ||
    line.includes('"can_use_tool"') ||
    line.includes("ExitPlanMode")
  );
}

function streamLineMayInit(line: string): boolean {
  return line.includes('"init"') || line.includes("system.init");
}

let hiddenUiFlushHandler: (() => void) | null = null;
let hiddenUiVisibilityListenerReady = false;

function ensureHiddenUiVisibilityListener(): void {
  if (hiddenUiVisibilityListenerReady || typeof document === "undefined") return;
  hiddenUiVisibilityListenerReady = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      hiddenUiFlushHandler?.();
    }
  });
}

export function createClaudeStreamRuntime(deps: RuntimeDeps) {
  const {
    sessionsRef,
    streamingTargetIdRef,
    sessionIdMapRef,
    lastStreamLineBySessionRef,
    lastStreamTextBySessionRef,
    lastUserSendNonceRef,
    assistantStreamTextByTabRef,
    setSessions,
    setActiveSessionId,
    ingestClaudeStreamLineForHub,
    ingestAskUserQuestionFromMessageParts,
    ingestStreamAssistText,
    ingestTodosFromSessionMessages,
    finalizeTodosAfterSuccessfulTurn,
    migrateSessionKey,
    notifyCompletion,
    parseStreamLineSessionId,
    resolveTabIdForClaudeStream,
    resolveTabIdFromCompletePayload,
    resolveSuccessFromCompletePayload,
    extractSystemErrorMessageFromStreamLine,
    extractPartsFromStreamLine,
    onSessionTabIdMigrated,
    onClaudeSessionIdAssigned,
    reloadTranscriptFromDisk,
    expectedTurnNonceByTabIdRef,
    onStreamActivity,
  } = deps;

  const deferredStreamTabIds = new Set<string>();
  const deferredSystemErrors: Array<{ tid: string; msg: string }> = [];
  const deferredStderrErrors: Array<{ tid: string; msg: string }> = [];
  const deferredCompletes: Array<{ tid: string; payload: unknown; turnNonce: number }> = [];
  const pendingOneshotCompletes = new Map<
    string,
    { payload: unknown; turnNonce: number; payloadSuccess: boolean; storedAt: number }
  >();
  const pendingOneshotWatchdogTimers = new Map<string, number[]>();
  const DEFERRED_MAX = 256;

  type SessionListUpdater = (prev: ClaudeSession[]) => ClaudeSession[];
  const pendingStreamSessionUpdaters: SessionListUpdater[] = [];
  let streamSessionFlushRaf: number | null = null;

  function applyPendingStreamSessionUpdates(
    prev: ClaudeSession[],
    updaters: SessionListUpdater[],
  ): ClaudeSession[] {
    let next = prev;
    for (const updater of updaters) {
      next = updater(next);
    }
    return next;
  }

  function flushPendingStreamSessionUpdates(opts?: { immediate?: boolean }): void {
    if (streamSessionFlushRaf !== null) {
      window.cancelAnimationFrame(streamSessionFlushRaf);
      streamSessionFlushRaf = null;
    }
    if (pendingStreamSessionUpdaters.length === 0) return;
    const updaters = pendingStreamSessionUpdaters.splice(0);
    const run = (prev: ClaudeSession[]) => applyPendingStreamSessionUpdates(prev, updaters);
    if (opts?.immediate) {
      setSessions(run);
      return;
    }
    startTransition(() => {
      setSessions(run);
    });
  }

  function flushPendingStreamSessionUpdatesSync(): void {
    flushPendingStreamSessionUpdates({ immediate: true });
  }

  function schedulePendingStreamSessionFlush(): void {
    if (streamSessionFlushRaf !== null) return;
    streamSessionFlushRaf = window.requestAnimationFrame(() => {
      streamSessionFlushRaf = null;
      flushPendingStreamSessionUpdates();
    });
  }

  function enqueueStreamSessionUpdate(updater: SessionListUpdater): void {
    pendingStreamSessionUpdaters.push(updater);
    schedulePendingStreamSessionFlush();
  }

  function buildStreamSessionUpdater(
    tid: string,
    dedupedParts: MessagePart[],
    isInit: boolean,
    realSessionId: string | null,
    opts: { syncStreamingTargetRefOnInit: boolean },
  ): SessionListUpdater {
    return (prev) =>
      prev.map((s) => {
        if (s.id !== tid && s.claudeSessionId !== tid) return s;
        let updated = { ...s };
        if (isInit && realSessionId) {
          sessionIdMapRef.current.set(tid, realSessionId);
          onClaudeSessionIdAssigned?.(tid, realSessionId);
          const preserveWiseTabId =
            isTerminalWorkerWiseTab(updated) || preservesWorkerWiseTabId(updated);
          if (preserveWiseTabId) {
            updated = { ...updated, claudeSessionId: realSessionId };
          } else {
            updated = { ...updated, id: realSessionId, claudeSessionId: realSessionId };
            if (opts.syncStreamingTargetRefOnInit) {
              streamingTargetIdRef.current = realSessionId;
            }
            setActiveSessionId((aid) => (aid === tid ? realSessionId : aid));
          }
        }
        if (dedupedParts.length > 0 && !isInit) {
          const { toolResults, streamParts } = partitionStreamMessageParts(dedupedParts);
          if (toolResults.length > 0) {
            updated = applyToolResultPartsToSession(updated, toolResults);
          }
          if (streamParts.length > 0) {
            updated = appendAssistantStreamParts(updated, streamParts);
          }
          ingestTodosFromSessionMessages(tid, updated.messages);
        }
        return updated;
      });
  }
  function pushDeferred<T>(arr: T[], item: T): void {
    if (arr.length >= DEFERRED_MAX) arr.shift();
    arr.push(item);
  }

  function looksLikeClaudeUuid(s: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
  }

  function reloadTranscriptForTab(tid: string): void {
    if (!reloadTranscriptFromDisk) return;
    const session = sessionsRef.current.find((s) => s.id === tid || s.claudeSessionId === tid);
    if (!session) return;
    const stableTabId = session.id;
    const repo = session.repositoryPath?.trim() ?? "";
    const tidTrim = tid.trim();
    const ccid =
      session.claudeSessionId?.trim() ||
      sessionIdMapRef.current.get(stableTabId)?.trim() ||
      sessionIdMapRef.current.get(tidTrim)?.trim() ||
      (looksLikeClaudeUuid(tidTrim) ? tidTrim : "");
    if (!repo || !ccid) return;
    void reloadTranscriptFromDisk({ tabId: stableTabId, repositoryPath: repo, claudeSessionId: ccid });
  }

  function flushHiddenUiIfNeeded(): void {
    if (isDocumentHidden()) return;

    for (const { tid, msg } of deferredSystemErrors) {
      setSessions((prev) => appendSystemMessageBySessionOrClaudeId(prev, tid, msg));
    }
    deferredSystemErrors.length = 0;

    for (const { tid, msg } of deferredStderrErrors) {
      setSessions((prev) => appendSystemMessageBySessionOrClaudeId(prev, tid, msg));
    }
    deferredStderrErrors.length = 0;

    for (const item of deferredCompletes) {
      applySessionComplete(item.tid, item.payload, item.turnNonce, { uiOnly: true });
    }
    deferredCompletes.length = 0;

    for (const tid of deferredStreamTabIds) {
      reloadTranscriptForTab(tid);
    }
    deferredStreamTabIds.clear();
  }

  hiddenUiFlushHandler = flushHiddenUiIfNeeded;
  ensureHiddenUiVisibilityListener();

  /** 多标签并行时：用 invocation 通道回退到发送时的 tab id，且勿写全局 `streamingTargetIdRef`（否则后发送会话会抢走先发送会话的流式路由）。 */
  function handleOutputForSendTab(
    stableTabId: string,
    payload: unknown,
    opts?: { syncStreamingTargetRefOnInit?: boolean },
  ) {
    const line = typeof payload === "string" ? payload : JSON.stringify(payload);
    const lineSid = parseStreamLineSessionId(line);
    const mapped = sessionIdMapRef.current.get(stableTabId) ?? stableTabId;
    let tid = resolveTabIdForClaudeStream(sessionsRef.current, lineSid, mapped);
    if (!tid) {
      tid = resolveTabIdForClaudeStream(sessionsRef.current, null, stableTabId);
    }
    if (!tid) return;
    onStreamActivity?.(tid);
    applyOutputLine(tid, line, {
      syncStreamingTargetRefOnInit: opts?.syncStreamingTargetRefOnInit ?? false,
    });
  }

  function applyOutputLine(
    tid: string,
    line: string,
    opts: { syncStreamingTargetRefOnInit: boolean },
  ) {
    const hidden = isDocumentHidden();
    const now = Date.now();

    if (hidden && !streamLineNeedsHubWhileHidden(line) && !streamLineMayInit(line)) {
      deferredStreamTabIds.add(tid);
      const systemErrMsg = extractSystemErrorMessageFromStreamLine(line);
      if (systemErrMsg) {
        pushDeferred(deferredSystemErrors, { tid, msg: systemErrMsg });
      }
      const resultErrMsg = extractResultErrorMessageFromStreamLine(line);
      if (resultErrMsg) {
        pushDeferred(deferredSystemErrors, {
          tid,
          msg: formatClaudeResultErrorForSessionUi(resultErrMsg),
        });
      }
      return;
    }

    const lineForDedup = line.length > 8192 ? line.slice(-8192) : line;
    const prevLine = lastStreamLineBySessionRef.current.get(tid);
    if (prevLine && prevLine.line === lineForDedup && now - prevLine.at < 1500) {
      return;
    }
    lastStreamLineBySessionRef.current.set(tid, { line: lineForDedup, at: now });
    if (!hidden || streamLineNeedsHubWhileHidden(line)) {
      ingestClaudeStreamLineForHub(tid, line);
    }
    const systemErrMsg = extractSystemErrorMessageFromStreamLine(line);
    if (systemErrMsg) {
      if (isDocumentHidden()) {
        pushDeferred(deferredSystemErrors, { tid, msg: systemErrMsg });
      } else {
        setSessions((prev) => appendSystemMessageBySessionOrClaudeId(prev, tid, systemErrMsg));
      }
    }
    const resultErrMsg = extractResultErrorMessageFromStreamLine(line);
    if (resultErrMsg) {
      const formatted = formatClaudeResultErrorForSessionUi(resultErrMsg);
      if (isDocumentHidden()) {
        pushDeferred(deferredSystemErrors, { tid, msg: formatted });
      } else {
        setSessions((prev) => appendSystemMessageBySessionOrClaudeId(prev, tid, formatted));
      }
    }
    if (shouldClearCodexResumeSessionFromStreamLine(line)) {
      onStreamActivity?.(tid);
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== tid && s.claudeSessionId !== tid) return s;
          return { ...s, claudeSessionId: null };
        }),
      );
    }
    const codexResumeSessionId = extractCodexResumeSessionIdFromStreamLine(line);
    if (codexResumeSessionId) {
      onStreamActivity?.(tid);
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== tid && s.claudeSessionId !== tid) return s;
          return { ...s, claudeSessionId: codexResumeSessionId };
        }),
      );
      onClaudeSessionIdAssigned?.(tid, codexResumeSessionId);
    }
    const cursorAgentId = extractCursorAgentIdFromStreamLine(line);
    if (cursorAgentId) {
      onStreamActivity?.(tid);
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== tid && s.claudeSessionId !== tid) return s;
          return { ...s, claudeSessionId: cursorAgentId };
        }),
      );
      onClaudeSessionIdAssigned?.(tid, cursorAgentId);
    }
    const { parts, isInit, sessionId: realSessionId } = extractPartsFromStreamLine(line);
    const sanitizedParts: MessagePart[] = parts.flatMap((part): MessagePart[] => {
      if (part.type !== "text") return [part];
      const cleaned = stripClaudeHarnessInjectedStreamText(part.text);
      if (!cleaned || isClaudeHarnessInjectedStreamText(cleaned)) return [];
      if (cleaned === part.text) return [part];
      return [{ type: "text", text: cleaned }];
    });
    const dedupedParts = sanitizedParts.filter((part) => {
      if (part.type !== "text") return true;
      const normalized = part.text.trim();
      if (normalized.length < 12) return true;
      const prevText = lastStreamTextBySessionRef.current.get(tid);
      if (prevText && prevText.text === normalized && now - prevText.at < 1500) {
        return false;
      }
      lastStreamTextBySessionRef.current.set(tid, { text: normalized, at: now });
      return true;
    });
    if (dedupedParts.length > 0) {
      ingestAskUserQuestionFromMessageParts(tid, dedupedParts);
    }

    if (!hidden) {
      const prevAssist = assistantStreamTextByTabRef.current.get(tid) ?? "";
      let nextAssist = prevAssist;
      for (const part of dedupedParts) {
        if (part.type === "text" && part.text) {
          ingestStreamAssistText(tid, part.text);
          nextAssist += part.text;
        } else if (part.type === "reasoning" && part.text) {
          nextAssist += part.text;
        }
      }
      if (nextAssist !== prevAssist) {
        assistantStreamTextByTabRef.current.set(tid, capAssistantStreamBufferText(nextAssist));
      }
    }

    const hasStreamUiUpdate = dedupedParts.length > 0 && !isInit;
    const mustPublishInit = Boolean(isInit && realSessionId);
    if (hidden && hasStreamUiUpdate && !mustPublishInit) {
      deferredStreamTabIds.add(tid);
    } else if (mustPublishInit) {
      flushPendingStreamSessionUpdatesSync();
      setSessions(buildStreamSessionUpdater(tid, dedupedParts, isInit, realSessionId, opts));
    } else if (hasStreamUiUpdate) {
      enqueueStreamSessionUpdate(
        buildStreamSessionUpdater(tid, dedupedParts, false, null, opts),
      );
      scheduleTryFinalizePendingOneshotComplete(tid);
    }

    if (isInit && realSessionId) {
      const sessionForTid =
        sessionsRef.current.find((s) => s.id === tid || s.claudeSessionId === tid) ?? null;
      const preserveWiseTabId =
        sessionForTid != null &&
        (isTerminalWorkerWiseTab(sessionForTid) || preservesWorkerWiseTabId(sessionForTid));
      migrateSessionKey(tid, realSessionId);
      const buf = assistantStreamTextByTabRef.current.get(tid);
      if (buf !== undefined) {
        assistantStreamTextByTabRef.current.delete(tid);
        assistantStreamTextByTabRef.current.set(
          preserveWiseTabId ? tid : realSessionId,
          capAssistantStreamBufferText(buf),
        );
      }
      if (!preserveWiseTabId) {
        onSessionTabIdMigrated?.(tid, realSessionId);
      }
    }
  }

  function handleOutput(payload: unknown) {
    const refTid = streamingTargetIdRef.current;
    if (!refTid) return;
    // 与 invocation 路径共用 tab 映射：`system.init` 后 tab id 会变为 Claude session_id，旧 ref 须经 sessionIdMap 解析。
    handleOutputForSendTab(refTid, payload, { syncStreamingTargetRefOnInit: true });
  }

  function clearAssistBufferKeysForTab(session: ClaudeSession | undefined, tid: string) {
    assistantStreamTextByTabRef.current.delete(tid);
    if (session) {
      assistantStreamTextByTabRef.current.delete(session.id);
      const cc = session.claudeSessionId?.trim();
      if (cc) assistantStreamTextByTabRef.current.delete(cc);
    }
  }

  function clearPendingOneshotComplete(tid: string): void {
    pendingOneshotCompletes.delete(tid);
    const timers = pendingOneshotWatchdogTimers.get(tid);
    if (timers) {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
      pendingOneshotWatchdogTimers.delete(tid);
    }
  }

  function storePendingOneshotComplete(
    tid: string,
    payload: unknown,
    turnNonce: number,
    payloadSuccess: boolean,
  ): void {
    pendingOneshotCompletes.set(tid, {
      payload,
      turnNonce,
      payloadSuccess,
      storedAt: Date.now(),
    });
    const existing = pendingOneshotWatchdogTimers.get(tid);
    if (existing) {
      for (const timer of existing) {
        window.clearTimeout(timer);
      }
    }
    const timers = ONESHOT_DEFERRED_COMPLETE_RETRY_DELAYS_MS.map((delay) =>
      window.setTimeout(() => {
        tryFinalizePendingOneshotComplete(tid);
      }, delay),
    );
    pendingOneshotWatchdogTimers.set(tid, timers);
  }

  function tryFinalizePendingOneshotComplete(tid: string, opts?: { force?: boolean }): void {
    const pending = pendingOneshotCompletes.get(tid);
    if (!pending) return;
    if (!turnNonceStillExpectedForTab(tid, pending.turnNonce)) {
      clearPendingOneshotComplete(tid);
      return;
    }
    const session = sessionsRef.current.find((s) => s.id === tid || s.claudeSessionId === tid);
    if (sessionUsesStreamingConnection(session)) {
      clearPendingOneshotComplete(tid);
      return;
    }
    flushPendingStreamSessionUpdatesSync();
    const live =
      sessionsRef.current.find((s) => s.id === tid || s.claudeSessionId === tid) ?? session;
    const messages = live?.messages ?? [];
    const deferredForMs = Date.now() - pending.storedAt;
    const shouldFinalize =
      opts?.force === true ||
      !shouldDeferOneshotTurnComplete(messages, pending.payloadSuccess) ||
      shouldForceFinalizeDeferredOneshotComplete(messages, deferredForMs);
    if (!shouldFinalize) return;
    clearPendingOneshotComplete(tid);
    applySessionComplete(tid, pending.payload, pending.turnNonce, { force: true });
  }

  function scheduleTryFinalizePendingOneshotComplete(tid: string): void {
    if (!pendingOneshotCompletes.has(tid)) return;
    window.queueMicrotask(() => {
      flushPendingStreamSessionUpdatesSync();
      tryFinalizePendingOneshotComplete(tid);
    });
  }

  function turnNonceStillExpectedForTab(tabId: string, turnNonce: number): boolean {
    const map = expectedTurnNonceByTabIdRef?.current;
    if (!map) return false;
    const session = sessionsRef.current.find((s) => s.id === tabId || s.claudeSessionId === tabId);
    const keys = new Set<string>([tabId]);
    if (session?.id) keys.add(session.id);
    const cc = session?.claudeSessionId?.trim();
    if (cc) keys.add(cc);
    for (const key of keys) {
      if (map.get(key) === turnNonce) return true;
    }
    return false;
  }

  function applySessionComplete(
    tid: string,
    payload: unknown,
    turnNonce: number,
    opts?: { uiOnly?: boolean; force?: boolean },
  ): boolean {
    const session = sessionsRef.current.find((s) => s.id === tid || s.claudeSessionId === tid);
    if (isStaleClaudeCompleteForSession(session, payload)) {
      return false;
    }
    const awaitingThisTurn = turnNonceStillExpectedForTab(tid, turnNonce);
    if (!shouldApplyClaudeTurnComplete(awaitingThisTurn)) {
      return false;
    }
    const streamingResident = sessionUsesStreamingConnection(session);
    const payloadSuccess = resolveSuccessFromCompletePayload(payload);
    const buf = assistantStreamTextByTabRef.current;
    const chunks = [
      (buf.get(tid) ?? "").trim(),
      session ? (buf.get(session.id) ?? "").trim() : "",
      session?.claudeSessionId?.trim() ? (buf.get(session.claudeSessionId.trim()) ?? "").trim() : "",
    ];
    const fromRef = chunks.reduce((best, cur) => (cur.length > best.length ? cur : best), "");
    const fromMessages = extractLatestAssistantPlainText(session).trim();
    const structuredVerdict = extractStructuredVerdictFromCompletePayload(payload);
    flushPendingStreamSessionUpdatesSync();
    const sessionAfterFlush =
      sessionsRef.current.find((s) => s.id === tid || s.claudeSessionId === tid) ?? session;
    const fromAfterFlush = extractLatestAssistantPlainText(sessionAfterFlush).trim();
    // 流式缓冲与 messages 偶发不同步时，取最长正文兜底，避免验收解析拿不到回复。
    const previewRaw = [fromRef, fromMessages, fromAfterFlush].reduce(
      (best, cur) => (cur.length > best.length ? cur : best),
      "",
    );
    const noAssistantReply = previewRaw.length === 0;
    const flushedMessages = sessionAfterFlush?.messages ?? [];
    const hasVisibleTextReply = fromAfterFlush.length > 0;
    const hasStreamProgress = latestTurnHasVisibleAssistantContent(flushedMessages);
    const isTerminal = session != null && isTerminalWorkerWiseTab(session);
    const terminalEmptySuccess =
      isTerminal && payloadSuccess && !hasVisibleTextReply && !hasStreamProgress;
    if (
      !streamingResident &&
      !opts?.force &&
      shouldDeferOneshotTurnComplete(flushedMessages, payloadSuccess)
    ) {
      storePendingOneshotComplete(tid, payload, turnNonce, payloadSuccess);
      return false;
    }
    clearPendingOneshotComplete(tid);
    clearAssistBufferKeysForTab(session, tid);
    // 仅 text 正文可抵消迟到 cancel；思考块 / 工具块不算「已完成」。
    // CLI 已明确 success=false（如工具调用解析失败）时，局部思考/工具进度不算成功回合。
    const uiSuccess = isExplicitClaudeCompleteFailure(payload)
      ? false
      : payloadSuccess ||
        (hasVisibleTextReply &&
          !isClaudeToolCallParseFailureText(previewRaw) &&
          !isClaudeToolCallParseFailureText(fromAfterFlush));
    if (terminalEmptySuccess) {
      const shouldTryDiskReload = reloadTranscriptFromDisk != null;
      if (shouldTryDiskReload) {
        for (const delay of [400, 1200, 2800]) {
          window.setTimeout(() => {
            const live = sessionsRef.current.find((s) => s.id === tid || s.claudeSessionId === tid);
            if (live && latestTerminalTurnHasAssistant(live.messages)) return;
            reloadTranscriptForTab(tid);
          }, delay);
        }
      }
      return false;
    }
    if (!opts?.uiOnly) {
      notifyCompletion({ tid, success: uiSuccess, nonce: turnNonce, previewRaw, structuredVerdict });
      if (isDocumentHidden()) {
        pushDeferred(deferredCompletes, { tid, payload, turnNonce });
        return true;
      }
    }
    setSessions((prev) => {
      let sessions = prev.map((s) => {
        if (s.id !== tid && s.claudeSessionId !== tid) return s;
        const boundCursorAgentId = extractCursorAgentIdFromCompletePayload(payload);
        if (!boundCursorAgentId) return s;
        return { ...s, claudeSessionId: boundCursorAgentId };
      });
      if (uiSuccess && previewRaw) {
        sessions = appendAssistantPreviewTextMessage(sessions, tid, previewRaw);
      }
      const effectiveNoAssistantReply =
        extractLatestAssistantPlainText(
          sessions.find((s) => s.id === tid || s.claudeSessionId === tid),
        ).trim().length === 0;
      return finalizeSessionAfterComplete({
        sessions,
        targetId: tid,
        success: uiSuccess,
        noAssistantReply: effectiveNoAssistantReply,
        streamingResident,
      });
    });
    if (uiSuccess && session) {
      finalizeTodosAfterSuccessfulTurn(session.id, session.messages);
    }
    // 多员工/多会话并行时：仅当「当前仍指向本会话」时才清空，避免误清其它仍在流式中的标签
    const refT = streamingTargetIdRef.current;
    if (
      refT !== null &&
      (refT === tid ||
        (session && (refT === session.id || refT === session.claudeSessionId?.trim())))
    ) {
      streamingTargetIdRef.current = null;
    }

    const shouldTryDiskReload =
      reloadTranscriptFromDisk &&
      (uiSuccess ||
        (noAssistantReply && session != null && isTerminalWorkerWiseTab(session)));
    if (shouldTryDiskReload) {
      const latestTurnHasAssistant =
        sessionAfterFlush != null &&
        latestTurnHasVisibleAssistantContent(sessionAfterFlush.messages);
      const skipDiskReload =
        uiSuccess &&
        session != null &&
        latestTurnHasAssistant &&
        session.messages.length > 0 &&
        (streamingResident || Boolean(session.diskTranscriptPartial));
      if (!skipDiskReload) {
        const isTerminal = session != null && isTerminalWorkerWiseTab(session);
        const delays =
          isTerminal && !latestTurnHasAssistant ? [400, 1200, 2800] : [120];
        for (const delay of delays) {
          window.setTimeout(() => {
            const live = sessionsRef.current.find((s) => s.id === tid || s.claudeSessionId === tid);
            if (
              live &&
              latestTurnHasVisibleAssistantContent(live.messages) &&
              (isTerminal || live.status === "running" || live.status === "connecting")
            ) {
              return;
            }
            reloadTranscriptForTab(tid);
          }, delay);
        }
      }
    }
    return true;
  }

  function handleComplete(payload: unknown) {
    const refTid = streamingTargetIdRef.current;
    if (!refTid) return;
    const mapRef = expectedTurnNonceByTabIdRef?.current;
    const nonceForTurn = resolveExpectedTurnNonceForTab({
      tabId: refTid,
      sessionIdMap: sessionIdMapRef.current,
      nonceByTabId: mapRef ?? new Map(),
      sessions: sessionsRef.current,
      boundNonce: lastUserSendNonceRef.current,
    });
    if (nonceForTurn === undefined) return;
    handleCompleteForSendTab(refTid, payload, nonceForTurn);
  }

  function handleCompleteForSendTab(
    stableTabId: string,
    payload: unknown,
    turnNonce: number,
  ): boolean {
    const mapped = sessionIdMapRef.current.get(stableTabId) ?? stableTabId;
    let tid = resolveTabIdFromCompletePayload(payload, sessionsRef.current, mapped);
    if (!tid) tid = resolveTabIdFromCompletePayload(payload, sessionsRef.current, stableTabId);
    if (!tid) {
      const session = sessionsRef.current.find((s) => s.id === mapped || s.claudeSessionId === mapped);
      tid = session?.id ?? null;
    }
    if (!tid) return false;
    return applySessionComplete(tid, payload, turnNonce);
  }

  function handleError(payload: unknown) {
    const refTid = streamingTargetIdRef.current;
    if (!refTid) return;
    handleErrorForSendTab(refTid, payload);
  }

  function handleErrorForSendTab(stableTabId: string, payload: unknown) {
    const mapped = sessionIdMapRef.current.get(stableTabId) ?? stableTabId;
    const session = sessionsRef.current.find((s) => s.id === mapped || s.claudeSessionId === mapped);
    const tid = session?.id ?? mapped;
    const errorMsg = typeof payload === "string" ? payload : JSON.stringify(payload);
    const fullMsg = `Claude stderr: ${errorMsg}`;
    if (isDocumentHidden()) {
      pushDeferred(deferredStderrErrors, { tid, msg: fullMsg });
      return;
    }
    setSessions((prev) => appendSystemMessageBySessionOrClaudeId(prev, tid, fullMsg));
  }

  function dispose(): void {
    flushPendingStreamSessionUpdatesSync();
    pendingStreamSessionUpdaters.length = 0;
    if (hiddenUiFlushHandler === flushHiddenUiIfNeeded) {
      hiddenUiFlushHandler = null;
    }
    deferredStreamTabIds.clear();
    deferredSystemErrors.length = 0;
    deferredStderrErrors.length = 0;
    deferredCompletes.length = 0;
    for (const tid of [...pendingOneshotCompletes.keys()]) {
      clearPendingOneshotComplete(tid);
    }
  }

  return {
    handleOutput,
    handleComplete,
    handleError,
    handleOutputForSendTab,
    handleCompleteForSendTab,
    handleErrorForSendTab,
    dispose,
  };
}

