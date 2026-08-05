import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ClaudeComposerExecuteBubbleOptions, ClaudeSession } from "../types";
import { SESSION_EXECUTION_ENGINE_LABELS } from "../constants/sessionExecutionEngine";
import { cancelClaudeExecution, cancelClaudeInvocation, closeStreamingSession } from "../services/claude";
import { buildCursorUserBubblePrompt } from "../services/cursorComposerPrompt";
import { resolveClaudeExecModelId } from "../utils/claudeModel";
import { resolveCodexContextExecutionEngine } from "../utils/codexModel";
import { normalizeClaudeNativeSlashPrompt } from "../utils/composerLocalSlashCommand";
import { isRetryableModelApiError } from "../utils/retryableModelApiError";
import { isCachedModelProfileAutoFailoverEnabled } from "../stores/modelProfileStoreCache";
import { notificationHub } from "../notifications";
import { clearInvocationSnapshotBundle } from "../services/backgroundInvocationSnapshot";
import {
  appendSystemMessageBySessionId,
  applyClaudeExecuteFailureNotice,
  retractLastClaudeTurnFromSession,
  setSessionRunningReplacingFirstUserBubble,
  setSessionRunningReplacingLastUserBubble,
  setSessionRunningReplacingUserBubbleAtIndex,
  setSessionRunningWithUserPrompt,
  beginSessionTurnWithUserPrompt,
} from "../services/claudeSessionState";
import {
  clearTerminalDefaultWorkerTabIfMatch,
  isTerminalWorkerWiseTab,
} from "../services/terminalDispatch";
import { getCachedModelProfileStore } from "../stores/modelProfileStoreCache";
import { beginSessionTurn, endSessionTurn } from "../stores/sessionTurnStore";
import type { CursorSdkAttachment } from "../services/cursorComposerPrompt";
import type { SessionExecutionEngine } from "../types";
import { resolveSessionForExecuteKey } from "../utils/sessionExecuteResolve";
import { markClaudeRegistryBootstrapWarmup, persistWorkflowBindings } from "./useClaudeSessions.helpers";
import {
  deleteStreamingProcessEntry,
  type StreamingProcessActivityEntry,
} from "./useClaudeSessions.streamingReclaim";
import type {
  PendingTurnFailoverContext,
  SessionExecuteOpts,
  UseClaudeSessionsOptions,
} from "./useClaudeSessions.types";

export type SessionActionHandlersDeps = {
  sessionsRef: MutableRefObject<ClaudeSession[]>;
  sessionIdMapRef: MutableRefObject<Map<string, string>>;
  executeSessionRetryCountRef: MutableRefObject<Map<string, number>>;
  recentExecutePromptBySessionRef: MutableRefObject<Map<string, { prompt: string; at: number }>>;
  streamingProcessByTabRef: MutableRefObject<Map<string, { claudeSessionId: string | null }>>;
  streamingProcessActivityByTabRef: MutableRefObject<Map<string, StreamingProcessActivityEntry>>;
  streamingTargetIdRef: MutableRefObject<string | null>;
  streamTurnSeqRef: MutableRefObject<number>;
  lastUserSendNonceRef: MutableRefObject<number>;
  assistantStreamTextByTabRef: MutableRefObject<Map<string, string>>;
  expectedTurnNonceByTabIdRef: MutableRefObject<Map<string, number>>;
  registryBootstrapDeadlineByClaudeSidRef: MutableRefObject<Map<string, number>>;
  claudeInvocationInflightRef: MutableRefObject<
    Map<string, { tabId: string; detach: () => void }>
  >;
  pendingTurnFailoverRef: MutableRefObject<PendingTurnFailoverContext | null>;
  attemptTurnFailoverAndRetryRef: MutableRefObject<
    (ctx: PendingTurnFailoverContext, errorPreview: string) => Promise<boolean>
  >;
  claudeSessionsOptionsRef: MutableRefObject<UseClaudeSessionsOptions | undefined>;
  streamingSessionStreamDetachByTabRef: MutableRefObject<Map<string, () => void>>;
  diskLoadDoneRef: MutableRefObject<Set<string>>;
  diskTailLinesBySessionRef: MutableRefObject<Map<string, number>>;
  workflowRunBySessionRef: MutableRefObject<Map<string, string>>;
  deferredBackgroundCompactRef: MutableRefObject<Map<string, { turnNonce: number; scheduledAtMs: number }>>;
  activeSessionId: string | null;
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  setSessions: (action: SetStateAction<ClaudeSession[]>) => void;
  commitSessions: (updater: (prev: ClaudeSession[]) => ClaudeSession[]) => void;
  clearStreamStallTimer: (tabId: string) => void;
  scheduleStreamStallTimer: (tabId: string) => void;
  resolveSessionExecutionEngine: (session: ClaudeSession) => SessionExecutionEngine;
  runClaudeTurnWithContextGuard: (params: {
    tabSessionId: string;
    turnNonce: number;
    invokeConc:
      | { concurrencyScopeKey: string; concurrencyLimit: number }
      | null
      | undefined;
    repositoryPath: string;
    prompt: string;
    modelArg: string | undefined;
    resumeClaudeSid: string | null;
    forceNewClaudeConversation?: boolean;
    cursorAttachments?: CursorSdkAttachment[];
    codexContextExecutionEngine?: SessionExecutionEngine;
  }) => Promise<void>;
  cancelHostExecutionForTab: (tabSessionId: string, realSessionId: string | null) => Promise<void>;
  detachClaudeInvocationsForSessionKey: (closedId: string) => void;
  purgeStreamSidecarsForSession: (sessionId: string, claudeSessionId?: string | null) => Set<string>;
};

