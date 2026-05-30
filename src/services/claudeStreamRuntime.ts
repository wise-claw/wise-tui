import type { MutableRefObject } from "react";
import { sessionUsesStreamingConnection } from "../constants/claudeConnection";
import type { ClaudeSession, MessagePart } from "../types";
import {
  appendAssistantStreamParts,
  applyToolResultPartsToSession,
  capAssistantStreamBufferText,
} from "./claudeStreamAssembler";
import {
  appendSystemMessageBySessionOrClaudeId,
  extractLatestAssistantPlainText,
  finalizeSessionAfterComplete,
} from "./claudeSessionState";
import { isTerminalWorkerWiseTab } from "./terminalDispatch";

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
    const now = Date.now();
    const lineForDedup = line.length > 8192 ? line.slice(-8192) : line;
    const prevLine = lastStreamLineBySessionRef.current.get(tid);
    if (prevLine && prevLine.line === lineForDedup && now - prevLine.at < 1500) {
      return;
    }
    lastStreamLineBySessionRef.current.set(tid, { line: lineForDedup, at: now });
    ingestClaudeStreamLineForHub(tid, line);
    const systemErrMsg = extractSystemErrorMessageFromStreamLine(line);
    if (systemErrMsg) {
      setSessions((prev) => appendSystemMessageBySessionOrClaudeId(prev, tid, systemErrMsg));
    }
    const { parts, isInit, sessionId: realSessionId } = extractPartsFromStreamLine(line);
    const dedupedParts = parts.filter((part) => {
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

    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== tid && s.claudeSessionId !== tid) return s;
        let updated = { ...s };
        if (isInit && realSessionId) {
          sessionIdMapRef.current.set(tid, realSessionId);
          onClaudeSessionIdAssigned?.(tid, realSessionId);
          const preserveWiseTabId = isTerminalWorkerWiseTab(updated);
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
          const hasToolResults = dedupedParts.some(
            (part) =>
              part.type === "tool_use" &&
              (part.status === "completed" ||
                part.status === "error" ||
                Boolean(part.output?.trim()) ||
                Boolean(part.error?.trim())),
          );
          updated = hasToolResults
            ? applyToolResultPartsToSession(updated, dedupedParts)
            : appendAssistantStreamParts(updated, dedupedParts);
          ingestTodosFromSessionMessages(tid, updated.messages);
        }
        return updated;
      }),
    );

    if (isInit && realSessionId) {
      const sessionForTid =
        sessionsRef.current.find((s) => s.id === tid || s.claudeSessionId === tid) ?? null;
      const preserveWiseTabId =
        sessionForTid != null && isTerminalWorkerWiseTab(sessionForTid);
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

  function looksLikeClaudeUuid(s: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
  }

  function clearAssistBufferKeysForTab(session: ClaudeSession | undefined, tid: string) {
    assistantStreamTextByTabRef.current.delete(tid);
    if (session) {
      assistantStreamTextByTabRef.current.delete(session.id);
      const cc = session.claudeSessionId?.trim();
      if (cc) assistantStreamTextByTabRef.current.delete(cc);
    }
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

  function applySessionComplete(tid: string, payload: unknown, turnNonce: number) {
    const session = sessionsRef.current.find((s) => s.id === tid || s.claudeSessionId === tid);
    if (session) {
      const uiBusy = session.status === "running" || session.status === "connecting";
      const awaitingThisTurn = turnNonceStillExpectedForTab(tid, turnNonce);
      // 注册表轮询可能先于 `claude-complete` 把 oneshot 标成 idle；仍须消费本轮完成并补盘 jsonl。
      if (!uiBusy && !awaitingThisTurn) {
        clearAssistBufferKeysForTab(session, tid);
        return;
      }
    }
    const streamingResident = sessionUsesStreamingConnection(session);
    const success = resolveSuccessFromCompletePayload(payload);
    const buf = assistantStreamTextByTabRef.current;
    const chunks = [
      (buf.get(tid) ?? "").trim(),
      session ? (buf.get(session.id) ?? "").trim() : "",
      session?.claudeSessionId?.trim() ? (buf.get(session.claudeSessionId.trim()) ?? "").trim() : "",
    ];
    const fromRef = chunks.reduce((best, cur) => (cur.length > best.length ? cur : best), "");
    const fromMessages = extractLatestAssistantPlainText(session);
    // 流式缓冲与 messages 偶发不同步时，用会话内最后一条助手消息兜底，避免验收解析拿不到正文。
    const previewRaw = (fromRef.length > 0 ? fromRef : fromMessages).trim();
    const noAssistantReply = previewRaw.length === 0;
    clearAssistBufferKeysForTab(session, tid);
    const structuredVerdict = extractStructuredVerdictFromCompletePayload(payload);
    notifyCompletion({ tid, success, nonce: turnNonce, previewRaw, structuredVerdict });
    setSessions((prev) =>
      finalizeSessionAfterComplete({
        sessions: prev,
        targetId: tid,
        success,
        noAssistantReply,
        streamingResident,
      }),
    );
    // 多员工/多会话并行时：仅当「当前仍指向本会话」时才清空，避免误清其它仍在流式中的标签
    const refT = streamingTargetIdRef.current;
    if (
      refT !== null &&
      (refT === tid ||
        (session && (refT === session.id || refT === session.claudeSessionId?.trim())))
    ) {
      streamingTargetIdRef.current = null;
    }

    if (reloadTranscriptFromDisk && success) {
      const skipDiskReload =
        session != null &&
        session.messages.length > 0 &&
        (streamingResident || Boolean(session.diskTranscriptPartial));
      if (!skipDiskReload) {
        const stableTabId = session?.id ?? tid;
        const repo = session?.repositoryPath?.trim() ?? "";
        const tidTrim = tid.trim();
        const ccid =
          session?.claudeSessionId?.trim() ||
          sessionIdMapRef.current.get(stableTabId)?.trim() ||
          sessionIdMapRef.current.get(tidTrim)?.trim() ||
          (looksLikeClaudeUuid(tidTrim) ? tidTrim : "");
        if (repo && ccid) {
          window.setTimeout(() => {
            void reloadTranscriptFromDisk({ tabId: stableTabId, repositoryPath: repo, claudeSessionId: ccid });
          }, 120);
        }
      }
    }
  }

  function handleComplete(payload: unknown) {
    const refTid = streamingTargetIdRef.current;
    if (!refTid) return;
    const mapped = sessionIdMapRef.current.get(refTid) ?? refTid;
    const mapRef = expectedTurnNonceByTabIdRef?.current;
    const nonceForTurn =
      (mapRef?.get(refTid) ?? mapRef?.get(mapped) ?? undefined) ?? lastUserSendNonceRef.current;
    handleCompleteForSendTab(refTid, payload, nonceForTurn);
  }

  function handleCompleteForSendTab(stableTabId: string, payload: unknown, turnNonce: number) {
    const mapped = sessionIdMapRef.current.get(stableTabId) ?? stableTabId;
    let tid = resolveTabIdFromCompletePayload(payload, sessionsRef.current, mapped);
    if (!tid) tid = resolveTabIdFromCompletePayload(payload, sessionsRef.current, stableTabId);
    if (!tid) {
      const session = sessionsRef.current.find((s) => s.id === mapped || s.claudeSessionId === mapped);
      tid = session?.id ?? null;
    }
    if (!tid) return;
    applySessionComplete(tid, payload, turnNonce);
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
    setSessions((prev) => appendSystemMessageBySessionOrClaudeId(prev, tid, `Claude stderr: ${errorMsg}`));
  }

  return {
    handleOutput,
    handleComplete,
    handleError,
    handleOutputForSendTab,
    handleCompleteForSendTab,
    handleErrorForSendTab,
  };
}

