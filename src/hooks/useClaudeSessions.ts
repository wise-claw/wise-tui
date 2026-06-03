import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type SetStateAction,
} from "react";
import { message } from "antd";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { safeUnlisten } from "../utils/safeTauriUnlisten";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  ClaudeComposerExecuteBubbleOptions,
  ClaudeDiskSessionItem,
  ClaudeSession,
  QuestionRequest,
  SessionConversationTaskItem,
  SessionExecutionEngine,
} from "../types";
import {
  executeClaudeCode,
  resumeClaudeCode,
  spawnStreamingSession,
  sendStreamingUserMessage,
  closeStreamingSession,
  cancelClaudeExecution,
  cancelClaudeInvocation,
  getClaudeConfigModel,
  submitClaudeStdinLine,
  listRunningClaudeSessions,
} from "../services/claude";
import { executeCodexCode } from "../services/codex";
import { executeCursorCode } from "../services/cursorAgentExecution";
import { buildCursorMcpServersForSpawn } from "../services/cursorMcpConfig";
import {
  buildCursorUserBubblePrompt,
  type CursorSdkAttachment,
} from "../services/cursorComposerPrompt";
import { CURSOR_SDK_DEFAULT_MODEL } from "../constants/cursorSdk";
import { resolveCursorLocalModelId } from "../utils/cursorModel";
import { resolveCodexContextExecutionEngine, resolveCodexExecModelId } from "../utils/codexModel";
import { getCachedModelProfileStore } from "../stores/modelProfileStoreCache";
import { resolveCursorResumeAgentId } from "../utils/cursorAgentId";
import {
  CLAUDE_CONNECTION_KIND_LABELS,
  loadDefaultClaudeConnectionKind,
  applyTabConnectionKindOverride,
  normalizeClaudeConnectionKind,
  resolveSessionConnectionKind,
  sessionUsesStreamingConnection,
  WISE_CLAUDE_CONNECTION_KIND_CHANGED,
  type ClaudeSessionConnectionKind,
} from "../constants/claudeConnection";
import type { ClaudeSpawnCliExtras } from "../services/claudeSpawnExtras";
import { deleteClaudeDiskSession, loadClaudeSessionJsonl } from "../services/claudeDisk";
import { loadCursorSessionJsonl } from "../services/cursorDisk";
import {
  clearInvocationSnapshotBundle,
  collectInvocationSnapshotMemoryKeys,
  pruneInvocationSnapshotMemory,
} from "../services/backgroundInvocationSnapshot";
import { normalizeRepositoryPathKey, repositoryPathsMatch } from "../utils/repositoryMainSessionBinding";
import {
  listClaudeDiskSessionsForRepositoryScope,
  normalizeSessionRepositoryPath,
} from "../utils/sessionHistoryScope";
import { loadSessionTabsState, saveSessionTabsState } from "../services/tabsStore";
import {
  CLAUDE_DISK_JSONL_TAIL_LINES_RELOAD,
  IN_MEMORY_SESSION_MESSAGES_MAX,
  PERSIST_SESSION_MESSAGES_MAX,
} from "../constants/claudeMessageListWindow";
import { runWhenIdle } from "../utils/deferIdle";
import { readVisiblePollIntervalMs } from "../utils/adaptivePoll";
import { wiseNotificationIngest } from "../services/wiseMascot";
import {
  buildQuestionFallbackUserPrompt,
  buildQuestionResumeUserPrompt,
  hasLiveStreamingClaudeProcess,
  isQuestionStdinUnavailableError,
  isToolUseQuestionRequestId,
  shouldDeliverQuestionViaResume,
  shouldUseProxyQuestionResumeDelivery,
} from "../utils/questionControlDelivery";
import {
  buildPermissionStdinLine,
  buildQuestionStdinLine,
  ingestAskUserQuestionFromMessageParts,
  extractLatestTodoWriteFromMessages,
  ingestClaudeStreamLineForHub,
  ingestPendingPermissionsFromSessionMessages,
  notificationHub,
} from "../notifications";
import {
  applySessionsMemoryCap,
  capSessionMessagesForMemory,
  sessionMessagesFromJsonlLines,
} from "../utils/sessionMessagesMemory";
import {
  collectLiveSessionSidecarKeys,
  pruneOrphanClaudeSessionSidecarMaps,
} from "../utils/claudeSessionSidecarMaps";
import {
  resolveCompanionSessionMessagesMax,
  resolveGlobalMessagesBudget,
  resolveCompanionDiskTranscriptTailLines,
  resolveCompanionDiskLoadStaggerMs,
} from "../utils/multiPanePerformance";
import { resolveClaudeCompleteSuccess } from "../utils/resolveClaudeCompleteSuccess";
import { notificationBodyPrefixInRepositoryContext } from "../utils/sessionRepositoryDisplay";
import {
  buildClaudeTurnCompleteNotificationBody,
  shouldIngestWiseNotificationForClaudeTurnComplete,
} from "../utils/claudeTurnNotificationBody";
import { getWorkflowFacade } from "../services/workflow";
import {
  appendSystemMessageBySessionId,
  appendUserMessageBySessionOrClaudeId,
  reconcileSessionStatusesWithRunningRegistry,
  retractLastClaudeTurnFromSession,
  setSessionRunningReplacingFirstUserBubble,
  setSessionRunningReplacingLastUserBubble,
  setSessionRunningReplacingUserBubbleAtIndex,
  setSessionRunningWithUserPrompt,
  beginSessionTurnWithUserPrompt,
} from "../services/claudeSessionState";
import { markSessionToolUseStopped } from "../utils/sessionConversationTasks";
import { isTerminalWorkerWiseTab, sanitizeTerminalWorkerTranscriptMessages } from "../services/terminalDispatch";
import {
  resolveDiskTranscriptSessionKey,
  sessionHasDiskTranscript,
  usesWiseTabIdForDiskTranscript,
} from "../utils/sessionExecutionEngine";
import { createClaudeStreamRuntime } from "../services/claudeStreamRuntime";
import {
  extractPartsFromStreamLine,
  extractSystemErrorMessageFromStreamLine,
  parseStreamLineSessionId,
} from "../services/claudeStreamParser";
import { getAppSetting, setAppSetting } from "../services/appSettingsStore";
import { stopClaudeMainSession } from "../services/stopClaudeMainSession";
import { publishRunningClaudeSessionIds } from "../stores/claudeRunningSessionsRegistryStore";
import { getSystemResourceSnapshot } from "../services/systemResource";
import {
  buildAutoCompactSystemMessage,
  buildContextOverflowRetrySystemMessage,
  CLAUDE_COMPACT_SLASH_PROMPT,
  isCompactSlashPrompt,
  looksLikeContextOverflowError,
  planAutoCompactBeforeSend,
  resolveSessionContextMetricsForSend,
} from "../services/claudeSessionContext";
import {
  applyModelProfileFailover,
  resolveModelProfileEngineForExecution,
} from "../services/modelProfileFailover";
import { isRetryableModelApiError } from "../utils/retryableModelApiError";
import { isCachedModelProfileAutoFailoverEnabled } from "../stores/modelProfileStoreCache";
import {
  applyDiskTranscriptTail as applyDiskTranscriptTailHelper,
  loadMoreTranscriptByKey,
  reloadFullDiskTranscriptByKey,
} from "./useClaudeSessions.transcript";
import { restoreRevertById, sendFollowupById } from "./useClaudeSessions.dock";
import {
  dismissQuestionBySession,
  restorePendingPermissionFromTranscriptBySession,
  restoreTodosFromTranscriptBySession,
} from "./useClaudeSessions.control";
import {
  consumeNextTurnNonce,
  handleProxyStreamingQuestionBranch,
  resolveControlSessionContext,
  submitQuestionViaStdin,
  shouldPreferQuestionStdinControl,
} from "./useClaudeSessions.qa";

import {
  CLAUDE_STREAM_RUNTIME_READY_POLL_MS,
  CLAUDE_STREAM_RUNTIME_READY_WAIT_MS,
  CLAUDE_STREAM_STALL_HOOK_EXTEND_MS,
  CLAUDE_STREAM_STALL_MS,
  CONTROL_REQUEST_EXPIRE_MS,
  CURSOR_STREAM_STALL_MS,
  TRELLIS_CONTEXT_BINDING_STORAGE_KEY,
  WORKFLOW_BINDING_STORAGE_KEY,
  applyStreamingResidentUiStatuses,
  attachClaudeInvocationStream,
  attachClaudeSessionStreamForTurn,
  collectClaudeSessionSidecarIds,
  generateId,
  hydrateStreamingProcessRegistryFromHost,
  isClaudeConversationMissingError,
  markClaudeRegistryBootstrapWarmup,
  mergeRepositoryDiskSessions,
  modelsForRepositoryPaths,
  persistTrellisContextBindings,
  persistWorkflowBindings,
  pruneClaudeRegistryBootstrapWarmup,
  pruneGhostRepositorySessions,
  pruneRepoDiskIndexSessions,
  purgeClaudeSessionStreamSidecarRefs,
  resolveTabIdForClaudeStream,
  resolveTabIdFromCompletePayload,
  sessionHasHookSystemActivity,
  sessionHasVisibleStreamProgress,
  trellisContextIdForTab,
  type ClaudeStreamRuntimeHandlers,
} from "./useClaudeSessions.helpers";
import type {
  PendingTurnFailoverContext,
  SessionExecuteOpts,
  UseClaudeSessionsOptions,
  UseClaudeSessionsReturn,
} from "./useClaudeSessions.types";

export {
  collectClaudeSessionSidecarIds,
  mergeRepositoryDiskSessions,
  pruneGhostRepositorySessions,
  pruneRepoDiskIndexSessions,
  purgeClaudeSessionStreamSidecarRefs,
};
export type { ClaudeTurnCompletePayload } from "./useClaudeSessions.types";