export function createSessionActionHandlers(deps: SessionActionHandlersDeps) {
  const {
    sessionsRef,
    sessionIdMapRef,
    executeSessionRetryCountRef,
    recentExecutePromptBySessionRef,
    streamingProcessByTabRef,
    streamingProcessActivityByTabRef,
    streamingTargetIdRef,
    streamTurnSeqRef,
    lastUserSendNonceRef,
    assistantStreamTextByTabRef,
    expectedTurnNonceByTabIdRef,
    registryBootstrapDeadlineByClaudeSidRef,
    claudeInvocationInflightRef,
    pendingTurnFailoverRef,
    attemptTurnFailoverAndRetryRef,
    claudeSessionsOptionsRef,
    streamingSessionStreamDetachByTabRef,
    diskLoadDoneRef,
    diskTailLinesBySessionRef,
    workflowRunBySessionRef,
    deferredBackgroundCompactRef,
    activeSessionId,
    setActiveSessionId,
    setSessions,
    commitSessions,
    clearStreamStallTimer,
    scheduleStreamStallTimer,
    resolveSessionExecutionEngine,
    runClaudeTurnWithContextGuard,
    cancelHostExecutionForTab,
    detachClaudeInvocationsForSessionKey,
    purgeStreamSidecarsForSession,
  } = deps;

  const executeSession = (
    sessionId: string,
    prompt: string,
    opts?: SessionExecuteOpts,
  ): boolean => {
    const session = resolveSessionForExecuteKey(
      sessionsRef.current,
      sessionId,
      sessionIdMapRef.current,
    );
    const tabSessionId = session?.id ?? sessionId;
    if (!session) {
      const retried = executeSessionRetryCountRef.current.get(sessionId) ?? 0;
      if (retried < 8) {
        executeSessionRetryCountRef.current.set(sessionId, retried + 1);
        window.setTimeout(() => {
          executeSession(sessionId, prompt, opts);
        }, 40);
      } else {
        executeSessionRetryCountRef.current.delete(sessionId);
      }
      return false;
    }
    executeSessionRetryCountRef.current.delete(sessionId);

    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt) {
      // dedup 检查：同 session 同 prompt 900ms 内视为已派发，跳过重复 spawn。
      // 写入已后移到 spawn 门闸通过后（commitSessions 后），避免并发阻塞 / session 未 hydrate
      // / gemini 不支持等「未真正派发」路径污染 dedup 表，致重派时 dedup 假命中 return true
      // 被上层当成功移除而丢任务（C1 修复）。
      const recent = recentExecutePromptBySessionRef.current.get(tabSessionId);
      if (recent && recent.prompt === trimmedPrompt && Date.now() - recent.at < 900) {
        return true;
      }
    }

    const forceFreshClaudeSession = opts?.terminalFreshTurn === true;
    let terminalFreshTeardown: { cancelSessionIds: Set<string>; wasActive: boolean } | null = null;
    if (forceFreshClaudeSession) {
      sessionIdMapRef.current.delete(tabSessionId);
      const staleClaudeSid = session.claudeSessionId?.trim();
      const cancelSessionIds = new Set<string>();
      if (staleClaudeSid) cancelSessionIds.add(staleClaudeSid);
      const wasActive =
        session.status === "running" ||
        session.status === "connecting" ||
        streamingProcessByTabRef.current.has(tabSessionId);
      // 勿 cancelClaudeExecution(tabSessionId)：Rust 会对 Wise tab id 发 success=false complete，误判为本轮失败。
      if (cancelSessionIds.size > 0 || wasActive) {
        terminalFreshTeardown = { cancelSessionIds, wasActive };
        deleteStreamingProcessEntry(
          streamingProcessByTabRef.current,
          streamingProcessActivityByTabRef.current,
          tabSessionId,
        );
      }
    }
    const claudeSidRaw = session.claudeSessionId ?? sessionIdMapRef.current.get(tabSessionId) ?? null;
    const claudeSid = forceFreshClaudeSession ? null : claudeSidRaw;

    const liveSession = sessionsRef.current.find((s) => s.id === tabSessionId) ?? session;
    const engineResolver = claudeSessionsOptionsRef.current?.resolveExecutionEngineRef?.current;
    const executionEngine = engineResolver && liveSession ? engineResolver(liveSession) : "claude";
    const skipClaudeSidBootstrapWait =
      executionEngine === "cursor" ||
      executionEngine === "codex" ||
      executionEngine === "codex-rpc" ||
      executionEngine === "opencode" ||
      executionEngine === "qoder";
    const bubblePrompt = opts?.userBubblePrompt?.trim()
      ? opts.userBubblePrompt
      : opts?.cursorAttachments && opts.cursorAttachments.length > 0
        ? buildCursorUserBubblePrompt(prompt, opts.cursorAttachments)
        : prompt;
    const defaultInstructionApplied = opts?.defaultInstructionApplied?.trim() || undefined;
    const spawnSession = sessionsRef.current.find((s) => s.id === tabSessionId) ?? liveSession;
    const checker = claudeSessionsOptionsRef.current?.beforeSpawnClaudeRef?.current;
    if (checker) {
      const gate = checker(spawnSession);
      if (!gate.ok) {
        claudeSessionsOptionsRef.current?.onClaudeSpawnBlocked?.(gate.message);
        return false;
      }
    }
    if (executionEngine === "gemini") {
      const engineTitle = SESSION_EXECUTION_ENGINE_LABELS[executionEngine].title;
      const geminiNotice = `[系统] ${engineTitle} 主会话派发即将支持，请暂时切换 Claude Code、Codex CLI、OpenCode、Qoder CLI 或 Cursor Agent。`;
      commitSessions((prev) => {
        // task 留队列后，外部 flush 可能重派命中同一 gemini 终态分支：去重避免重复追加系统提示。
        const target = prev.find((s) => s.id === tabSessionId);
        const alreadyNotified = target?.messages?.some(
          (m) =>
            m.role === "system" &&
            typeof m.content === "string" &&
            m.content.includes(engineTitle),
        );
        if (alreadyNotified) return prev;
        return appendSystemMessageBySessionId(prev, tabSessionId, geminiNotice);
      });
      return false;
    }
    // 轮次登记必须先于状态提交，且是同步的：待执行队列在 `onExecute` resolve 后的微任务里
    // 判断能否派发下一条，那时 `session.status` 的重渲染尚未到达。登记之后所有 return false
    // 与失败分支都要 `endSessionTurn(tabSessionId, turnToken)` 注销，否则该会话车道会卡住。
    const turnToken = beginSessionTurn(tabSessionId);
    commitSessions((prev) => {
      if (opts?.replaceUserBubbleAtIndex !== undefined && Number.isFinite(opts.replaceUserBubbleAtIndex)) {
        return setSessionRunningReplacingUserBubbleAtIndex(
          prev,
          tabSessionId,
          opts.replaceUserBubbleAtIndex,
          bubblePrompt,
          defaultInstructionApplied,
        );
      }
      if (opts?.replaceLastUserBubble) {
        return setSessionRunningReplacingLastUserBubble(
          prev,
          tabSessionId,
          bubblePrompt,
          defaultInstructionApplied,
        );
      }
      if (opts?.replaceFirstUserBubble) {
        return setSessionRunningReplacingFirstUserBubble(
          prev,
          tabSessionId,
          bubblePrompt,
          defaultInstructionApplied,
        );
      }
      if (forceFreshClaudeSession) {
        return beginSessionTurnWithUserPrompt(prev, tabSessionId, bubblePrompt, {
          forceFreshClaudeSession: true,
          defaultInstructionApplied,
        });
      }
      return setSessionRunningWithUserPrompt(
        prev,
        tabSessionId,
        bubblePrompt,
        defaultInstructionApplied,
      );
    });
    // 首轮已启动但尚未收到 stream-json 的 session_id 时，避免再 spawn 第二个进程。
    // 用户气泡须在上面的 commit 中先落盘，否则 bootstrap 等待会直接 return 导致「发送了但不见」。
    // 终端派发强制新回合时已主动取消旧进程并重置为 idle，不得在此阻塞。
    // Cursor/Codex oneshot 不使用 Claude session_id，不得在此等待。
    //
    // 重要：此处尚未真正 spawn。不得写入 recentExecutePrompt dedup——否则 80ms 重试会在
    // 900ms 窗内被假命中 return true，用户气泡已落盘却永久不再 spawn（页面监控 / 运行指令
    // 自动修复表现为「消息已发出但没有处理」）。
    if (
      !claudeSid &&
      liveSession.status === "running" &&
      !forceFreshClaudeSession &&
      !skipClaudeSidBootstrapWait
    ) {
      const retried = executeSessionRetryCountRef.current.get(sessionId) ?? 0;
      if (retried < 20) {
        executeSessionRetryCountRef.current.set(sessionId, retried + 1);
        window.setTimeout(() => {
          executeSession(sessionId, prompt, opts);
        }, 80);
      } else {
        executeSessionRetryCountRef.current.delete(sessionId);
        endSessionTurn(tabSessionId, turnToken);
        commitSessions((prev) =>
          appendSystemMessageBySessionId(
            prev.map((s) => (s.id === tabSessionId ? { ...s, status: "error" as const } : s)),
            tabSessionId,
            "会话仍在启动中，请稍后再试或先停止当前执行。",
          ),
        );
        return false;
      }
      // 重试路径：本轮仍在推进（80ms 后重入 executeSession），轮次不注销。
      return true;
    }

    // dedup 写入：已通过 bootstrap 等待，即将进入真正 spawn。
    // 并发阻塞 / gemini / session 未 hydrate 等 return false 路径不会到此，dedup 表不被污染。
    if (trimmedPrompt) {
      recentExecutePromptBySessionRef.current.set(tabSessionId, {
        prompt: trimmedPrompt,
        at: Date.now(),
      });
    }

    streamingTargetIdRef.current = tabSessionId;
    streamTurnSeqRef.current += 1;
    lastUserSendNonceRef.current = streamTurnSeqRef.current;
    assistantStreamTextByTabRef.current.set(tabSessionId, "");

    const spawnEngine = resolveSessionExecutionEngine(spawnSession);
    // OpenCode / Cursor：Composer 只选模型，必须以 session.model 为准。
    // 不可走 resolveClaudeExecModelId（会优先 Claude 档案，覆盖会话选择）。
    const sessionModelTrimmed = spawnSession.model?.trim() || undefined;
    const modelArg =
      spawnEngine === "opencode" ||
      spawnEngine === "cursor" ||
      spawnEngine === "codex" ||
      spawnEngine === "codex-rpc" ||
      spawnEngine === "qoder"
        ? sessionModelTrimmed
        : resolveClaudeExecModelId({
            sessionModel: spawnSession.model,
            store: getCachedModelProfileStore(),
          });

    if (terminalFreshTeardown) {
      expectedTurnNonceByTabIdRef.current.delete(tabSessionId);
      for (const sid of terminalFreshTeardown.cancelSessionIds) {
        expectedTurnNonceByTabIdRef.current.delete(sid);
      }
    } else {
      expectedTurnNonceByTabIdRef.current.set(tabSessionId, lastUserSendNonceRef.current);
    }
    markClaudeRegistryBootstrapWarmup(registryBootstrapDeadlineByClaudeSidRef, claudeSid);
    scheduleStreamStallTimer(tabSessionId);

    const invokeConc =
      claudeSessionsOptionsRef.current?.claudeConcurrencyInvokeContextRef?.current?.(session) ?? null;

    const turnNonce = lastUserSendNonceRef.current;

    const codexContextExecutionEngine = resolveCodexContextExecutionEngine({
      tabSessionId,
      terminalFreshTurn: forceFreshClaudeSession,
      activeSessionId,
      sessions: sessionsRef.current,
      resolveEngine: resolveSessionExecutionEngine,
    });

    pendingTurnFailoverRef.current = {
      tabSessionId,
      turnNonce,
      invokeConc,
      repositoryPath: spawnSession.repositoryPath,
      prompt,
      modelArg,
      resumeClaudeSid: claudeSid,
      forceNewClaudeConversation: forceFreshClaudeSession,
      cursorAttachments: opts?.cursorAttachments,
      codexContextExecutionEngine,
      engine: spawnEngine,
      autoFailoverEnabled: isCachedModelProfileAutoFailoverEnabled(),
      triedProfileIds: [],
    };

    void (async () => {
      try {
        let effectiveTurnNonce = turnNonce;
        if (terminalFreshTeardown) {
          for (const [inv, meta] of [...claudeInvocationInflightRef.current.entries()]) {
            if (meta.tabId !== tabSessionId) continue;
            await cancelClaudeInvocation(inv).catch(() => {});
            meta.detach();
            claudeInvocationInflightRef.current.delete(inv);
          }
          for (const sid of terminalFreshTeardown.cancelSessionIds) {
            await cancelClaudeExecution(sid).catch(() => {});
            expectedTurnNonceByTabIdRef.current.delete(sid);
          }
          streamTurnSeqRef.current += 1;
          effectiveTurnNonce = streamTurnSeqRef.current;
          lastUserSendNonceRef.current = effectiveTurnNonce;
          expectedTurnNonceByTabIdRef.current.set(tabSessionId, effectiveTurnNonce);
          const pendingCtx = pendingTurnFailoverRef.current;
          if (pendingCtx?.tabSessionId === tabSessionId) {
            pendingTurnFailoverRef.current = { ...pendingCtx, turnNonce: effectiveTurnNonce };
          }
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 80);
          });
        }
        await runClaudeTurnWithContextGuard({
          tabSessionId,
          turnNonce: effectiveTurnNonce,
          invokeConc,
          repositoryPath: spawnSession.repositoryPath,
          prompt,
          modelArg,
          resumeClaudeSid: claudeSid,
          forceNewClaudeConversation: forceFreshClaudeSession,
          cursorAttachments: opts?.cursorAttachments,
          codexContextExecutionEngine,
        });
      } catch (err) {
        clearStreamStallTimer(tabSessionId);
        const ctx = pendingTurnFailoverRef.current;
        const errText = err instanceof Error ? err.message : String(err);
        if (
          ctx?.tabSessionId === tabSessionId &&
          ctx.autoFailoverEnabled &&
          isRetryableModelApiError(errText)
        ) {
          try {
            const retried = await attemptTurnFailoverAndRetryRef.current(ctx, errText);
            if (retried) return;
          } catch {
            /* fall through to error UI */
          }
        }
        pendingTurnFailoverRef.current = null;
        if (claudeSid?.trim()) {
          registryBootstrapDeadlineByClaudeSidRef.current.delete(claudeSid.trim());
        }
        // failover 重试已在上面 return，这里是本轮真正失败：立即放行该会话车道，
        // 不必等状态渲染到 error。
        endSessionTurn(tabSessionId, turnToken);
        commitSessions((prev) =>
          applyClaudeExecuteFailureNotice(prev, tabSessionId, err, {
            hasClaudeSessionId: Boolean(claudeSid),
          }),
        );
      }
    })();
    return true;
  };

  const executeTerminalSession = (
    sessionId: string,
    outboundPrompt: string,
    bubbleOpts?: {
      userBubblePrompt?: string;
      defaultInstructionApplied?: string;
    },
  ): boolean =>
    executeSession(sessionId, outboundPrompt, {
      terminalFreshTurn: true,
      userBubblePrompt: bubbleOpts?.userBubblePrompt,
      defaultInstructionApplied: bubbleOpts?.defaultInstructionApplied,
    });

  const sendMessageToSession = (
    sessionId: string,
    prompt: string,
    opts?: ClaudeComposerExecuteBubbleOptions,
  ): Promise<void> => {
    const session = sessionsRef.current.find((s) => s.id === sessionId);
    if (!session) return Promise.resolve();

    const outboundPrompt = normalizeClaudeNativeSlashPrompt(prompt);

    notificationHub.clearTodos(sessionId);
    if (session.claudeSessionId && session.claudeSessionId !== sessionId) {
      notificationHub.clearTodos(session.claudeSessionId);
    }

    const claudeSessionId = session.claudeSessionId ?? sessionIdMapRef.current.get(sessionId) ?? null;

    streamingTargetIdRef.current = sessionId;
    streamTurnSeqRef.current += 1;
    lastUserSendNonceRef.current = streamTurnSeqRef.current;
    assistantStreamTextByTabRef.current.set(sessionId, "");

    const checker = claudeSessionsOptionsRef.current?.beforeSpawnClaudeRef?.current;
    if (checker) {
      const gate = checker(session);
      if (!gate.ok) {
        claudeSessionsOptionsRef.current?.onClaudeSpawnBlocked?.(gate.message);
        return Promise.resolve();
      }
    }

    expectedTurnNonceByTabIdRef.current.set(sessionId, lastUserSendNonceRef.current);
    markClaudeRegistryBootstrapWarmup(registryBootstrapDeadlineByClaudeSidRef, claudeSessionId);
    setSessions((prev) =>
      opts?.replaceUserBubbleAtIndex !== undefined && Number.isFinite(opts.replaceUserBubbleAtIndex)
        ? setSessionRunningReplacingUserBubbleAtIndex(prev, sessionId, opts.replaceUserBubbleAtIndex, prompt)
        : opts?.replaceLastUserBubble
          ? setSessionRunningReplacingLastUserBubble(prev, sessionId, prompt)
          : opts?.replaceFirstUserBubble
            ? setSessionRunningReplacingFirstUserBubble(prev, sessionId, prompt)
            : setSessionRunningWithUserPrompt(prev, sessionId, prompt),
    );

    const invokeConc =
      claudeSessionsOptionsRef.current?.claudeConcurrencyInvokeContextRef?.current?.(session) ?? null;

    const turnNonce = lastUserSendNonceRef.current;
    const modelArg = session.model.trim().length > 0 ? session.model : undefined;

    const codexContextExecutionEngine = resolveCodexContextExecutionEngine({
      tabSessionId: sessionId,
      activeSessionId,
      sessions: sessionsRef.current,
      resolveEngine: resolveSessionExecutionEngine,
    });

    pendingTurnFailoverRef.current = {
      tabSessionId: sessionId,
      turnNonce,
      invokeConc,
      repositoryPath: session.repositoryPath,
      prompt: outboundPrompt,
      modelArg,
      resumeClaudeSid: claudeSessionId,
      codexContextExecutionEngine,
      engine: resolveSessionExecutionEngine(session),
      autoFailoverEnabled: isCachedModelProfileAutoFailoverEnabled(),
      triedProfileIds: [],
    };

    return (async () => {
      try {
        await runClaudeTurnWithContextGuard({
          tabSessionId: sessionId,
          turnNonce,
          invokeConc,
          repositoryPath: session.repositoryPath,
          prompt,
          modelArg,
          resumeClaudeSid: claudeSessionId,
        });
      } catch (err) {
        const ctx = pendingTurnFailoverRef.current;
        const errText = err instanceof Error ? err.message : String(err);
        if (
          ctx?.tabSessionId === sessionId &&
          ctx.autoFailoverEnabled &&
          isRetryableModelApiError(errText)
        ) {
          try {
            const retried = await attemptTurnFailoverAndRetryRef.current(ctx, errText);
            if (retried) return;
          } catch {
            /* fall through */
          }
        }
        pendingTurnFailoverRef.current = null;
        if (claudeSessionId?.trim()) {
          registryBootstrapDeadlineByClaudeSidRef.current.delete(claudeSessionId.trim());
        }
        setSessions((prev) =>
          applyClaudeExecuteFailureNotice(prev, sessionId, err, {
            hasClaudeSessionId: Boolean(claudeSessionId),
          }),
        );
        throw err;
      }
    })();
  };

  const sendMessage = (prompt: string) => {
    if (!activeSessionId) return;
    sendMessageToSession(activeSessionId, prompt);
  };

  const closeSession = (sessionId: string) => {
    const victim = sessionsRef.current.find((s) => s.id === sessionId);
    if (victim && isTerminalWorkerWiseTab(victim)) {
      clearTerminalDefaultWorkerTabIfMatch(sessionId);
    }
    purgeStreamSidecarsForSession(sessionId, victim?.claudeSessionId);
    clearStreamStallTimer(sessionId);
    detachClaudeInvocationsForSessionKey(sessionId);
    // Release persistent Cursor ACP process for this tab.
    void import("../services/cursorAcp")
      .then(({ shutdownCursorAcp }) => shutdownCursorAcp(sessionId))
      .catch(() => {
        /* no active ACP session */
      });
    const victimSid = victim?.claudeSessionId?.trim() ?? sessionIdMapRef.current.get(sessionId)?.trim();
    if (victimSid) {
      void closeStreamingSession(victimSid).catch(() => {
        /* 进程可能已结束 */
      });
    }
    deleteStreamingProcessEntry(
      streamingProcessByTabRef.current,
      streamingProcessActivityByTabRef.current,
      sessionId,
    );
    streamingSessionStreamDetachByTabRef.current.get(sessionId)?.();
    streamingSessionStreamDetachByTabRef.current.delete(sessionId);
    diskLoadDoneRef.current.delete(sessionId);
    diskTailLinesBySessionRef.current.delete(sessionId);
    notificationHub.removeSession(sessionId);
    if (victim?.repositoryPath?.trim()) {
      void clearInvocationSnapshotBundle(sessionId, victim.repositoryPath);
    }
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    setActiveSessionId((prev) => {
      if (prev === sessionId) return null;
      return prev;
    });
    executeSessionRetryCountRef.current.delete(sessionId);
    endSessionTurn(sessionId);
    workflowRunBySessionRef.current.delete(sessionId);
    persistWorkflowBindings(workflowRunBySessionRef.current);
    // 关 tab 时顺手清掉先发后压登记的 deferred，避免孤儿 entry 一直占着 map。
    deferredBackgroundCompactRef.current.delete(sessionId);
  };

  const cancelSession = (sessionId: string, opts?: { retractLastUserTurn?: boolean }) => {
    const session = sessionsRef.current.find((s) => s.id === sessionId);
    const realSessionId = session?.claudeSessionId ?? sessionIdMapRef.current.get(sessionId) ?? null;

    expectedTurnNonceByTabIdRef.current.delete(sessionId);
    if (realSessionId?.trim()) {
      expectedTurnNonceByTabIdRef.current.delete(realSessionId.trim());
    }
    // 取消是确定性终态：同步注销轮次，队列下一次 flush 立刻可派发，
    // 不必等 cancelled 状态渲染出来。
    endSessionTurn(sessionId);
    const refT = streamingTargetIdRef.current;
    if (refT !== null && (refT === sessionId || refT === realSessionId?.trim())) {
      streamingTargetIdRef.current = null;
    }

    void cancelHostExecutionForTab(sessionId, realSessionId);
    void closeStreamingSession(realSessionId ?? sessionId).catch(() => {
      /* 长驻进程可能已退出 */
    });
    deleteStreamingProcessEntry(
      streamingProcessByTabRef.current,
      streamingProcessActivityByTabRef.current,
      sessionId,
    );
    purgeStreamSidecarsForSession(sessionId, session?.claudeSessionId);
    clearStreamStallTimer(sessionId);
    setSessions((prev) => {
      const next = prev.map((s) => {
        if (s.id !== sessionId) return s;
        if (opts?.retractLastUserTurn) {
          return retractLastClaudeTurnFromSession(s);
        }
        return { ...s, status: "cancelled" as const };
      });
      if (opts?.retractLastUserTurn) return next;
      return appendSystemMessageBySessionId(next, sessionId, "执行已取消");
    });
  };

  return {
    executeSession,
    executeTerminalSession,
    sendMessageToSession,
    sendMessage,
    closeSession,
    cancelSession,
  };
}