export function useClaudeSessions(options?: UseClaudeSessionsOptions): UseClaudeSessionsReturn {
  const companionSessionIdsJoinKey = options?.companionSessionIds?.join("\0") ?? "";
  const companionSessionIds = useMemo(() => {
    const ids = new Set<string>();
    if (options?.companionSessionIds) {
      for (const id of options.companionSessionIds) {
        if (id) ids.add(id);
      }
    }
    if (options?.companionSessionId) ids.add(options.companionSessionId);
    return Array.from(ids);
  }, [companionSessionIdsJoinKey, options?.companionSessionId]);

  const companionMemoryLimits = useMemo(
    () => ({
      companionMax: resolveCompanionSessionMessagesMax(companionSessionIds.length),
      globalBudget: resolveGlobalMessagesBudget(companionSessionIds.length),
    }),
    [companionSessionIds.length, companionSessionIdsJoinKey],
  );

  const [sessions, setSessionsRaw] = useState<ClaudeSession[]>([]);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const memoryKeepSessionIdsRef = useRef<Set<string>>(new Set());

  const buildMemoryKeepSessionIds = useCallback((list: ClaudeSession[]) => {
    const keep = new Set(memoryKeepSessionIdsRef.current);
    for (const session of list) {
      if (session.status === "running" || session.status === "connecting") {
        keep.add(session.id);
      }
      if (isTerminalWorkerWiseTab(session)) {
        keep.add(session.id);
      }
    }
    return keep;
  }, []);

  const setSessions = useCallback((action: SetStateAction<ClaudeSession[]>) => {
    setSessionsRaw((prev) => {
      const next = typeof action === "function" ? action(prev) : action;
      if (next === prev) return prev;
      const capped = applySessionsMemoryCap(next, {
        keepSessionIds: buildMemoryKeepSessionIds(next),
        globalMessagesBudget: companionMemoryLimits.globalBudget,
      });
      if (capped === prev) return prev;
      sessionsRef.current = capped;
      return capped;
    });
  }, [buildMemoryKeepSessionIds, companionMemoryLimits.globalBudget]);
  /** 流式事件可能在同一帧连发多行；须在 `setSessions` updater 内同步 ref，避免 init 后 assistant 行因 ref 过期被丢弃。 */
  const commitSessions = useCallback((updater: (prev: ClaudeSession[]) => ClaudeSession[]) => {
    setSessions(updater);
  }, [setSessions]);
  const [trellisContextBindingsHydrated, setTrellisContextBindingsHydrated] = useState(false);
  const onClaudeTurnCompleteRef = useRef(options?.onClaudeTurnComplete);
  onClaudeTurnCompleteRef.current = options?.onClaudeTurnComplete;
  const onSessionTabIdMigratedRef = useRef(options?.onSessionTabIdMigrated);
  onSessionTabIdMigratedRef.current = options?.onSessionTabIdMigrated;
  const claudeSessionsOptionsRef = useRef(options);
  claudeSessionsOptionsRef.current = options;
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  useEffect(() => {
    const keep = new Set<string>();
    if (activeSessionId) keep.add(activeSessionId);
    for (const id of companionSessionIds) keep.add(id);
    memoryKeepSessionIdsRef.current = keep;
  }, [activeSessionId, companionSessionIds, companionSessionIdsJoinKey]);

  const [tabsHydrated, setTabsHydrated] = useState(false);
  const workflowRunBySessionRef = useRef<Map<string, string>>(new Map());
  const sessionIdMapRef = useRef<Map<string, string>>(new Map());
  const executeSessionRetryCountRef = useRef<Map<string, number>>(new Map());
  const pendingTurnFailoverRef = useRef<PendingTurnFailoverContext | null>(null);
  const attemptTurnFailoverAndRetryRef = useRef<
    (ctx: PendingTurnFailoverContext, errorPreview: string) => Promise<boolean>
  >(async () => false);
  /** Which session tab receives stdout until `claude-complete` / `claude-error`. */
  const streamingTargetIdRef = useRef<string | null>(null);
  /** 长驻 streaming 子进程：tab id → 已知 Claude session_id（init 前可为 null）。 */
  const streamingProcessByTabRef = useRef<Map<string, { claudeSessionId: string | null }>>(new Map());
  /** 供 `attachClaudeInvocationStream` 使用；挂载后由 stream effect 赋值。 */
  const streamRuntimeRef = useRef<ClaudeStreamRuntimeHandlers | null>(null);
  /** invocation 监听仍占位时登记于此；关标签 / 卸载时反注册，避免泄漏与关页后仍改状态 */
  const claudeInvocationInflightRef = useRef(
    new Map<string, { tabId: string; detach: () => void }>(),
  );
  /** 长驻 streaming：单轮 complete 后仍可能继续收 stdout（AskUserQuestion 续答），按 session_id 重挂监听。 */
  const streamingSessionStreamDetachByTabRef = useRef<Map<string, () => void>>(new Map());
  /** 与每轮 execute / send 对齐，供 claude-complete 与 invocation 路径取 notify nonce。 */
  const streamTurnSeqRef = useRef(0);
  const expectedTurnNonceByTabIdRef = useRef<Map<string, number>>(new Map());
  const trellisContextIdBySessionRef = useRef<Map<string, string>>(new Map());
  const defaultConnectionKindRef = useRef<ClaudeSessionConnectionKind>("oneshot");
  const streamStallTimerByTabRef = useRef<Map<string, number>>(new Map());
  /** 已对「Hook 进行中」放过一次 45s 宽限的标签 */
  const streamStallHookExtendedByTabRef = useRef<Set<string>>(new Set());
  /** 与本轮用户发送绑定，用于 `serverMsgId` 去重（单调递增，避免多会话同时发送撞号）。 */
  const lastUserSendNonceRef = useRef(0);
  /** 按标签会话 id 累积流式助手可见文本（完成时写入通知库），支持多会话并行。 */
  const assistantStreamTextByTabRef = useRef<Map<string, string>>(new Map());
  /** 防重：同一会话短时间内收到完全相同行时直接丢弃（监听重复注册/重复派发兜底）。 */
  const lastStreamLineBySessionRef = useRef<Map<string, { line: string; at: number }>>(new Map());
  /** 防重：同一会话短时间内收到相同长文本片段时丢弃（应对不同事件形态的重复内容）。 */
  const lastStreamTextBySessionRef = useRef<Map<string, { text: string; at: number }>>(new Map());
  /** Claude `session_id` → 在此之前不因「宿主 registry 暂无该 sid」将 running 降级为 idle */
  const registryBootstrapDeadlineByClaudeSidRef = useRef<Map<string, number>>(new Map());
  const diskLoadDoneRef = useRef<Set<string>>(new Set());
  const diskTailLinesBySessionRef = useRef(new Map<string, number>());
  const claudeConfigModelByRepoPathRef = useRef<Map<string, string | null>>(new Map());
  const pruneLiveSessionSidecarsRef = useRef<(liveSessions: readonly ClaudeSession[]) => boolean>(() => false);
  /** Tauri 主窗口是否在前台（与 `document.hidden` 组合判断 Phase 4 桌面摘要）。 */
  const mainWinFocusedRef = useRef(true);
  /** 供 stream runtime `notifyCompletion` 在 AskUserQuestion 等待续答时挂载 session 通道监听。 */
  const prepareStreamingControlResponseListenerRef = useRef<
    (tabSessionId: string, claudeSessionId: string, turnNonce?: number) => Promise<void>
  >(() => Promise.resolve());

  const clearStreamStallTimer = useCallback((tabId: string) => {
    const key = tabId.trim();
    if (!key) return;
    streamStallHookExtendedByTabRef.current.delete(key);
    const existing = streamStallTimerByTabRef.current.get(key);
    if (existing !== undefined) {
      window.clearTimeout(existing);
      streamStallTimerByTabRef.current.delete(key);
    }
    for (const [temp, real] of sessionIdMapRef.current.entries()) {
      if (temp === key || real === key) {
        streamStallHookExtendedByTabRef.current.delete(temp);
        streamStallHookExtendedByTabRef.current.delete(real);
        const t = streamStallTimerByTabRef.current.get(temp) ?? streamStallTimerByTabRef.current.get(real);
        if (t !== undefined) {
          window.clearTimeout(t);
          streamStallTimerByTabRef.current.delete(temp);
          streamStallTimerByTabRef.current.delete(real);
        }
      }
    }
  }, []);

  const scheduleStreamStallTimer = useCallback(
    (tabId: string) => {
      clearStreamStallTimer(tabId);
      const key = tabId.trim();
      if (!key) return;
      const fireStallCheck = () => {
        streamStallTimerByTabRef.current.delete(key);
        const mapped = sessionIdMapRef.current.get(key) ?? key;
        const session = sessionsRef.current.find(
          (s) => s.id === key || s.id === mapped || s.claudeSessionId === mapped,
        );
        if (!session || session.status !== "running") return;
        if (sessionHasVisibleStreamProgress(session)) return;
        const engineResolver = claudeSessionsOptionsRef.current?.resolveExecutionEngineRef?.current;
        const engine: SessionExecutionEngine =
          engineResolver?.(session) ?? "claude";
        if (
          sessionHasHookSystemActivity(session) &&
          !streamStallHookExtendedByTabRef.current.has(key)
        ) {
          streamStallHookExtendedByTabRef.current.add(key);
          const extendTimer = window.setTimeout(fireStallCheck, CLAUDE_STREAM_STALL_HOOK_EXTEND_MS);
          streamStallTimerByTabRef.current.set(key, extendTimer);
          return;
        }
        const stallMessage =
          engine === "cursor"
            ? "Cursor SDK 长时间无可见输出。请点「结束」后重试，或检查 API Key 与网络连接。"
            : engine === "codex"
              ? "Codex 子进程长时间无可见输出。请点「结束」后重试。"
              : "Claude 子进程长时间无可见输出。请点「结束」后重试；若反复出现，可暂时关闭 Cockpit 助手 MCP 或在终端用 stream-json 自检。";
        commitSessions((prev) =>
          appendSystemMessageBySessionId(
            prev.map((s) =>
              s.id === session.id ? { ...s, status: "error" as const } : s,
            ),
            session.id,
            stallMessage,
          ),
        );
      };
      const mapped = sessionIdMapRef.current.get(key) ?? key;
      const session = sessionsRef.current.find(
        (s) => s.id === key || s.id === mapped || s.claudeSessionId === mapped,
      );
      const engineResolver = claudeSessionsOptionsRef.current?.resolveExecutionEngineRef?.current;
      const engine: SessionExecutionEngine =
        session && engineResolver ? engineResolver(session) : "claude";
      const stallMs = engine === "cursor" ? CURSOR_STREAM_STALL_MS : CLAUDE_STREAM_STALL_MS;
      const timer = window.setTimeout(fireStallCheck, stallMs);
      streamStallTimerByTabRef.current.set(key, timer);
    },
    [clearStreamStallTimer, commitSessions],
  );

  const detachClaudeInvocationStreamsForTab = useCallback((tabSessionId: string) => {
    for (const [inv, meta] of [...claudeInvocationInflightRef.current.entries()]) {
      if (meta.tabId === tabSessionId) {
        meta.detach();
        claudeInvocationInflightRef.current.delete(inv);
      }
    }
  }, []);

  const cancelHostExecutionForTab = useCallback(async (tabSessionId: string, realSessionId: string | null) => {
    const cancelIds = new Set<string>([tabSessionId]);
    if (realSessionId?.trim()) {
      cancelIds.add(realSessionId.trim());
    }
    for (const [inv, meta] of [...claudeInvocationInflightRef.current.entries()]) {
      if (meta.tabId !== tabSessionId) continue;
      try {
        await cancelClaudeInvocation(inv);
      } catch (err) {
        console.error("Failed to cancel invocation:", err);
      }
      meta.detach();
      claudeInvocationInflightRef.current.delete(inv);
    }
    for (const sid of cancelIds) {
      try {
        await cancelClaudeExecution(sid);
      } catch (err) {
        console.error("Failed to cancel session host:", err);
      }
    }
  }, []);

  const detachClaudeInvocationsForSessionKey = useCallback((closedId: string) => {
    const victim = sessionsRef.current.find((s) => s.id === closedId);
    const ids = collectClaudeSessionSidecarIds(
      closedId,
      sessionIdMapRef.current,
      victim?.claudeSessionId,
    );
    for (const id of ids) {
      trellisContextIdBySessionRef.current.delete(id);
    }
    persistTrellisContextBindings(trellisContextIdBySessionRef.current);
    for (const [inv, meta] of [...claudeInvocationInflightRef.current.entries()]) {
      if (ids.has(meta.tabId)) {
        meta.detach();
        claudeInvocationInflightRef.current.delete(inv);
      }
    }
  }, []);

  const migrateClaudeInvocationTabId = useCallback((fromTabId: string, toClaudeSessionId: string) => {
    for (const meta of claudeInvocationInflightRef.current.values()) {
      if (meta.tabId === fromTabId) {
        meta.tabId = toClaudeSessionId;
      }
    }
  }, []);

  const resolveTrellisContextId = useCallback((tabSessionId: string, claudeSessionId?: string | null): string => {
    const existing =
      trellisContextIdBySessionRef.current.get(tabSessionId) ??
      (claudeSessionId ? trellisContextIdBySessionRef.current.get(claudeSessionId) : undefined);
    if (existing) {
      return existing;
    }
    const created = trellisContextIdForTab(tabSessionId);
    trellisContextIdBySessionRef.current.set(tabSessionId, created);
    if (claudeSessionId?.trim()) {
      trellisContextIdBySessionRef.current.set(claudeSessionId.trim(), created);
    }
    persistTrellisContextBindings(trellisContextIdBySessionRef.current);
    return created;
  }, []);

  /** 整页刷新 / 离开前释放 invocation 监听（关标签仍走 `closeSession`）。 */
  const detachAllClaudeInvocationStreams = useCallback(() => {
    for (const [, meta] of [...claudeInvocationInflightRef.current.entries()]) {
      meta.detach();
    }
    claudeInvocationInflightRef.current.clear();
  }, []);

  const resolveSessionExecutionEngine = useCallback(
    (session: ClaudeSession): SessionExecutionEngine => {
      const resolver = claudeSessionsOptionsRef.current?.resolveExecutionEngineRef?.current;
      return session && resolver ? resolver(session) : "claude";
    },
    [],
  );

  const loadSessionTranscriptLines = useCallback(
    async (
      session: ClaudeSession,
      diskKey: string,
      tailLines?: number | null,
    ): Promise<string[]> => {
      const rp = session.repositoryPath?.trim();
      if (!rp || !diskKey.trim()) return [];
      if (resolveSessionExecutionEngine(session) === "cursor") {
        return loadCursorSessionJsonl(rp, diskKey, {
          tailLines: tailLines ?? null,
        });
      }
      return loadClaudeSessionJsonl(rp, diskKey, {
        tailLines: tailLines ?? null,
      });
    },
    [resolveSessionExecutionEngine],
  );

  const getCachedClaudeConfigModel = useCallback(async (repositoryPath: string): Promise<string | null> => {
    const path = repositoryPath.trim();
    if (!path) return null;
    const cache = claudeConfigModelByRepoPathRef.current;
    if (cache.has(path)) {
      return cache.get(path) ?? null;
    }
    try {
      const model = (await getClaudeConfigModel(path))?.trim() ?? null;
      cache.set(path, model);
      return model;
    } catch {
      cache.set(path, null);
      return null;
    }
  }, []);

  const resolveSpawnExtrasForTab = useCallback(
    async (tabSessionId: string): Promise<ClaudeSpawnCliExtras | null> => {
      const session = sessionsRef.current.find((s) => s.id === tabSessionId);
      if (!session) return null;
      const resolver = claudeSessionsOptionsRef.current?.claudeSpawnExtrasContextRef?.current;
      if (!resolver) return null;
      return resolver(session);
    },
    [],
  );

  const runClaudeOneshotWithInvocation = useCallback(
    async (params: {
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
    }) => {
      const {
        tabSessionId,
        turnNonce,
        invokeConc,
        repositoryPath,
        prompt,
        modelArg,
        resumeClaudeSid,
      } = params;
      if (!streamRuntimeRef.current) {
        const deadline = Date.now() + CLAUDE_STREAM_RUNTIME_READY_WAIT_MS;
        while (!streamRuntimeRef.current && Date.now() < deadline) {
          await new Promise<void>((r) => {
            window.setTimeout(r, CLAUDE_STREAM_RUNTIME_READY_POLL_MS);
          });
        }
        if (!streamRuntimeRef.current) {
          message.error("流式引擎尚未就绪或初始化超时，请稍后重试发送。");
          throw new Error("Claude stream runtime not ready");
        }
      }
      // 新一轮子进程会替换或清空 stdin 映射；上一轮的 AskUserQuestion / 权限弹窗再提交必败
      notificationHub.invalidateControlRequestsForSession(tabSessionId, "已发起新一轮对话");
      const mappedTab = sessionIdMapRef.current.get(tabSessionId);
      if (mappedTab && mappedTab !== tabSessionId) {
        notificationHub.invalidateControlRequestsForSession(mappedTab, "已发起新一轮对话");
      }
      const rt = streamRuntimeRef.current;
      let detach: (() => void) | null = null;
      const inv = crypto.randomUUID();
      if (rt) {
        try {
          detach = await attachClaudeInvocationStream(
            inv,
            tabSessionId,
            rt,
            turnNonce,
            () => {
              claudeInvocationInflightRef.current.delete(inv);
            },
            (tabId, bound) => expectedTurnNonceByTabIdRef.current.get(tabId) ?? bound,
            (tabId) => {
              if (!streamingProcessByTabRef.current.has(tabId)) return false;
              const session = sessionsRef.current.find((s) => s.id === tabId);
              return Boolean(
                session && sessionUsesStreamingConnection(session, defaultConnectionKindRef.current),
              );
            },
          );
          claudeInvocationInflightRef.current.set(inv, { tabId: tabSessionId, detach });
        } catch {
          detach = null;
        }
      }
      // 仅当 invocation 监听已挂载时才传 key：Rust 会抑制共享 stdout；监听失败时必须不传 key，否则前端收不到流式行。
      const invocationKey = detach ? inv : undefined;
      if (rt && !detach) {
        message.warning("本会话流式监听未建立，已退回全局通道；若多标签同时跑 Claude，输出可能短暂串屏。");
      }
      const sk = invokeConc?.concurrencyScopeKey;
      const lim = invokeConc?.concurrencyLimit;
      const cliExtras = await resolveSpawnExtrasForTab(tabSessionId);
      try {
        if (resumeClaudeSid) {
          try {
            await resumeClaudeCode(
              repositoryPath,
              resumeClaudeSid,
              prompt,
              modelArg,
              invocationKey,
              "oneshot",
              sk,
              lim,
              resolveTrellisContextId(tabSessionId, resumeClaudeSid),
              cliExtras,
            );
          } catch (resumeError) {
            if (!isClaudeConversationMissingError(resumeError)) {
              throw resumeError;
            }
            // Claude 侧会话可能已被清理；自动回退到新会话启动，避免用户手动重发。
            await executeClaudeCode(
              repositoryPath,
              prompt,
              modelArg,
              invocationKey,
              "oneshot",
              sk,
              lim,
              undefined,
              resolveTrellisContextId(tabSessionId),
              cliExtras,
            );
          }
        } else {
          await executeClaudeCode(
            repositoryPath,
            prompt,
            modelArg,
            invocationKey,
            "oneshot",
            sk,
            lim,
            undefined,
            resolveTrellisContextId(tabSessionId),
            cliExtras,
          );
        }
      } catch (e) {
        detach?.();
        throw e;
      }
    },
    [resolveTrellisContextId, resolveSpawnExtrasForTab],
  );

  const runCodexOneshotWithInvocation = useCallback(
    async (params: {
      tabSessionId: string;
      turnNonce: number;
      repositoryPath: string;
      prompt: string;
      modelArg: string | undefined;
      contextExecutionEngine: SessionExecutionEngine;
    }) => {
      const { tabSessionId, turnNonce, repositoryPath, prompt, modelArg, contextExecutionEngine } =
        params;
      if (!streamRuntimeRef.current) {
        const deadline = Date.now() + CLAUDE_STREAM_RUNTIME_READY_WAIT_MS;
        while (!streamRuntimeRef.current && Date.now() < deadline) {
          await new Promise<void>((r) => {
            window.setTimeout(r, CLAUDE_STREAM_RUNTIME_READY_POLL_MS);
          });
        }
        if (!streamRuntimeRef.current) {
          message.error("流式引擎尚未就绪或初始化超时，请稍后重试发送。");
          throw new Error("Claude stream runtime not ready");
        }
      }
      notificationHub.invalidateControlRequestsForSession(tabSessionId, "已发起新一轮对话");
      const rt = streamRuntimeRef.current;
      let detach: (() => void) | null = null;
      const inv = crypto.randomUUID();
      if (rt) {
        try {
          detach = await attachClaudeInvocationStream(
            inv,
            tabSessionId,
            rt,
            turnNonce,
            () => {
              claudeInvocationInflightRef.current.delete(inv);
            },
            (tabId, bound) => expectedTurnNonceByTabIdRef.current.get(tabId) ?? bound,
            (tabId) => {
              if (!streamingProcessByTabRef.current.has(tabId)) return false;
              const session = sessionsRef.current.find((s) => s.id === tabId);
              return Boolean(
                session && sessionUsesStreamingConnection(session, defaultConnectionKindRef.current),
              );
            },
          );
          claudeInvocationInflightRef.current.set(inv, { tabId: tabSessionId, detach });
        } catch {
          detach = null;
        }
      }
      const invocationKey = detach ? inv : undefined;
      const codexModel = resolveCodexExecModelId({
        sessionModel: modelArg,
        contextExecutionEngine,
        store: getCachedModelProfileStore(),
      });
      try {
        await executeCodexCode(
          repositoryPath,
          prompt,
          codexModel,
          invocationKey,
          tabSessionId,
          resolveTrellisContextId(tabSessionId),
        );
      } catch (e) {
        detach?.();
        throw e;
      }
    },
    [resolveTrellisContextId],
  );

  const runCursorOneshotWithInvocation = useCallback(
    async (params: {
      tabSessionId: string;
      turnNonce: number;
      repositoryPath: string;
      prompt: string;
      modelArg: string | undefined;
      cursorAgentId: string | null;
      cursorAttachments?: CursorSdkAttachment[];
    }) => {
      const {
        tabSessionId,
        turnNonce,
        repositoryPath,
        prompt,
        modelArg,
        cursorAgentId,
        cursorAttachments,
      } = params;
      if (!streamRuntimeRef.current) {
        const deadline = Date.now() + CLAUDE_STREAM_RUNTIME_READY_WAIT_MS;
        while (!streamRuntimeRef.current && Date.now() < deadline) {
          await new Promise<void>((r) => {
            window.setTimeout(r, CLAUDE_STREAM_RUNTIME_READY_POLL_MS);
          });
        }
        if (!streamRuntimeRef.current) {
          message.error("流式引擎尚未就绪或初始化超时，请稍后重试发送。");
          throw new Error("Claude stream runtime not ready");
        }
      }
      notificationHub.invalidateControlRequestsForSession(tabSessionId, "已发起新一轮对话");
      commitSessions((prev) =>
        appendSystemMessageBySessionId(prev, tabSessionId, "Cursor SDK 执行中…"),
      );
      const rt = streamRuntimeRef.current;
      let detach: (() => void) | null = null;
      const inv = crypto.randomUUID();
      if (rt) {
        try {
          detach = await attachClaudeInvocationStream(
            inv,
            tabSessionId,
            rt,
            turnNonce,
            () => {
              claudeInvocationInflightRef.current.delete(inv);
            },
            (tabId, bound) => expectedTurnNonceByTabIdRef.current.get(tabId) ?? bound,
            (tabId) => {
              if (!streamingProcessByTabRef.current.has(tabId)) return false;
              const session = sessionsRef.current.find((s) => s.id === tabId);
              return Boolean(
                session && sessionUsesStreamingConnection(session, defaultConnectionKindRef.current),
              );
            },
          );
          claudeInvocationInflightRef.current.set(inv, { tabId: tabSessionId, detach });
        } catch {
          detach = null;
        }
      }
      const invocationKey = detach ? inv : undefined;
      const resolvedModel = resolveCursorLocalModelId(modelArg ?? CURSOR_SDK_DEFAULT_MODEL);
      const spawnExtras = await resolveSpawnExtrasForTab(tabSessionId);
      const mcpServers = await buildCursorMcpServersForSpawn({ spawnExtras });
      try {
        await executeCursorCode(
          repositoryPath,
          prompt,
          resolvedModel,
          invocationKey,
          tabSessionId,
          cursorAgentId ?? undefined,
          resolveTrellisContextId(tabSessionId),
          mcpServers,
          cursorAttachments,
        );
      } catch (e) {
        detach?.();
        throw e;
      }
    },
    [commitSessions, resolveSpawnExtrasForTab, resolveTrellisContextId],
  );

  const runClaudeStreamingWithInvocation = useCallback(
    async (params: {
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
    }) => {
      const {
        tabSessionId,
        turnNonce,
        invokeConc,
        repositoryPath,
        prompt,
        modelArg,
        resumeClaudeSid,
      } = params;

      if (!streamRuntimeRef.current) {
        const deadline = Date.now() + CLAUDE_STREAM_RUNTIME_READY_WAIT_MS;
        while (!streamRuntimeRef.current && Date.now() < deadline) {
          await new Promise<void>((r) => {
            window.setTimeout(r, CLAUDE_STREAM_RUNTIME_READY_POLL_MS);
          });
        }
        if (!streamRuntimeRef.current) {
          message.error("流式引擎尚未就绪或初始化超时，请稍后重试发送。");
          throw new Error("Claude stream runtime not ready");
        }
      }

      notificationHub.invalidateControlRequestsForSession(tabSessionId, "已发起新一轮对话");
      const mappedTab = sessionIdMapRef.current.get(tabSessionId);
      if (mappedTab && mappedTab !== tabSessionId) {
        notificationHub.invalidateControlRequestsForSession(mappedTab, "已发起新一轮对话");
      }

      const liveSid =
        sessionsRef.current.find((s) => s.id === tabSessionId)?.claudeSessionId?.trim() ??
        sessionIdMapRef.current.get(tabSessionId)?.trim() ??
        resumeClaudeSid?.trim() ??
        null;

      const entry = streamingProcessByTabRef.current.get(tabSessionId);
      const isFollowUp = Boolean(
        entry && liveSid && entry.claudeSessionId?.trim() === liveSid,
      );

      if (isFollowUp && liveSid) {
        const rt = streamRuntimeRef.current;
        let detachFollowUp: (() => void) | null = null;
        const followInv = crypto.randomUUID();
        if (rt) {
          try {
            detachFollowUp = await attachClaudeSessionStreamForTurn(
              liveSid,
              tabSessionId,
              rt,
              turnNonce,
              () => {
                claudeInvocationInflightRef.current.delete(followInv);
              },
              (tabId, bound) => expectedTurnNonceByTabIdRef.current.get(tabId) ?? bound,
              (tabId) => {
                if (!streamingProcessByTabRef.current.has(tabId)) return false;
                const session = sessionsRef.current.find((s) => s.id === tabId);
                return Boolean(
                  session && sessionUsesStreamingConnection(session, defaultConnectionKindRef.current),
                );
              },
            );
            claudeInvocationInflightRef.current.set(followInv, {
              tabId: tabSessionId,
              detach: detachFollowUp,
            });
          } catch {
            detachFollowUp = null;
          }
        }
        try {
          await sendStreamingUserMessage(liveSid, prompt);
          return;
        } catch (err) {
          detachFollowUp?.();
          claudeInvocationInflightRef.current.delete(followInv);
          const errText = err instanceof Error ? err.message : String(err);
          const stdinGone =
            errText.includes("没有可写 stdin") || errText.includes("stdin");
          const conversationMissing = isClaudeConversationMissingError(err);
          if (!stdinGone && !conversationMissing) {
            streamingProcessByTabRef.current.delete(tabSessionId);
            throw err;
          }
          // 长驻子进程可能已退出，或 Claude 侧会话已清理（No conversation found）；
          // 回退为新一轮 spawn，避免用户手动重发。
        }
      }

      if (liveSid) {
        await closeStreamingSession(liveSid).catch(() => {
          /* 旧进程可能已退出 */
        });
      }
      streamingProcessByTabRef.current.delete(tabSessionId);

      const rt = streamRuntimeRef.current;
      let detach: (() => void) | null = null;
      const inv = crypto.randomUUID();
      if (rt) {
        try {
          detach = await attachClaudeInvocationStream(
            inv,
            tabSessionId,
            rt,
            turnNonce,
            () => {
              claudeInvocationInflightRef.current.delete(inv);
            },
            (tabId, bound) => expectedTurnNonceByTabIdRef.current.get(tabId) ?? bound,
            (tabId) => {
              if (!streamingProcessByTabRef.current.has(tabId)) return false;
              const session = sessionsRef.current.find((s) => s.id === tabId);
              return Boolean(
                session && sessionUsesStreamingConnection(session, defaultConnectionKindRef.current),
              );
            },
          );
          claudeInvocationInflightRef.current.set(inv, { tabId: tabSessionId, detach });
        } catch {
          detach = null;
        }
      }
      const invocationKey = detach ? inv : undefined;
      if (rt && !detach) {
        message.warning("本会话流式监听未建立，已退回全局通道；若多标签同时跑 Claude，输出可能短暂串屏。");
      }

      const sk = invokeConc?.concurrencyScopeKey;
      const lim = invokeConc?.concurrencyLimit;
      const cliExtras = await resolveSpawnExtrasForTab(tabSessionId);

      try {
        await spawnStreamingSession({
          repositoryPath,
          initialPrompt: prompt,
          model: modelArg,
          sessionIdToResume: liveSid,
          invocationKey,
          concurrencyScopeKey: sk,
          concurrencyLimit: lim,
          trellisContextId: resolveTrellisContextId(tabSessionId, liveSid),
          cliExtras,
        });
        streamingProcessByTabRef.current.set(tabSessionId, {
          claudeSessionId: liveSid,
        });
      } catch (e) {
        detach?.();
        streamingProcessByTabRef.current.delete(tabSessionId);
        throw e;
      }
    },
    [resolveTrellisContextId, resolveSpawnExtrasForTab],
  );

  const invokeClaudeTurn = useCallback(
    async (params: {
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
      cursorAttachments?: CursorSdkAttachment[];
      codexContextExecutionEngine?: SessionExecutionEngine;
    }) => {
      const session = sessionsRef.current.find((s) => s.id === params.tabSessionId);
      const resolver = claudeSessionsOptionsRef.current?.resolveExecutionEngineRef?.current;
      const engine: SessionExecutionEngine =
        session && resolver ? resolver(session) : "claude";
      if (engine === "codex") {
        const contextExecutionEngine =
          params.codexContextExecutionEngine ??
          (session && resolver ? resolver(session) : "claude");
        await runCodexOneshotWithInvocation({
          tabSessionId: params.tabSessionId,
          turnNonce: params.turnNonce,
          repositoryPath: params.repositoryPath,
          prompt: params.prompt,
          modelArg: params.modelArg,
          contextExecutionEngine,
        });
        return;
      }
      if (engine === "cursor") {
        const cursorAgentId = session
          ? resolveCursorResumeAgentId(session, params.tabSessionId, sessionIdMapRef.current)
          : null;
        await runCursorOneshotWithInvocation({
          tabSessionId: params.tabSessionId,
          turnNonce: params.turnNonce,
          repositoryPath: params.repositoryPath,
          prompt: params.prompt,
          modelArg: params.modelArg,
          cursorAgentId,
          cursorAttachments: params.cursorAttachments,
        });
        return;
      }
      if (sessionUsesStreamingConnection(session, defaultConnectionKindRef.current)) {
        await runClaudeStreamingWithInvocation(params);
      } else {
        await runClaudeOneshotWithInvocation(params);
      }
    },
    [runClaudeStreamingWithInvocation, runClaudeOneshotWithInvocation, runCodexOneshotWithInvocation, runCursorOneshotWithInvocation],
  );

  const pruneLiveSessionSidecars = useCallback((liveSessions: readonly ClaudeSession[]) => {
    const liveKeys = collectLiveSessionSidecarKeys(liveSessions);
    let sidecarChanged = pruneOrphanClaudeSessionSidecarMaps(
      {
        sessionIdMap: sessionIdMapRef.current,
        expectedTurnNonceByTabId: expectedTurnNonceByTabIdRef.current,
        assistantStreamTextByTab: assistantStreamTextByTabRef.current,
        lastStreamLineBySession: lastStreamLineBySessionRef.current,
        lastStreamTextBySession: lastStreamTextBySessionRef.current,
        registryBootstrapDeadlineByClaudeSid: registryBootstrapDeadlineByClaudeSidRef.current,
        streamingProcessByTab: streamingProcessByTabRef.current,
        streamingSessionStreamDetachByTab: streamingSessionStreamDetachByTabRef.current,
        diskLoadDone: diskLoadDoneRef.current,
        diskTailLinesBySession: diskTailLinesBySessionRef.current,
        executeSessionRetryCount: executeSessionRetryCountRef.current,
        workflowRunBySession: workflowRunBySessionRef.current,
        trellisContextIdBySession: trellisContextIdBySessionRef.current,
        streamStallHookExtendedByTab: streamStallHookExtendedByTabRef.current,
      },
      liveKeys,
    );
    for (const [inv, meta] of [...claudeInvocationInflightRef.current.entries()]) {
      if (!liveKeys.has(meta.tabId)) {
        meta.detach();
        claudeInvocationInflightRef.current.delete(inv);
        sidecarChanged = true;
      }
    }
    for (const key of [...streamStallTimerByTabRef.current.keys()]) {
      if (!liveKeys.has(key)) {
        clearStreamStallTimer(key);
        sidecarChanged = true;
      }
    }
    notificationHub.pruneOrphanSessions(new Set(liveSessions.map((session) => session.id)));
    pruneInvocationSnapshotMemory(collectInvocationSnapshotMemoryKeys(liveSessions));
    return sidecarChanged;
  }, [clearStreamStallTimer]);
  pruneLiveSessionSidecarsRef.current = pruneLiveSessionSidecars;

  const purgeSessionsMemoryWhenHidden = useCallback(() => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") return;
    lastStreamLineBySessionRef.current.clear();
    lastStreamTextBySessionRef.current.clear();
    const liveRunningKeys = new Set<string>();
    for (const session of sessionsRef.current) {
      if (session.status !== "running" && session.status !== "connecting") continue;
      liveRunningKeys.add(session.id);
      const cc = session.claudeSessionId?.trim();
      if (cc) liveRunningKeys.add(cc);
    }
    for (const key of [...assistantStreamTextByTabRef.current.keys()]) {
      if (!liveRunningKeys.has(key)) {
        assistantStreamTextByTabRef.current.delete(key);
      }
    }
    notificationHub.expireStaleRequests(60 * 60 * 1000);
    pruneLiveSessionSidecarsRef.current(sessionsRef.current);
    setSessions((prev) => {
      const capped = applySessionsMemoryCap(prev, {
        keepSessionIds: buildMemoryKeepSessionIds(prev),
        globalMessagesBudget: Math.max(48, Math.floor(companionMemoryLimits.globalBudget * 0.55)),
        perSessionMax: Math.max(32, Math.floor(IN_MEMORY_SESSION_MESSAGES_MAX * 0.7)),
      });
      return capped === prev ? prev : capped;
    });
  }, [buildMemoryKeepSessionIds, companionMemoryLimits.globalBudget, setSessions]);

  const purgeStreamSidecarsForSession = useCallback((sessionId: string, claudeSessionId?: string | null) => {
    return purgeClaudeSessionStreamSidecarRefs(
      sessionId,
      {
        sessionIdMap: sessionIdMapRef.current,
        expectedTurnNonceByTabId: expectedTurnNonceByTabIdRef.current,
        assistantStreamTextByTab: assistantStreamTextByTabRef.current,
        lastStreamLineBySession: lastStreamLineBySessionRef.current,
        lastStreamTextBySession: lastStreamTextBySessionRef.current,
        registryBootstrapDeadlineByClaudeSid: registryBootstrapDeadlineByClaudeSidRef.current,
      },
      streamingTargetIdRef,
      claudeSessionId,
    );
  }, []);

  const flushBlockingDesktopIfHidden = useCallback(() => {
    if (typeof document === "undefined") return;
    if (!document.hidden && mainWinFocusedRef.current) return;
    for (const s of sessionsRef.current) {
      const slice = notificationHub.getDockSlice(s.id);
      const conv = s.claudeSessionId ?? s.id;
      const prefix = notificationBodyPrefixInRepositoryContext(s.repositoryName ?? "");
      if (slice.permissionRequest) {
        const pr = slice.permissionRequest;
        void wiseNotificationIngest({
          conversationId: conv,
          body: `${prefix}权限待确认: ${pr.tool}`,
          serverMsgId: `hub-pending-perm:${s.id}:${pr.id}`,
        }).catch(() => {
          /* 通知失败不影响 Hub */
        });
      }
      // AskUserQuestion（「下一步怎么做」等）仅驻留 notificationHub，不入库 wise_notification，避免题干/选项落盘。
    }
  }, []);

  useEffect(() => {
    let unlistenHub: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;

    unlistenHub = notificationHub.subscribe(() => {
      if (typeof document !== "undefined" && (document.hidden || !mainWinFocusedRef.current)) {
        flushBlockingDesktopIfHidden();
      }
    });

    const onVisibility = () => {
      if (typeof document !== "undefined" && document.hidden) {
        flushBlockingDesktopIfHidden();
        runWhenIdle(() => {
          purgeSessionsMemoryWhenHidden();
        }, { timeoutMs: 600 });
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    void (async () => {
      try {
        const win = getCurrentWindow();
        mainWinFocusedRef.current = await win.isFocused();
        unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
          mainWinFocusedRef.current = focused;
          if (typeof document !== "undefined" && (document.hidden || !focused)) {
            flushBlockingDesktopIfHidden();
          }
        });
        if (typeof document !== "undefined" && (document.hidden || !mainWinFocusedRef.current)) {
          flushBlockingDesktopIfHidden();
        }
      } catch {
        /* 非 Tauri / 测试环境 */
      }
    })();

    return () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      unlistenHub?.();
      safeUnlisten(unlistenFocus);
    };
  }, [flushBlockingDesktopIfHidden, purgeSessionsMemoryWhenHidden]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPageHide = () => {
      detachAllClaudeInvocationStreams();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [detachAllClaudeInvocationStreams]);

  const reloadTranscriptFromDisk = useCallback(
    async (input: { tabId: string; repositoryPath: string; claudeSessionId: string }) => {
      const rp = input.repositoryPath.trim();
      const tab = input.tabId.trim();
      const cc = input.claudeSessionId.trim();
      if (!rp || !tab) return;
      const s = sessionsRef.current.find((x) => x.id === tab || x.claudeSessionId === cc);
      if (!s) return;
      const engine = resolveSessionExecutionEngine(s);
      const diskKey = resolveDiskTranscriptSessionKey(s, engine);
      if (!diskKey) return;
      try {
        const lines = await loadSessionTranscriptLines(s, diskKey, CLAUDE_DISK_JSONL_TAIL_LINES_RELOAD);
        const { messages, diskTranscriptPartial } = sessionMessagesFromJsonlLines(lines, {
          tailRequestLines: CLAUDE_DISK_JSONL_TAIL_LINES_RELOAD,
        });
        if (messages.length === 0) return;
        setSessions((prev) =>
          prev.map((sess) => {
            const match =
              sess.id === tab || sess.claudeSessionId === cc || sess.id === cc || sess.claudeSessionId === tab;
            if (!match) return sess;
            diskTailLinesBySessionRef.current.set(sess.id, CLAUDE_DISK_JSONL_TAIL_LINES_RELOAD);
            const nextMessages = isTerminalWorkerWiseTab(sess)
              ? sanitizeTerminalWorkerTranscriptMessages(messages)
              : messages;
            const batch = extractLatestTodoWriteFromMessages(nextMessages);
            if (batch) {
              notificationHub.applyTodoWrite(sess.id, batch.items, batch.merge);
            }
            return {
              ...sess,
              messages: nextMessages,
              diskTranscriptPartial,
              transcriptMemoryUnlimited: false,
            };
          }),
        );
      } catch {
        /* 落盘略晚或路径异常时不打断用户 */
      }
    },
    [setSessions],
  );

  const attemptTurnFailoverAndRetry = useCallback(
    async (ctx: PendingTurnFailoverContext, _errorPreview: string): Promise<boolean> => {
      if (!ctx.autoFailoverEnabled) {
        pendingTurnFailoverRef.current = null;
        return false;
      }
      const profileEngine = resolveModelProfileEngineForExecution(ctx.engine);
      if (!profileEngine) {
        pendingTurnFailoverRef.current = null;
        return false;
      }

      const failover = await applyModelProfileFailover(profileEngine, ctx.triedProfileIds);
      if (!failover) {
        pendingTurnFailoverRef.current = null;
        return false;
      }

      ctx.triedProfileIds.push(failover.result.appliedProfileId);
      const nextModel = failover.result.modelId.trim();

      commitSessions((prev) =>
        appendSystemMessageBySessionId(
          prev.map((s) =>
            s.id === ctx.tabSessionId
              ? {
                  ...s,
                  status: "running" as const,
                  ...(nextModel ? { model: nextModel } : {}),
                }
              : s,
          ),
          ctx.tabSessionId,
          failover.systemMessage,
        ),
      );

      scheduleStreamStallTimer(ctx.tabSessionId);
      streamingTargetIdRef.current = ctx.tabSessionId;

      try {
        await invokeClaudeTurn({
          tabSessionId: ctx.tabSessionId,
          turnNonce: ctx.turnNonce,
          invokeConc: ctx.invokeConc,
          repositoryPath: ctx.repositoryPath,
          prompt: ctx.prompt,
          modelArg: nextModel || ctx.modelArg,
          resumeClaudeSid: ctx.forceNewClaudeConversation ? null : ctx.resumeClaudeSid,
          cursorAttachments: ctx.cursorAttachments,
        });
        return true;
      } catch (err) {
        const errText = err instanceof Error ? err.message : String(err);
        if (isRetryableModelApiError(errText)) {
          return attemptTurnFailoverAndRetryRef.current(ctx, errText);
        }
        pendingTurnFailoverRef.current = null;
        throw err;
      }
    },
    [commitSessions, invokeClaudeTurn, scheduleStreamStallTimer],
  );

  useEffect(() => {
    attemptTurnFailoverAndRetryRef.current = attemptTurnFailoverAndRetry;
  }, [attemptTurnFailoverAndRetry]);

  const runClaudeTurnWithContextGuard = useCallback(
    async (params: {
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
      /** 终端强制新回合等场景：不得用标签上残留的 `claudeSessionId` 覆盖显式 null。 */
      forceNewClaudeConversation?: boolean;
      cursorAttachments?: CursorSdkAttachment[];
      codexContextExecutionEngine?: SessionExecutionEngine;
    }) => {
      const { tabSessionId, prompt, repositoryPath: repositoryPathInput, ...invokeRest } = params;
      const session = sessionsRef.current.find((s) => s.id === tabSessionId);
      const pathResolver = claudeSessionsOptionsRef.current?.resolveExecutionRepositoryPathRef?.current;
      const repositoryPath =
        session && pathResolver ? pathResolver(session) : repositoryPathInput;
      if (!session) {
        await invokeClaudeTurn({ ...params, repositoryPath });
        return;
      }

      const resolveClaudeSid = (): string | null => {
        const live = sessionsRef.current.find((s) => s.id === tabSessionId);
        const sid =
          live?.claudeSessionId?.trim() ??
          sessionIdMapRef.current.get(tabSessionId)?.trim() ??
          params.resumeClaudeSid?.trim() ??
          null;
        return sid || null;
      };

      const reloadAfterCompact = async () => {
        const cc = resolveClaudeSid();
        const rp = repositoryPath.trim();
        if (!cc || !rp) return;
        await reloadTranscriptFromDisk({ tabId: tabSessionId, repositoryPath: rp, claudeSessionId: cc });
      };

      const appendSys = (text: string) => {
        setSessions((prev) => appendSystemMessageBySessionId(prev, tabSessionId, text));
      };

      const resolver = claudeSessionsOptionsRef.current?.resolveExecutionEngineRef?.current;
      if (resolver?.(session) === "codex") {
        const contextExecutionEngine =
          params.codexContextExecutionEngine ?? resolver(session);
        await runCodexOneshotWithInvocation({
          tabSessionId,
          turnNonce: params.turnNonce,
          repositoryPath,
          prompt,
          modelArg: params.modelArg,
          contextExecutionEngine,
        });
        return;
      }
      if (resolver?.(session) === "cursor") {
        const storedResume = session.claudeSessionId?.trim() ?? "";
        const cursorAgentId = resolveCursorResumeAgentId(
          session,
          tabSessionId,
          sessionIdMapRef.current,
        );
        if (storedResume && !cursorAgentId) {
          setSessions((prev) =>
            prev.map((s) => (s.id === tabSessionId ? { ...s, claudeSessionId: null } : s)),
          );
          sessionIdMapRef.current.delete(tabSessionId);
        }
        await runCursorOneshotWithInvocation({
          tabSessionId,
          turnNonce: params.turnNonce,
          repositoryPath,
          prompt,
          modelArg: params.modelArg,
          cursorAgentId,
          cursorAttachments: params.cursorAttachments,
        });
        return;
      }

      const runOnce = async (outbound: string) => {
        const cc = params.forceNewClaudeConversation
          ? null
          : (params.resumeClaudeSid ?? resolveClaudeSid());
        await invokeClaudeTurn({
          ...invokeRest,
          tabSessionId,
          repositoryPath,
          prompt: outbound,
          resumeClaudeSid: cc,
          cursorAttachments: params.cursorAttachments,
        });
      };

      const metrics = await resolveSessionContextMetricsForSend(session, loadClaudeSessionJsonl);
      const pre = planAutoCompactBeforeSend(session, prompt, metrics);
      if (pre.needed) {
        appendSys(buildAutoCompactSystemMessage(pre));
        await runOnce(CLAUDE_COMPACT_SLASH_PROMPT);
        await reloadAfterCompact();
      }

      try {
        await runOnce(prompt);
      } catch (err) {
        const errText = err instanceof Error ? err.message : String(err);
        const ctx = pendingTurnFailoverRef.current;
        if (
          ctx &&
          ctx.tabSessionId === tabSessionId &&
          isRetryableModelApiError(errText)
        ) {
          if (!ctx.autoFailoverEnabled) throw err;
          const retried = await attemptTurnFailoverAndRetryRef.current(ctx, errText);
          if (retried) return;
        }
        const canRetry =
          !isCompactSlashPrompt(prompt) &&
          looksLikeContextOverflowError(errText) &&
          Boolean(resolveClaudeSid());
        if (!canRetry) throw err;
        appendSys(buildContextOverflowRetrySystemMessage());
        await runOnce(CLAUDE_COMPACT_SLASH_PROMPT);
        await reloadAfterCompact();
        await runOnce(prompt);
      }
    },
    [invokeClaudeTurn, reloadTranscriptFromDisk, runCodexOneshotWithInvocation, runCursorOneshotWithInvocation],
  );

  const reloadFullDiskTranscript = useCallback(
    async (sessionKey: string) => {
      try {
        await reloadFullDiskTranscriptByKey({
          sessionKey,
          sessions: sessionsRef.current,
          setSessions,
          diskTailLinesBySession: diskTailLinesBySessionRef.current,
          resolveSessionExecutionEngine,
          loadSessionTranscriptLines,
        });
      } catch {
        /* ignore */
      }
    },
    [loadSessionTranscriptLines, resolveSessionExecutionEngine, setSessions],
  );

  const applyDiskTranscriptTail = useCallback(
    async (session: ClaudeSession, tailLines: number) => {
      await applyDiskTranscriptTailHelper({
        session,
        tailLines,
        setSessions,
        diskTailLinesBySession: diskTailLinesBySessionRef.current,
        resolveSessionExecutionEngine,
        loadSessionTranscriptLines,
      });
    },
    [loadSessionTranscriptLines, resolveSessionExecutionEngine, setSessions],
  );

  const loadMoreTranscriptFromDisk = useCallback(
    async (sessionKey: string) => {
      try {
        await loadMoreTranscriptByKey({
          sessionKey,
          sessions: sessionsRef.current,
          diskTailLinesBySession: diskTailLinesBySessionRef.current,
          resolveSessionExecutionEngine,
          reloadFullDiskTranscript,
          applyDiskTranscriptTail,
        });
      } catch {
        /* ignore */
      }
    },
    [applyDiskTranscriptTail, reloadFullDiskTranscript, resolveSessionExecutionEngine],
  );

  useEffect(() => {
    let cancelled = false;
    void loadDefaultClaudeConnectionKind().then((kind) => {
      if (!cancelled) defaultConnectionKindRef.current = kind;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKindChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: ClaudeSessionConnectionKind }>).detail;
      if (detail?.kind === "streaming" || detail?.kind === "oneshot") {
        defaultConnectionKindRef.current = detail.kind;
      }
    };
    window.addEventListener(WISE_CLAUDE_CONNECTION_KIND_CHANGED, onKindChanged);
    return () => window.removeEventListener(WISE_CLAUDE_CONNECTION_KIND_CHANGED, onKindChanged);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const raw = await getAppSetting(WORKFLOW_BINDING_STORAGE_KEY);
      if (cancelled) return;
      if (!raw) {
        workflowRunBySessionRef.current = new Map();
        return;
      }
      try {
        const parsed = JSON.parse(raw) as Record<string, string>;
        workflowRunBySessionRef.current = new Map(Object.entries(parsed));
      } catch {
        workflowRunBySessionRef.current = new Map();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const raw = await getAppSetting(TRELLIS_CONTEXT_BINDING_STORAGE_KEY);
      if (cancelled) return;
      if (!raw) {
        trellisContextIdBySessionRef.current = new Map();
        return;
      }
      try {
        const parsed = JSON.parse(raw) as Record<string, string>;
        trellisContextIdBySessionRef.current = new Map(
          Object.entries(parsed).filter((entry): entry is [string, string] => {
            const [sessionId, contextId] = entry;
            return (
              typeof sessionId === "string" &&
              sessionId.trim().length > 0 &&
              typeof contextId === "string" &&
              contextId.trim().length > 0
            );
          }),
        );
      } catch {
        trellisContextIdBySessionRef.current = new Map();
      }
    })().finally(() => {
      if (!cancelled) {
        setTrellisContextBindingsHydrated(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!trellisContextBindingsHydrated) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await loadSessionTabsState();
        if (cancelled) return;
        if (data?.sessions && data.sessions.length > 0) {
          const globalDefault = await loadDefaultClaudeConnectionKind();
          if (!cancelled) defaultConnectionKindRef.current = globalDefault;

          const stripLegacyOverrides = !(await getAppSetting(
            "wise.defaultConfig.stripTabConnectionOverrides.v1",
          ))?.trim();

          const normalized = data.sessions.map((s) => {
            const base = {
              ...s,
              repositoryPath: normalizeSessionRepositoryPath(s.repositoryPath),
              status:
                s.status === "running" || s.status === "connecting" ? ("idle" as const) : s.status,
            };
            if (stripLegacyOverrides && base.connectionKind !== undefined) {
              const { connectionKind: _omit, ...rest } = base;
              return rest;
            }
            if (base.connectionKind === globalDefault) {
              const { connectionKind: _omit, ...rest } = base;
              return rest;
            }
            return base;
          });

          if (stripLegacyOverrides) {
            await setAppSetting("wise.defaultConfig.stripTabConnectionOverrides.v1", "1");
          }

          const modelByPath = await modelsForRepositoryPaths(normalized.map((s) => s.repositoryPath));
          const normalizedWithModels = normalized.map((s) => {
            const cfg = modelByPath.get(s.repositoryPath);
            const withModel = cfg ? { ...s, model: cfg } : s;
            return {
              ...withModel,
              messages: capSessionMessagesForMemory(withModel.messages, PERSIST_SESSION_MESSAGES_MAX),
              diskTranscriptPartial:
                withModel.diskTranscriptPartial ||
                withModel.messages.length > PERSIST_SESSION_MESSAGES_MAX,
            };
          });
          let trellisContextChanged = false;
          const allowedTrellisSessionIds = new Set<string>();
          for (const s of normalizedWithModels) {
            allowedTrellisSessionIds.add(s.id);
            if (s.claudeSessionId?.trim()) {
              allowedTrellisSessionIds.add(s.claudeSessionId.trim());
            }
          }
          for (const key of [...trellisContextIdBySessionRef.current.keys()]) {
            if (!allowedTrellisSessionIds.has(key)) {
              trellisContextIdBySessionRef.current.delete(key);
              trellisContextChanged = true;
            }
          }
          for (const s of normalizedWithModels) {
            const contextId =
              trellisContextIdBySessionRef.current.get(s.id) ??
              (s.claudeSessionId ? trellisContextIdBySessionRef.current.get(s.claudeSessionId) : undefined) ??
              trellisContextIdForTab(s.id);
            if (trellisContextIdBySessionRef.current.get(s.id) !== contextId) {
              trellisContextIdBySessionRef.current.set(s.id, contextId);
              trellisContextChanged = true;
            }
            if (s.claudeSessionId?.trim() && trellisContextIdBySessionRef.current.get(s.claudeSessionId.trim()) !== contextId) {
              trellisContextIdBySessionRef.current.set(s.claudeSessionId.trim(), contextId);
              trellisContextChanged = true;
            }
            if (s.claudeSessionId && s.messages.length > 0) {
              diskLoadDoneRef.current.add(s.id);
            }
          }
          if (trellisContextChanged) {
            persistTrellisContextBindings(trellisContextIdBySessionRef.current);
          }
          const active =
            data.activeSessionId && normalizedWithModels.some((x) => x.id === data.activeSessionId)
              ? data.activeSessionId
              : normalizedWithModels[0]!.id;
          setSessions(normalizedWithModels);
          setActiveSessionId(active);
        }
      } finally {
        if (!cancelled) setTabsHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trellisContextBindingsHydrated]);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    const attach = async (event: string, handler: (payload: unknown) => void) => {
      if (cancelled) return;
      const u = await listen(event, (e) => {
        handler(e.payload);
      });
      // React StrictMode 下 effect 可能先 cleanup 再拿到 listen 结果；
      // 这里兜底立即反注册，避免同一事件被重复消费。
      if (cancelled) {
        safeUnlisten(u);
        return;
      }
      unlisteners.push(u);
    };

    const resolveTabIdForStream = (
      list: ClaudeSession[],
      lineSid: string | null,
      refTid: string | null,
    ) => resolveTabIdForClaudeStream(list, lineSid, refTid, sessionIdMapRef.current);

    const resolveCompleteTabIdForStream = (
      payload: unknown,
      list: ClaudeSession[],
      refTid: string | null,
    ) => resolveTabIdFromCompletePayload(payload, list, refTid, sessionIdMapRef.current);

    const runtime = createClaudeStreamRuntime({
      sessionsRef,
      streamingTargetIdRef,
      sessionIdMapRef,
      lastStreamLineBySessionRef,
      lastStreamTextBySessionRef,
      lastUserSendNonceRef,
      assistantStreamTextByTabRef,
      setSessions: commitSessions,
      setActiveSessionId,
      ingestClaudeStreamLineForHub,
      ingestAskUserQuestionFromMessageParts,
      ingestStreamAssistText: (sessionId, text) => notificationHub.ingestStreamAssistText(sessionId, text),
      ingestTodosFromSessionMessages: (sessionId, messages) => {
        const batch = extractLatestTodoWriteFromMessages(messages);
        if (batch) {
          notificationHub.applyTodoWrite(sessionId, batch.items, batch.merge);
        }
        ingestPendingPermissionsFromSessionMessages(sessionId, messages);
      },
      finalizeTodosAfterSuccessfulTurn: (sessionId, messages) => {
        const batch = extractLatestTodoWriteFromMessages(messages);
        if (batch) {
          notificationHub.applyTodoWrite(sessionId, batch.items, batch.merge);
        }
        notificationHub.completeRemainingTodos(sessionId);
      },
      migrateSessionKey: (from, to) => notificationHub.migrateSessionKey(from, to),
      notifyCompletion: ({ tid, success, nonce, previewRaw, structuredVerdict }) => {
        clearStreamStallTimer(tid);
        const session = sessionsRef.current.find((s) => s.id === tid || s.claudeSessionId === tid);
        const tabSessionId = session?.id ?? tid;
        const ctx = pendingTurnFailoverRef.current;
        if (ctx && ctx.tabSessionId === tabSessionId && ctx.turnNonce === nonce) {
          if (success) {
            pendingTurnFailoverRef.current = null;
          } else if (isRetryableModelApiError(previewRaw) && ctx.autoFailoverEnabled) {
            void (async () => {
              try {
                await attemptTurnFailoverAndRetryRef.current(ctx, previewRaw);
              } catch (err) {
                pendingTurnFailoverRef.current = null;
                commitSessions((prev) =>
                  appendSystemMessageBySessionId(
                    prev.map((s) =>
                      s.id === tabSessionId ? { ...s, status: "error" as const } : s,
                    ),
                    tabSessionId,
                    `发送失败: ${err instanceof Error ? err.message : String(err)}`,
                  ),
                );
              }
            })();
            return;
          } else {
            pendingTurnFailoverRef.current = null;
          }
        }
        // 勿在单轮 complete 时清空 Dock：子进程若先于 UI 帧结束，会擦掉刚写入的 AskUserQuestion，导致弹窗永远不出现。
        notificationHub.invalidateControlRequestsForSession(tabSessionId, "进程已结束", "expire_keep_visible");
        if (session?.claudeSessionId && session.claudeSessionId !== tabSessionId) {
          notificationHub.invalidateControlRequestsForSession(
            session.claudeSessionId,
            "进程已结束",
            "expire_keep_visible",
          );
        }
        queueMicrotask(() => {
          onClaudeTurnCompleteRef.current?.({
            sessionId: tabSessionId,
            success,
            assistantPreviewRaw: previewRaw,
            structuredVerdict,
          });
        });
        const claudeSid = session?.claudeSessionId?.trim();
        if (
          claudeSid &&
          session &&
          sessionUsesStreamingConnection(session, defaultConnectionKindRef.current) &&
          streamingProcessByTabRef.current.has(tabSessionId)
        ) {
          queueMicrotask(() => {
            const pendingQuestion = notificationHub.getDockSlice(tabSessionId).questionRequest;
            if (!pendingQuestion) return;
            void prepareStreamingControlResponseListenerRef.current(tabSessionId, claudeSid);
          });
        }
        if (nonce <= 0) return;
        if (!shouldIngestWiseNotificationForClaudeTurnComplete(session ?? null)) {
          return;
        }
        const mappedCanonical = sessionIdMapRef.current.get(tid) ?? null;
        const conversationId =
          session?.claudeSessionId ?? mappedCanonical ?? session?.id ?? tid;
        const prefix = notificationBodyPrefixInRepositoryContext(session?.repositoryName ?? "");
        if (!success) {
          void wiseNotificationIngest({
            conversationId,
            body: buildClaudeTurnCompleteNotificationBody({
              prefix,
              success: false,
              previewRaw: previewRaw.trim(),
              session: session ?? null,
            }),
            serverMsgId: `complete-err-${nonce}`,
          }).catch(() => {
            /* 通知失败不影响会话 UI */
          });
          return;
        }
        const trimmed = previewRaw.trim();
        void wiseNotificationIngest({
          conversationId,
          body: buildClaudeTurnCompleteNotificationBody({
            prefix,
            success: true,
            previewRaw: trimmed,
            session: session ?? null,
          }),
          serverMsgId: `complete-${nonce}`,
        }).catch(() => {
          /* 通知失败不影响会话 UI */
        });
      },
      parseStreamLineSessionId,
      resolveTabIdForClaudeStream: resolveTabIdForStream,
      resolveTabIdFromCompletePayload: resolveCompleteTabIdForStream,
      resolveSuccessFromCompletePayload: resolveClaudeCompleteSuccess,
      extractSystemErrorMessageFromStreamLine,
      extractPartsFromStreamLine,
      onClaudeSessionIdAssigned: (tabId, claudeSessionId) => {
        markClaudeRegistryBootstrapWarmup(registryBootstrapDeadlineByClaudeSidRef, claudeSessionId);
        if (streamingProcessByTabRef.current.has(tabId)) {
          streamingProcessByTabRef.current.set(tabId, { claudeSessionId });
        }
      },
      onSessionTabIdMigrated: (fromTabId, toClaudeSessionId) => {
        markClaudeRegistryBootstrapWarmup(registryBootstrapDeadlineByClaudeSidRef, toClaudeSessionId);
        const nonceMap = expectedTurnNonceByTabIdRef.current;
        const pendingNonce = nonceMap.get(fromTabId);
        if (pendingNonce !== undefined) {
          nonceMap.delete(fromTabId);
          nonceMap.set(toClaudeSessionId, pendingNonce);
        }
        const trellisContextId =
          trellisContextIdBySessionRef.current.get(fromTabId) ?? trellisContextIdForTab(fromTabId);
        trellisContextIdBySessionRef.current.set(fromTabId, trellisContextId);
        trellisContextIdBySessionRef.current.set(toClaudeSessionId, trellisContextId);
        persistTrellisContextBindings(trellisContextIdBySessionRef.current);
        migrateClaudeInvocationTabId(fromTabId, toClaudeSessionId);
        const streamingEntry = streamingProcessByTabRef.current.get(fromTabId);
        if (streamingEntry) {
          streamingProcessByTabRef.current.set(fromTabId, {
            claudeSessionId: toClaudeSessionId,
          });
        }
        onSessionTabIdMigratedRef.current?.(fromTabId, toClaudeSessionId);
      },
      reloadTranscriptFromDisk,
      expectedTurnNonceByTabIdRef,
      onStreamActivity: (tabId) => scheduleStreamStallTimer(tabId),
    });

    void (async () => {
      await attach("claude-output", runtime.handleOutput);
      await attach("claude-complete", runtime.handleComplete);
      await attach("claude-error", runtime.handleError);
      if (cancelled) return;
      // 须在全局 listen 就绪后再暴露 runtime，否则首包 invoke 可能无人消费 `claude-output` / complete。
      streamRuntimeRef.current = runtime;
    })();

    return () => {
      cancelled = true;
      streamRuntimeRef.current = null;
      runtime.dispose();
      // 勿在此处 detach invocation：React StrictMode 会先卸载再挂载，会误断用户进行中的流式。
      // invocation 监听由 `closeSession` 与单轮 `onCleaned` 释放。
      unlisteners.forEach((u) => safeUnlisten(u));
    };
  }, [
    clearStreamStallTimer,
    commitSessions,
    migrateClaudeInvocationTabId,
    reloadTranscriptFromDisk,
    scheduleStreamStallTimer,
  ]);

  const refreshDiskSessionsForRepository = useCallback(async (repositoryPath: string, repositoryName: string) => {
    const trimmedPath = repositoryPath.trim();
    if (!trimmedPath) return;
    let disk: ClaudeDiskSessionItem[];
    let mergePath = normalizeSessionRepositoryPath(trimmedPath);
    try {
      const listed = await listClaudeDiskSessionsForRepositoryScope(trimmedPath, sessionsRef.current);
      disk = listed.disk;
      mergePath = listed.listingPath;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      message.warning(`读取 Claude 历史会话失败：${msg}`);
      return;
    }
    // 先合并磁盘标签，避免再等 getClaudeConfigModel 才 setSessions（多仓库并发刷新时易卡顿）。
    setSessions((prev) => {
      const next = mergeRepositoryDiskSessions(prev, mergePath, repositoryName, disk, "sonnet");
      sessionsRef.current = next;
      return next;
    });

    void (async () => {
      const resolved = await getCachedClaudeConfigModel(mergePath);
      if (!resolved || resolved === "sonnet") return;

      const idsNeedingConfigModel = new Set(
        disk.filter((d) => !d.modelHint?.trim()).map((d) => d.sessionId),
      );
      if (idsNeedingConfigModel.size === 0) return;

      setSessions((prev) => {
        const next = prev.map((s) => {
          if (!repositoryPathsMatch(s.repositoryPath, mergePath)) return s;
          const sid = s.claudeSessionId ?? s.id;
          if (!idsNeedingConfigModel.has(s.id) && !idsNeedingConfigModel.has(sid)) return s;
          return { ...s, model: resolved };
        });
        sessionsRef.current = next;
        return next;
      });
    })();
  }, [getCachedClaudeConfigModel]);

  useEffect(() => {
    if (!activeSessionId) return;
    const s = sessionsRef.current.find((x) => x.id === activeSessionId);
    if (!s || s.messages.length > 0) return;
    const engine = resolveSessionExecutionEngine(s);
    const hasDisk = sessionHasDiskTranscript(s, engine);
    if (!hasDisk) return;
    if (s.status === "running" || s.status === "connecting") return;
    if (diskLoadDoneRef.current.has(s.id)) return;
    diskLoadDoneRef.current.add(s.id);
    const loadKey = s.id;
    const snapshot = s;

    let cancelled = false;
    const cancelIdle = runWhenIdle(() => {
      if (cancelled) return;
      void reloadFullDiskTranscript(snapshot.id).catch(() => {
        diskLoadDoneRef.current.delete(loadKey);
      });
    }, { timeoutMs: 900 });

    return () => {
      cancelled = true;
      cancelIdle();
      diskLoadDoneRef.current.delete(loadKey);
    };
  }, [activeSessionId, reloadFullDiskTranscript, resolveSessionExecutionEngine]);

  useEffect(() => {
    if (companionSessionIds.length === 0) return;
    let cancelled = false;
    const idleCleanups: Array<() => void> = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const companionDiskTailLines = resolveCompanionDiskTranscriptTailLines(companionSessionIds.length);

    for (const [index, cid] of companionSessionIds.entries()) {
      const timer = setTimeout(() => {
        if (cancelled) return;
        const s = sessionsRef.current.find((x) => x.id === cid);
        if (!s || s.messages.length > 0) return;
        const engine = resolveSessionExecutionEngine(s);
        const hasDisk = sessionHasDiskTranscript(s, engine);
        if (!hasDisk) return;
        if (s.status === "running" || s.status === "connecting") return;
        if (diskLoadDoneRef.current.has(s.id)) return;
        diskLoadDoneRef.current.add(s.id);
        const loadKey = s.id;
        const snapshot = s;
        idleCleanups.push(
          runWhenIdle(() => {
            if (cancelled) return;
            void applyDiskTranscriptTail(snapshot, companionDiskTailLines).catch(() => {
              diskLoadDoneRef.current.delete(loadKey);
            });
          }, { timeoutMs: 3000 }),
        );
      }, resolveCompanionDiskLoadStaggerMs(index));
      timers.push(timer);
    }

    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
      for (const cleanup of idleCleanups) cleanup();
    };
  }, [companionSessionIdsJoinKey, applyDiskTranscriptTail, companionSessionIds, resolveSessionExecutionEngine]);

  /** 非活动/非多屏伴生标签：丢弃正文，仅保留元数据；切回时再从磁盘懒加载（running 与无磁盘 id 的纯本地草稿保留） */
  useEffect(() => {
    if (!tabsHydrated) return;
    const keep = new Set<string>();
    if (activeSessionId) keep.add(activeSessionId);
    for (const cid of companionSessionIds) keep.add(cid);
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (keep.has(s.id)) {
          if (s.transcriptMemoryUnlimited) return s;
          const perSessionMax =
            s.id === activeSessionId
              ? IN_MEMORY_SESSION_MESSAGES_MAX
              : companionMemoryLimits.companionMax;
          if (s.messages.length <= perSessionMax) return s;
          changed = true;
          return {
            ...s,
            messages: capSessionMessagesForMemory(s.messages, perSessionMax),
            diskTranscriptPartial: true,
            transcriptMemoryUnlimited: false,
          };
        }
        if (isTerminalWorkerWiseTab(s)) return s;
        if (s.status === "running" || s.status === "connecting") {
          if (s.messages.length <= IN_MEMORY_SESSION_MESSAGES_MAX) return s;
          changed = true;
          return {
            ...s,
            messages: capSessionMessagesForMemory(s.messages),
            diskTranscriptPartial: true,
          };
        }
        const hasDisk = sessionHasDiskTranscript(s, resolveSessionExecutionEngine(s));
        if (!hasDisk && s.messages.length > 0) return s;
        if (s.messages.length === 0) return s;
        changed = true;
        return { ...s, messages: [], diskTranscriptPartial: false, transcriptMemoryUnlimited: false };
      });
      return changed ? next : prev;
    });
  }, [companionMemoryLimits.companionMax, tabsHydrated, activeSessionId, companionSessionIdsJoinKey]);

  /** 周期性收紧全局消息预算（避免流式/多标签在 cap 之外缓慢涨内存） */
  useEffect(() => {
    if (!tabsHydrated) return;
    let cancelIdle: (() => void) | null = null;
    const timer = window.setInterval(() => {
      const hidden = typeof document !== "undefined" && document.visibilityState !== "visible";
      if (cancelIdle) cancelIdle();
      cancelIdle = runWhenIdle(() => {
        pruneLiveSessionSidecars(sessionsRef.current);
        setSessions((prev) => {
          const capped = applySessionsMemoryCap(prev, {
            keepSessionIds: buildMemoryKeepSessionIds(prev),
            globalMessagesBudget: companionMemoryLimits.globalBudget,
            ...(hidden
              ? {
                  globalMessagesBudget: Math.max(
                    48,
                    Math.floor(companionMemoryLimits.globalBudget * 0.6),
                  ),
                  perSessionMax: Math.max(32, Math.floor(IN_MEMORY_SESSION_MESSAGES_MAX * 0.75)),
                }
              : {}),
          });
          return capped === prev ? prev : capped;
        });
      }, { timeoutMs: hidden ? 1200 : 4000 });
    }, readVisiblePollIntervalMs(45_000, 60_000));
    return () => {
      window.clearInterval(timer);
      if (cancelIdle) cancelIdle();
    };
  }, [buildMemoryKeepSessionIds, companionMemoryLimits.globalBudget, pruneLiveSessionSidecars, setSessions, tabsHydrated]);

  /** 主会话 / 员工 / 团队等全部标签：定期与 Claude Code 宿主注册表对齐执行态（不限于当前活动标签）。 */
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let cancelIdle: (() => void) | null = null;
    const registryPollTickRef = { value: 0 };

    const scheduleTimer = () => {
      if (timer != null) window.clearInterval(timer);
      timer = window.setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
        void tick();
      }, readVisiblePollIntervalMs(8000, 20000));
    };

    const tick = async () => {
      try {
        registryPollTickRef.value += 1;
        const includeHostSnapshot = registryPollTickRef.value % 5 === 1;
        const listPromise = listRunningClaudeSessions();
        const snapshotPromise = includeHostSnapshot ? getSystemResourceSnapshot() : Promise.resolve(null);
        const [listResult, snapshotResult] = await Promise.allSettled([listPromise, snapshotPromise]);
        if (cancelled) return;
        if (listResult.status !== "fulfilled") return;
        const list = listResult.value;
        const claudeProcesses =
          snapshotResult.status === "fulfilled" && snapshotResult.value
            ? snapshotResult.value.claudeProcesses ?? []
            : [];
        if (includeHostSnapshot) {
          hydrateStreamingProcessRegistryFromHost(
            sessionsRef.current,
            claudeProcesses,
            streamingProcessByTabRef.current,
            defaultConnectionKindRef.current,
          );
        }
        const knownIds = new Set(
          list.map((item) => item.session_id.trim()).filter((id) => id.length > 0),
        );
        const runningIds = new Set(
          list
            .filter((item) => item.status === "running")
            .map((item) => item.session_id.trim())
            .filter((id) => id.length > 0),
        );
        publishRunningClaudeSessionIds(runningIds);
        pruneClaudeRegistryBootstrapWarmup(registryBootstrapDeadlineByClaudeSidRef, runningIds);
        setSessions((prev) => {
          const reconciled = reconcileSessionStatusesWithRunningRegistry(
            prev,
            runningIds,
            registryBootstrapDeadlineByClaudeSidRef.current,
            knownIds,
          );
          const next = includeHostSnapshot
            ? applyStreamingResidentUiStatuses(
                reconciled,
                streamingProcessByTabRef.current,
                defaultConnectionKindRef.current,
              )
            : reconciled;
          return next === prev ? prev : next;
        });
      } catch {
        /* 与流式事件并存：拉取失败则保持当前 UI */
      }
    };

    const runTick = () => {
      if (cancelIdle) cancelIdle();
      cancelIdle = runWhenIdle(() => {
        if (!cancelled) void tick();
      }, { timeoutMs: 2500 });
    };

    runTick();
    scheduleTimer();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        runTick();
        scheduleTimer();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      if (timer != null) window.clearInterval(timer);
      if (cancelIdle) cancelIdle();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const updateSessionModel = useCallback((sessionId: string, model: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, model } : s)),
    );
  }, []);

  const updateSessionConnectionKind = useCallback(
    async (sessionId: string, kind: ClaudeSessionConnectionKind) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session) return;

      const next = normalizeClaudeConnectionKind(kind);
      if (
        resolveSessionConnectionKind(session.connectionKind, defaultConnectionKindRef.current) ===
        next
      ) {
        return;
      }

      if (session.status === "running" || session.status === "connecting") {
        message.warning("会话运行中，请先点击「结束」后再切换连接方式。");
        return;
      }

      const claudeSid =
        session.claudeSessionId?.trim() ?? sessionIdMapRef.current.get(sessionId)?.trim() ?? null;
      if (claudeSid) {
        await closeStreamingSession(claudeSid).catch(() => {
          /* 进程可能已退出 */
        });
      }
      streamingProcessByTabRef.current.delete(sessionId);
      detachClaudeInvocationsForSessionKey(sessionId);

      const globalDefault = defaultConnectionKindRef.current;
      const clearingOverride = next === globalDefault && session.connectionKind !== undefined;

      setSessions((prev) => {
        const nextSessions = prev.map((s) =>
          s.id === sessionId ? applyTabConnectionKindOverride(s, next, globalDefault) : s,
        );
        sessionsRef.current = nextSessions;
        return nextSessions;
      });
      message.success(
        clearingOverride
          ? `已恢复跟随全局默认：${CLAUDE_CONNECTION_KIND_LABELS[globalDefault].title}`
          : `本标签已临时切换为：${CLAUDE_CONNECTION_KIND_LABELS[next].title}`,
      );
    },
    [detachClaudeInvocationsForSessionKey],
  );

  // Create a session without executing Claude (idle state); model from Claude Code settings.json
  const createSession = useCallback(
    async (
      repositoryPath: string,
      repositoryName: string,
      opts?: { skipActivate?: boolean; connectionKind?: ClaudeSessionConnectionKind },
    ) => {
      const id = generateId();
      const newSession: ClaudeSession = {
        id,
        claudeSessionId: null,
        repositoryPath: normalizeRepositoryPathKey(repositoryPath) || repositoryPath.trim(),
        repositoryName,
        model: "sonnet",
        status: "idle",
        messages: [],
        createdAt: Date.now(),
        pendingPrompt: "",
        ...(opts?.connectionKind ? { connectionKind: opts.connectionKind } : {}),
      };

      // 先写入 state/ref，避免 await 读配置阻塞 UI（侧栏切仓库时中间栏会晚出现）。
      setSessions((prev) => {
        if (prev.some((s) => s.id === id)) {
          sessionsRef.current = prev;
          return prev;
        }
        const next = [...prev, newSession];
        sessionsRef.current = next;
        return next;
      });
      trellisContextIdBySessionRef.current.set(id, trellisContextIdForTab(id));
      persistTrellisContextBindings(trellisContextIdBySessionRef.current);
      if (!opts?.skipActivate) {
        setActiveSessionId(id);
      }

      void (async () => {
        try {
          const model = await getCachedClaudeConfigModel(repositoryPath);
          if (!model?.trim()) return;
          setSessions((prev) => {
            const next = prev.map((s) => (s.id === id ? { ...s, model } : s));
            sessionsRef.current = next;
            return next;
          });
        } catch {
          /* keep default */
        }
      })();

      return id;
    },
    [getCachedClaudeConfigModel],
  );

  const ensureWorkflowRunId = useCallback(async (session: ClaudeSession): Promise<string | null> => {
    const existing = workflowRunBySessionRef.current.get(session.id);
    if (existing) return existing;
    const facade = getWorkflowFacade();
    const created = await facade.createRun({
      sessionId: session.id,
      repositoryPath: session.repositoryPath,
      taskSnapshotId: "live-session",
      startStage: "implement",
    });
    if (!created.ok) return null;
    const workflowRunId = created.data.workflowRunId;
    workflowRunBySessionRef.current.set(session.id, workflowRunId);
    persistWorkflowBindings(workflowRunBySessionRef.current);
    return workflowRunId;
  }, []);

  // 首条：`executeClaudeCode`；同一会话后续：`resumeClaudeCode`（均 oneshot，多会话并行；`startedRef` 永久挡住会导致「完成后无法再发」）
  const executeSession = useCallback(
    (
      sessionId: string,
      prompt: string,
      opts?: SessionExecuteOpts,
    ): boolean => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
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

      const forceFreshClaudeSession = opts?.terminalFreshTurn === true;
      const engineResolverEarly = claudeSessionsOptionsRef.current?.resolveExecutionEngineRef?.current;
      const terminalEngine: SessionExecutionEngine =
        engineResolverEarly?.(session) ?? "claude";
      if (forceFreshClaudeSession) {
        sessionIdMapRef.current.delete(sessionId);
        const staleClaudeSid = session.claudeSessionId?.trim();
        const cancelIds = new Set<string>();
        if (staleClaudeSid) cancelIds.add(staleClaudeSid);
        if (usesWiseTabIdForDiskTranscript(terminalEngine)) {
          cancelIds.add(sessionId);
        }
        for (const sid of cancelIds) {
          void cancelClaudeExecution(sid).catch(() => {});
        }
        if (cancelIds.size > 0) {
          streamingProcessByTabRef.current.delete(sessionId);
        }
      }
      const claudeSidRaw =
        session.claudeSessionId ?? sessionIdMapRef.current.get(sessionId) ?? null;
      const claudeSid = forceFreshClaudeSession ? null : claudeSidRaw;

      const liveSession = sessionsRef.current.find((s) => s.id === sessionId) ?? session;
      const engineResolver = claudeSessionsOptionsRef.current?.resolveExecutionEngineRef?.current;
      const executionEngine: SessionExecutionEngine =
        engineResolver && liveSession ? engineResolver(liveSession) : "claude";
      const skipClaudeSidBootstrapWait =
        executionEngine === "cursor" || executionEngine === "codex";
      // 首轮已启动但尚未收到 stream-json 的 session_id 时，避免再 spawn 第二个进程。
      // 终端派发强制新回合时已主动取消旧进程并重置为 idle，不得在此阻塞。
      // Cursor/Codex oneshot 不使用 Claude session_id，不得在此等待。
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
          commitSessions((prev) =>
            appendSystemMessageBySessionId(
              prev.map((s) =>
                s.id === sessionId ? { ...s, status: "error" as const } : s,
              ),
              sessionId,
              "会话仍在启动中，请稍后再试或先停止当前执行。",
            ),
          );
          return false;
        }
        return true;
      }

      streamingTargetIdRef.current = sessionId;
      streamTurnSeqRef.current += 1;
      lastUserSendNonceRef.current = streamTurnSeqRef.current;
      assistantStreamTextByTabRef.current.set(sessionId, "");

      const spawnSession =
        sessionsRef.current.find((s) => s.id === sessionId) ?? liveSession;

      const modelArg =
        spawnSession.model.trim().length > 0 ? spawnSession.model : undefined;

      const checker = claudeSessionsOptionsRef.current?.beforeSpawnClaudeRef?.current;
      if (checker) {
        const gate = checker(spawnSession);
        if (!gate.ok) {
          claudeSessionsOptionsRef.current?.onClaudeSpawnBlocked?.(gate.message);
          return false;
        }
      }

      expectedTurnNonceByTabIdRef.current.set(sessionId, lastUserSendNonceRef.current);
      markClaudeRegistryBootstrapWarmup(registryBootstrapDeadlineByClaudeSidRef, claudeSid);
      const bubblePrompt = opts?.userBubblePrompt?.trim()
        ? opts.userBubblePrompt
        : opts?.cursorAttachments && opts.cursorAttachments.length > 0
          ? buildCursorUserBubblePrompt(prompt, opts.cursorAttachments)
          : prompt;
      commitSessions((prev) => {
        if (
          opts?.replaceUserBubbleAtIndex !== undefined &&
          Number.isFinite(opts.replaceUserBubbleAtIndex)
        ) {
          return setSessionRunningReplacingUserBubbleAtIndex(
            prev,
            sessionId,
            opts.replaceUserBubbleAtIndex,
            bubblePrompt,
          );
        }
        if (opts?.replaceLastUserBubble) {
          return setSessionRunningReplacingLastUserBubble(prev, sessionId, bubblePrompt);
        }
        if (opts?.replaceFirstUserBubble) {
          return setSessionRunningReplacingFirstUserBubble(prev, sessionId, bubblePrompt);
        }
        if (forceFreshClaudeSession) {
          return beginSessionTurnWithUserPrompt(prev, sessionId, bubblePrompt, {
            forceFreshClaudeSession: true,
          });
        }
        return setSessionRunningWithUserPrompt(prev, sessionId, bubblePrompt);
      });
      scheduleStreamStallTimer(sessionId);

      const invokeConc =
        claudeSessionsOptionsRef.current?.claudeConcurrencyInvokeContextRef?.current?.(session) ?? null;

      const turnNonce = lastUserSendNonceRef.current;

      const codexContextExecutionEngine = resolveCodexContextExecutionEngine({
        tabSessionId: sessionId,
        terminalFreshTurn: forceFreshClaudeSession,
        activeSessionId,
        sessions: sessionsRef.current,
        resolveEngine: resolveSessionExecutionEngine,
      });

      pendingTurnFailoverRef.current = {
        tabSessionId: sessionId,
        turnNonce,
        invokeConc,
        repositoryPath: spawnSession.repositoryPath,
        prompt,
        modelArg,
        resumeClaudeSid: claudeSid,
        forceNewClaudeConversation: forceFreshClaudeSession,
        cursorAttachments: opts?.cursorAttachments,
        engine: resolveSessionExecutionEngine(spawnSession),
        autoFailoverEnabled: isCachedModelProfileAutoFailoverEnabled(),
        triedProfileIds: [],
      };

      void (async () => {
        try {
          await runClaudeTurnWithContextGuard({
            tabSessionId: sessionId,
            turnNonce,
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
          clearStreamStallTimer(sessionId);
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
              /* fall through to error UI */
            }
          }
          pendingTurnFailoverRef.current = null;
          if (claudeSid?.trim()) {
            registryBootstrapDeadlineByClaudeSidRef.current.delete(claudeSid.trim());
          }
          commitSessions((prev) =>
            appendSystemMessageBySessionId(
              prev.map((s) => (s.id === sessionId ? { ...s, status: "error" as const } : s)),
              sessionId,
              claudeSid ? `发送失败: ${err}` : `启动失败: ${err}`,
            ),
          );
        }
      })();
      return true;
    },
    [
      clearStreamStallTimer,
      commitSessions,
      resolveSessionExecutionEngine,
      runClaudeTurnWithContextGuard,
      scheduleStreamStallTimer,
      activeSessionId,
    ],
  );

  const executeTerminalSession = useCallback(
    (
      sessionId: string,
      outboundPrompt: string,
      bubbleOpts?: { userBubblePrompt?: string },
    ): boolean =>
      executeSession(sessionId, outboundPrompt, {
        terminalFreshTurn: true,
        userBubblePrompt: bubbleOpts?.userBubblePrompt,
      }),
    [executeSession],
  );

  const appendSystemMessage = useCallback((sessionId: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSessions((prev) => appendSystemMessageBySessionId(prev, sessionId, trimmed));
  }, []);

  const appendUserMessage = useCallback((sessionId: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSessions((prev) => appendUserMessageBySessionOrClaudeId(prev, sessionId, trimmed));
  }, []);

  const sendMessageToSession = useCallback(
    (
      sessionId: string,
      prompt: string,
      opts?: ClaudeComposerExecuteBubbleOptions,
    ): Promise<void> => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session) return Promise.resolve();

      notificationHub.clearTodos(sessionId);
      if (session.claudeSessionId && session.claudeSessionId !== sessionId) {
        notificationHub.clearTodos(session.claudeSessionId);
      }

      const claudeSessionId =
        session.claudeSessionId ?? sessionIdMapRef.current.get(sessionId) ?? null;

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
      const modelArg =
        session.model.trim().length > 0 ? session.model : undefined;

      pendingTurnFailoverRef.current = {
        tabSessionId: sessionId,
        turnNonce,
        invokeConc,
        repositoryPath: session.repositoryPath,
        prompt,
        modelArg,
        resumeClaudeSid: claudeSessionId,
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
            appendSystemMessageBySessionId(
              prev.map((s) => (s.id === sessionId ? { ...s, status: "error" as const } : s)),
              sessionId,
              claudeSessionId ? `发送失败: ${err}` : `启动失败: ${err}`,
            ),
          );
          throw err;
        }
      })();
    },
    [resolveSessionExecutionEngine, runClaudeTurnWithContextGuard],
  );

  const compactSessionHistory = useCallback(
    async (sessionId: string) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session) return;
      const claudeSessionId =
        session.claudeSessionId ?? sessionIdMapRef.current.get(sessionId) ?? null;
      if (!claudeSessionId?.trim()) {
        message.warning("会话尚未建立 Claude session_id，暂无法压缩历史。");
        return;
      }
      if (session.status === "running" || session.status === "connecting") {
        message.warning("会话运行中，请结束当前轮次后再压缩上下文。");
        return;
      }
      streamingTargetIdRef.current = sessionId;
      streamTurnSeqRef.current += 1;
      lastUserSendNonceRef.current = streamTurnSeqRef.current;
      const turnNonce = lastUserSendNonceRef.current;
      expectedTurnNonceByTabIdRef.current.set(sessionId, turnNonce);
      markClaudeRegistryBootstrapWarmup(registryBootstrapDeadlineByClaudeSidRef, claudeSessionId);
      setSessions((prev) =>
        setSessionRunningWithUserPrompt(
          appendSystemMessageBySessionId(prev, sessionId, "正在执行 /compact 压缩会话历史…"),
          sessionId,
          CLAUDE_COMPACT_SLASH_PROMPT,
        ),
      );
      const invokeConc =
        claudeSessionsOptionsRef.current?.claudeConcurrencyInvokeContextRef?.current?.(session) ?? null;
      const modelArg = session.model.trim().length > 0 ? session.model : undefined;
      try {
        await invokeClaudeTurn({
          tabSessionId: sessionId,
          turnNonce,
          invokeConc,
          repositoryPath: session.repositoryPath,
          prompt: CLAUDE_COMPACT_SLASH_PROMPT,
          modelArg,
          resumeClaudeSid: claudeSessionId,
        });
        await reloadTranscriptFromDisk({
          tabId: sessionId,
          repositoryPath: session.repositoryPath,
          claudeSessionId: claudeSessionId.trim(),
        });
      } catch (err) {
        setSessions((prev) =>
          appendSystemMessageBySessionId(
            prev.map((s) => (s.id === sessionId ? { ...s, status: "error" as const } : s)),
            sessionId,
            `压缩失败: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        throw err;
      }
    },
    [invokeClaudeTurn, reloadTranscriptFromDisk],
  );

  const sendMessage = useCallback(
    (prompt: string) => {
      if (!activeSessionId) return;
      sendMessageToSession(activeSessionId, prompt);
    },
    [activeSessionId, sendMessageToSession],
  );

  const releaseSessionHostProcess = useCallback(
    async (sessionId: string) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session) {
        return;
      }

      purgeStreamSidecarsForSession(sessionId, session.claudeSessionId);
      clearStreamStallTimer(sessionId);
      detachClaudeInvocationsForSessionKey(sessionId);
      streamingProcessByTabRef.current.delete(sessionId);

      const snapshot = await getSystemResourceSnapshot().catch(() => null);
      try {
        await stopClaudeMainSession({
          session,
          claudeProcesses: snapshot?.claudeProcesses ?? [],
          onCancelTabSession: (tabId) => {
            const tab = sessionsRef.current.find((s) => s.id === tabId);
            const sid =
              tab?.claudeSessionId?.trim() ?? sessionIdMapRef.current.get(tabId)?.trim() ?? null;
            if (sid) {
              void cancelClaudeExecution(sid).catch(() => {});
            }
          },
        });
      } catch {
        /* 无本机进程可结束 */
      }

      const claudeSid =
        session.claudeSessionId?.trim() ?? sessionIdMapRef.current.get(sessionId)?.trim() ?? null;
      if (claudeSid && sessionUsesStreamingConnection(session, defaultConnectionKindRef.current)) {
        await closeStreamingSession(claudeSid).catch(() => {
          /* 进程可能已退出 */
        });
      }

      commitSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          if (s.status === "running" || s.status === "connecting") {
            return { ...s, status: "idle" as const };
          }
          return s;
        }),
      );
    },
    [clearStreamStallTimer, commitSessions, detachClaudeInvocationsForSessionKey, purgeStreamSidecarsForSession],
  );

  const closeSession = useCallback((sessionId: string) => {
    const victim = sessionsRef.current.find((s) => s.id === sessionId);
    purgeStreamSidecarsForSession(sessionId, victim?.claudeSessionId);
    clearStreamStallTimer(sessionId);
    detachClaudeInvocationsForSessionKey(sessionId);
    const victimSid = victim?.claudeSessionId?.trim() ?? sessionIdMapRef.current.get(sessionId)?.trim();
    if (victimSid) {
      void closeStreamingSession(victimSid).catch(() => {
        /* 进程可能已结束 */
      });
    }
    streamingProcessByTabRef.current.delete(sessionId);
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
    workflowRunBySessionRef.current.delete(sessionId);
    persistWorkflowBindings(workflowRunBySessionRef.current);
  }, [clearStreamStallTimer, detachClaudeInvocationsForSessionKey, purgeStreamSidecarsForSession]);

  const deleteSession = useCallback(
    async (sessionId: string) => {
      const target = sessionsRef.current.find((s) => s.id === sessionId);
      if (!target) {
        return;
      }
      if (target.status === "running" || target.status === "connecting") {
        throw new Error("会话正在运行，请先取消后再删除");
      }
      const claudeSessionId = target.claudeSessionId?.trim();
      if (claudeSessionId && target.repositoryPath) {
        // 后端校验 sessionId 形态并把删除限定在 `~/.claude/projects/<encoded>/`，
        // 失败时抛错给上层做 toast；不在这里吞掉，避免静默丢失。
        await deleteClaudeDiskSession(target.repositoryPath, claudeSessionId);
      }
      closeSession(sessionId);
    },
    [closeSession],
  );

  const switchSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
  }, []);

  const cancelSession = useCallback(
    (sessionId: string, opts?: { retractLastUserTurn?: boolean }) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      const realSessionId =
        session?.claudeSessionId ?? sessionIdMapRef.current.get(sessionId) ?? null;

      expectedTurnNonceByTabIdRef.current.delete(sessionId);
      if (realSessionId?.trim()) {
        expectedTurnNonceByTabIdRef.current.delete(realSessionId.trim());
      }
      const refT = streamingTargetIdRef.current;
      if (refT !== null && (refT === sessionId || refT === realSessionId?.trim())) {
        streamingTargetIdRef.current = null;
      }

      void cancelHostExecutionForTab(sessionId, realSessionId);
      void closeStreamingSession(realSessionId ?? sessionId).catch(() => {
        /* 长驻进程可能已退出 */
      });
      streamingProcessByTabRef.current.delete(sessionId);
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
    },
    [cancelHostExecutionForTab, clearStreamStallTimer, purgeStreamSidecarsForSession],
  );

  const stopSessionConversationTask = useCallback((item: SessionConversationTaskItem): boolean => {
    if (item.status !== "running" || !item.cancellable) return false;
    const sid = item.sessionId?.trim();
    if (!sid) return false;

    const session = sessionsRef.current.find((s) => s.id === sid);
    const realSessionId =
      session?.claudeSessionId ?? sessionIdMapRef.current.get(sid) ?? null;
    void cancelHostExecutionForTab(sid, realSessionId);
    void closeStreamingSession(realSessionId ?? sid).catch(() => {
      /* 长驻进程可能已退出 */
    });
    streamingProcessByTabRef.current.delete(sid);
    if (session?.claudeSessionId?.trim()) {
      assistantStreamTextByTabRef.current.delete(session.claudeSessionId.trim());
    }
    assistantStreamTextByTabRef.current.delete(sid);
    const refT = streamingTargetIdRef.current;
    if (refT !== null && (refT === sid || refT === session?.claudeSessionId?.trim())) {
      streamingTargetIdRef.current = null;
    }

    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sid) return s;
        const marked = item.toolUseId?.trim()
          ? markSessionToolUseStopped(s, item.toolUseId)
          : s;
        return { ...marked, status: "cancelled" as const };
      }),
    );
    return true;
  }, [cancelHostExecutionForTab]);

  const ensureStreamingSessionStreamListening = useCallback(
    async (tabSessionId: string, claudeSessionId: string, turnNonceOverride?: number) => {
      const rt = streamRuntimeRef.current;
      const sid = claudeSessionId.trim();
      if (!rt || !sid) return;
      streamingSessionStreamDetachByTabRef.current.get(tabSessionId)?.();
      const turnNonce =
        turnNonceOverride ??
        (() => {
          streamTurnSeqRef.current += 1;
          return streamTurnSeqRef.current;
        })();
      expectedTurnNonceByTabIdRef.current.set(tabSessionId, turnNonce);
      streamingTargetIdRef.current = tabSessionId;
      markClaudeRegistryBootstrapWarmup(registryBootstrapDeadlineByClaudeSidRef, sid);
      assistantStreamTextByTabRef.current.set(tabSessionId, "");
      const detach = await attachClaudeSessionStreamForTurn(
        sid,
        tabSessionId,
        rt,
        turnNonce,
        () => {
          streamingSessionStreamDetachByTabRef.current.delete(tabSessionId);
        },
        (tabId, bound) => expectedTurnNonceByTabIdRef.current.get(tabId) ?? bound,
        (tabId) => {
          if (!streamingProcessByTabRef.current.has(tabId)) return false;
          const session = sessionsRef.current.find((s) => s.id === tabId);
          return Boolean(
            session && sessionUsesStreamingConnection(session, defaultConnectionKindRef.current),
          );
        },
      );
      streamingSessionStreamDetachByTabRef.current.set(tabSessionId, detach);
      streamingProcessByTabRef.current.set(tabSessionId, { claudeSessionId: sid });
      commitSessions((prev) =>
        prev.map((s) =>
          s.id === tabSessionId && s.status !== "running" && s.status !== "connecting"
            ? { ...s, status: "running" as const }
            : s,
        ),
      );
    },
    [commitSessions],
  );

  const prepareStreamingControlResponseListener = useCallback(
    async (tabSessionId: string, claudeSessionId: string, turnNonce?: number) => {
      detachClaudeInvocationStreamsForTab(tabSessionId);
      await ensureStreamingSessionStreamListening(tabSessionId, claudeSessionId, turnNonce);
    },
    [detachClaudeInvocationStreamsForTab, ensureStreamingSessionStreamListening],
  );

  useEffect(() => {
    prepareStreamingControlResponseListenerRef.current = prepareStreamingControlResponseListener;
  }, [prepareStreamingControlResponseListener]);

  /**
   * 立刻向宿主拉取仍在跑的 Claude `session_id`，用 `reconcileSessionStatusesWithRunningRegistry`
   * 刷新主会话 / 员工独立标签 / 团队流程等全部标签的 `status`，不必等定时轮询。
   * 用于 AskUserQuestion 提交、重新提交（含 stdin 续跑与 resume 重启）后与真实子进程对齐。
   */
  const syncSessionStatusesWithHostRegistry = useCallback(async () => {
    try {
      const [listResult, snapshotResult] = await Promise.allSettled([
        listRunningClaudeSessions(),
        getSystemResourceSnapshot(),
      ]);
      if (listResult.status !== "fulfilled") return;
      const list = listResult.value;
      const claudeProcesses =
        snapshotResult.status === "fulfilled" ? snapshotResult.value.claudeProcesses ?? [] : [];
      hydrateStreamingProcessRegistryFromHost(
        sessionsRef.current,
        claudeProcesses,
        streamingProcessByTabRef.current,
        defaultConnectionKindRef.current,
      );
      const knownIds = new Set(
        list.map((item) => item.session_id.trim()).filter((id) => id.length > 0),
      );
      const runningIds = new Set(
        list
          .filter((item) => item.status === "running")
          .map((item) => item.session_id.trim())
          .filter((id) => id.length > 0),
      );
      pruneClaudeRegistryBootstrapWarmup(registryBootstrapDeadlineByClaudeSidRef, runningIds);
      setSessions((prev) => {
        const reconciled = reconcileSessionStatusesWithRunningRegistry(
          prev,
          runningIds,
          registryBootstrapDeadlineByClaudeSidRef.current,
          knownIds,
        );
        const next = applyStreamingResidentUiStatuses(
          reconciled,
          streamingProcessByTabRef.current,
          defaultConnectionKindRef.current,
        );
        return next === prev ? prev : next;
      });
    } catch {
      /* 与定时 tick 一致：拉取失败则保持当前 UI */
    }
  }, []);

  // ── Dock handlers ──
  const deliverQuestionAnswerViaResume = useCallback(
    async (
      ownerSessionId: string,
      qr: QuestionRequest,
      answers: string[],
      customAnswer?: string,
    ): Promise<boolean> => {
      const session = sessionsRef.current.find(
        (s) => s.id === ownerSessionId || s.claudeSessionId === ownerSessionId,
      );
      const tabSession = sessionsRef.current.find(
        (s) => s.id === ownerSessionId || s.claudeSessionId === ownerSessionId,
      );
      if (!tabSession) {
        message.warning("找不到对应会话标签，无法以 resume 接续。");
        return false;
      }
      const resumePrompt = buildQuestionResumeUserPrompt(qr, answers, customAnswer);
      try {
        notificationHub.markRequestAnswered(qr.id);
        notificationHub.clearQuestion(ownerSessionId);
        const sendPromise = sendMessageToSession(ownerSessionId, resumePrompt);
        void syncSessionStatusesWithHostRegistry();
        await sendPromise;
        if (session) {
          const facade = getWorkflowFacade();
          const workflowRunId = (await ensureWorkflowRunId(session)) ?? `session:${session.id}`;
          await facade.respondQuestion({
            workflowRunId,
            sessionId: session.id,
            requestId: qr.id,
            answers,
            customAnswer,
          });
        }
        void syncSessionStatusesWithHostRegistry();
        return true;
      } catch (e2) {
        message.error(e2 instanceof Error ? e2.message : String(e2));
        return false;
      }
    },
    [ensureWorkflowRunId, sendMessageToSession, syncSessionStatusesWithHostRegistry],
  );

  const respondToQuestion = useCallback(
    async (sessionId: string, answers: string[], customAnswer?: string) => {
      const qr = notificationHub.getDockSlice(sessionId).questionRequest;
      if (!qr) return;
      const qrLife = notificationHub.getRequestLifecycle(qr.id);
      const ownerSessionId = notificationHub.findRequestSessionId(qr.id) ?? sessionId;
      const { session, tabSessionId, claudeSid } = resolveControlSessionContext({
        ownerSessionId,
        sessions: sessionsRef.current,
        sessionIdMap: sessionIdMapRef.current,
      });
      const liveStreamingProcess = hasLiveStreamingClaudeProcess({
        session,
        defaultConnectionKind: defaultConnectionKindRef.current,
        streamingTabTracked: streamingProcessByTabRef.current.has(tabSessionId),
        streamingProcessClaudeSessionId: streamingProcessByTabRef.current.get(tabSessionId)?.claudeSessionId,
      });
      const userAnswerText = buildQuestionFallbackUserPrompt(qr, answers, customAnswer);
      const preferStdinControlResponse = shouldPreferQuestionStdinControl({
        session,
        claudeSid,
        defaultConnectionKind: defaultConnectionKindRef.current,
        hasLiveStreamingProcess: liveStreamingProcess,
        sessionUsesStreamingConnection,
      });

      let configModel: string | null = null;
      if (session?.repositoryPath?.trim()) {
        configModel = await getCachedClaudeConfigModel(session.repositoryPath);
      }
      const proxyStreamingQuestion =
        session &&
        sessionUsesStreamingConnection(session, defaultConnectionKindRef.current) &&
        shouldUseProxyQuestionResumeDelivery(session.model, configModel);

      const handledByProxyBranch = await handleProxyStreamingQuestionBranch({
        proxyStreamingQuestion: Boolean(proxyStreamingQuestion),
        claudeSid,
        tabSessionId,
        closeStreamingSession,
        streamingProcessByTab: streamingProcessByTabRef.current,
        streamingSessionStreamDetachByTab: streamingSessionStreamDetachByTabRef.current,
        detachClaudeInvocationStreamsForTab,
        deliverQuestionAnswerViaResume,
        ownerSessionId,
        qr,
        answers,
        customAnswer,
      });
      if (handledByProxyBranch) {
        return;
      }

      // 子进程已结束、stdin 已回收，或上次 stdin 失败：首次点击即走 resume，避免先报错再点「重新提交」。
      // 长驻 streaming 单轮 result 后 UI 会 idle/expired，但子进程仍等 control_response，必须优先写 stdin。
      if (shouldDeliverQuestionViaResume(qrLife, session, { preferStdinControlResponse })) {
        await deliverQuestionAnswerViaResume(ownerSessionId, qr, answers, customAnswer);
        return;
      }

      const targetSessionId = claudeSid ?? session?.id ?? ownerSessionId;
      const nextTurnNonceState = consumeNextTurnNonce(
        streamTurnSeqRef.current,
        Boolean(preferStdinControlResponse && claudeSid),
      );
      streamTurnSeqRef.current = nextTurnNonceState.nextSeq;
      const nextTurnNonce = nextTurnNonceState.turnNonce;
      try {
        await submitQuestionViaStdin({
          tabSessionId,
          claudeSid,
          targetSessionId,
          nextTurnNonce,
          qr,
          answers,
          customAnswer,
          userAnswerText,
          preferStdinControlResponse,
          appendUserMessage,
          expectedTurnNonceByTabId: expectedTurnNonceByTabIdRef.current,
          setStreamingTargetId: (id) => {
            streamingTargetIdRef.current = id;
          },
          markClaudeRegistryBootstrapWarmup: (sid) => {
            markClaudeRegistryBootstrapWarmup(registryBootstrapDeadlineByClaudeSidRef, sid);
          },
          setStreamingProcessByTab: (tabId, sid) => {
            streamingProcessByTabRef.current.set(tabId, { claudeSessionId: sid });
          },
          setSessionRunning: (runningTabId) => {
            commitSessions((prev) =>
              prev.map((s) =>
                s.id === runningTabId ? { ...s, status: "running" as const } : s,
              ),
            );
          },
          prepareStreamingControlResponseListener,
          scheduleStreamStallTimer,
          submitClaudeStdinLine,
          buildQuestionStdinLine,
          isToolUseQuestionRequestId,
          sendStreamingUserMessage,
        });
        notificationHub.markRequestAnswered(qr.id);
        notificationHub.clearQuestion(ownerSessionId);
        void syncSessionStatusesWithHostRegistry();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (isQuestionStdinUnavailableError(msg)) {
          notificationHub.invalidateControlRequestsForSession(ownerSessionId, msg);
          await deliverQuestionAnswerViaResume(ownerSessionId, qr, answers, customAnswer);
        } else {
          notificationHub.markRequestFailed(qr.id, msg);
        }
        return;
      }
      if (session) {
        const facade = getWorkflowFacade();
        const workflowRunId = (await ensureWorkflowRunId(session)) ?? `session:${session.id}`;
        await facade.respondQuestion({
          workflowRunId,
          sessionId: session.id,
          requestId: qr.id,
          answers,
          customAnswer,
        });
      }
    },
    [
      appendUserMessage,
      deliverQuestionAnswerViaResume,
      detachClaudeInvocationStreamsForTab,
      ensureWorkflowRunId,
      getCachedClaudeConfigModel,
      prepareStreamingControlResponseListener,
      scheduleStreamStallTimer,
      syncSessionStatusesWithHostRegistry,
    ],
  );

  const dismissQuestion = useCallback(
    (sessionId: string) => {
      dismissQuestionBySession({ sessionId, respondToQuestion });
    },
    [respondToQuestion],
  );

  const respondToPermission = useCallback(
    async (sessionId: string, response: "allow_once" | "allow_always" | "deny") => {
      const pr = notificationHub.getDockSlice(sessionId).permissionRequest;
      if (!pr) return;
      const ownerSessionId = notificationHub.findRequestSessionId(pr.id) ?? sessionId;
      const prLife = notificationHub.getRequestLifecycle(pr.id);
      if (prLife?.status === "expired") {
        notificationHub.clearPermission(ownerSessionId);
        return;
      }
      const { session, tabSessionId, claudeSid } = resolveControlSessionContext({
        ownerSessionId,
        sessions: sessionsRef.current,
        sessionIdMap: sessionIdMapRef.current,
      });
      const targetSessionId = session?.claudeSessionId ?? session?.id ?? ownerSessionId;
      const payload = buildPermissionStdinLine(pr.id, response, pr.toolInput, pr.toolUseId);
      const preferStdin =
        session &&
        claudeSid &&
        sessionUsesStreamingConnection(session, defaultConnectionKindRef.current);
      const nextTurnNonceState = consumeNextTurnNonce(streamTurnSeqRef.current, Boolean(preferStdin));
      streamTurnSeqRef.current = nextTurnNonceState.nextSeq;
      const nextTurnNonce = nextTurnNonceState.turnNonce;
      try {
        if (nextTurnNonce !== null && claudeSid) {
          expectedTurnNonceByTabIdRef.current.set(tabSessionId, nextTurnNonce);
          streamingTargetIdRef.current = tabSessionId;
          commitSessions((prev) =>
            prev.map((s) =>
              s.id === tabSessionId ? { ...s, status: "running" as const } : s,
            ),
          );
          await prepareStreamingControlResponseListener(tabSessionId, claudeSid, nextTurnNonce);
          scheduleStreamStallTimer(tabSessionId);
        }
        await submitClaudeStdinLine(payload, targetSessionId);
        notificationHub.markRequestAnswered(pr.id);
        notificationHub.clearPermission(ownerSessionId);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (/没有可写 stdin|未指定目标会话/.test(msg)) {
          notificationHub.invalidateControlRequestsForSession(ownerSessionId, msg);
          message.warning(
            "当前 Claude 进程已结束或未连接，无法提交权限结果。请在本标签重新发起一轮对话后再操作。",
          );
        } else {
          notificationHub.markRequestFailed(pr.id, msg);
        }
        return;
      }
      if (session) {
        const facade = getWorkflowFacade();
        const workflowRunId = (await ensureWorkflowRunId(session)) ?? `session:${session.id}`;
        await facade.respondPermission({
          workflowRunId,
          sessionId: session.id,
          requestId: pr.id,
          response,
        });
      }
    },
    [commitSessions, ensureWorkflowRunId, prepareStreamingControlResponseListener, scheduleStreamStallTimer],
  );

  const clearTodos = useCallback((sessionId: string) => {
    notificationHub.clearTodos(sessionId);
  }, []);

  const restoreTodosFromTranscript = useCallback((sessionId: string) => {
    restoreTodosFromTranscriptBySession({ sessionId, sessions: sessionsRef.current });
  }, []);

  const restorePendingPermissionFromTranscript = useCallback((sessionId: string) => {
    restorePendingPermissionFromTranscriptBySession({ sessionId, sessions: sessionsRef.current });
  }, []);

  const toggleTodo = useCallback((sessionId: string, todoId: string) => {
    notificationHub.toggleTodoItem(sessionId, todoId);
  }, []);

  const clearFollowups = useCallback((sessionId: string) => {
    notificationHub.clearFollowups(sessionId);
  }, []);

  const clearRevertItems = useCallback((sessionId: string) => {
    notificationHub.clearRevertItems(sessionId);
  }, []);

  const sendFollowup = useCallback(
    (sessionId: string, id: string) => {
      sendFollowupById({ sessionId, followupId: id, sendMessageToSession });
    },
    [sendMessageToSession],
  );

  const restoreRevert = useCallback(
    async (sessionId: string, itemId: string) => {
      await restoreRevertById({
        sessionId,
        itemId,
        sessions: sessionsRef.current,
        sendMessageToSession,
      });
    },
    [sendMessageToSession],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      notificationHub.expireStaleRequests(CONTROL_REQUEST_EXPIRE_MS);
    }, readVisiblePollIntervalMs(60_000, 180_000));
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!tabsHydrated) return;
    const hasActiveStream = sessions.some(
      (item) => item.status === "running" || item.status === "connecting",
    );
    const debounceMs =
      typeof document !== "undefined" && document.visibilityState !== "visible"
        ? 3000
        : hasActiveStream
          ? 2000
          : 450;
    const t = window.setTimeout(() => {
      const bindingsChanged = pruneLiveSessionSidecars(sessions);
      if (bindingsChanged) {
        persistWorkflowBindings(workflowRunBySessionRef.current);
        persistTrellisContextBindings(trellisContextIdBySessionRef.current);
      }
      void saveSessionTabsState({
        version: 1,
        activeSessionId,
        sessions: sessions.map((s) => {
          const {
            diskTranscriptPartial: _omitPartial,
            transcriptMemoryUnlimited: _omitUnlimited,
            ...rest
          } = s;
          const messages =
            rest.messages.length <= PERSIST_SESSION_MESSAGES_MAX
              ? rest.messages
              : rest.messages.slice(-PERSIST_SESSION_MESSAGES_MAX);
          return {
            ...rest,
            repositoryPath: normalizeSessionRepositoryPath(rest.repositoryPath),
            messages,
          };
        }),
      });
    }, debounceMs);
    return () => window.clearTimeout(t);
  }, [sessions, activeSessionId, tabsHydrated, pruneLiveSessionSidecars]);

  useEffect(() => {
    return () => {
      for (const key of [...streamStallTimerByTabRef.current.keys()]) {
        clearStreamStallTimer(key);
      }
    };
  }, [clearStreamStallTimer]);

  return {
    sessions,
    /** 与 `commitSessions` / `createSession` 同步更新的会话列表；派发终端 worker 须读此 ref，勿用滞后一帧的 `sessions` prop。 */
    sessionsLiveRef: sessionsRef,
    activeSessionId,
    createSession,
    updateSessionModel,
    updateSessionConnectionKind,
    executeSession,
    executeTerminalSession,
    appendSystemMessage,
    appendUserMessage,
    sendMessage,
    sendMessageToSession,
    closeSession,
    deleteSession,
    switchSession,
    cancelSession,
    stopSessionConversationTask,
    respondToQuestion,
    dismissQuestion,
    respondToPermission,
    clearTodos,
    restoreTodosFromTranscript,
    restorePendingPermissionFromTranscript,
    toggleTodo,
    clearFollowups,
    clearRevertItems,
    sendFollowup,
    restoreRevert,
    refreshDiskSessionsForRepository,
    tabsHydrated,
    reloadFullDiskTranscript,
    loadMoreTranscriptFromDisk,
    compactSessionHistory,
    releaseSessionHostProcess,
  };
}
