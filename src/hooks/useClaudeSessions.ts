import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  startTransition,
  useSyncExternalStore,
  type SetStateAction,
} from "react";
import { message } from "antd";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { safeUnlisten } from "../utils/safeTauriUnlisten";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  ClaudeSession,
  QuestionRequest,
  SessionConversationTaskItem,
  SessionExecutionEngine,
} from "../types";
import {
  sendStreamingUserMessage,
  closeStreamingSession,
  cancelClaudeExecution,
  cancelClaudeInvocation,
  getClaudeConfigModel,
  submitClaudeStdinLine,
  listRunningClaudeSessions,
} from "../services/claude";
import {
  type CursorSdkAttachment,
} from "../services/cursorComposerPrompt";
import { resolveClaudeExecModelId } from "../utils/claudeModel";
import { resolveCodexResumeSessionId } from "../utils/codexSessionId";
import { resolveOpencodeResumeSessionId } from "../utils/opencodeSessionId";
import { resolveQoderResumeSessionId } from "../utils/qoderSessionId";
import { getCachedModelProfileStore } from "../stores/modelProfileStoreCache";
import {
  WISE_CLAUDE_USER_SETTINGS_CHANGED,
  type ClaudeUserSettingsChangedDetail,
} from "../services/claudeModelProfiles";
import { buildClaudeModelSwitchReconnectPlan } from "../utils/claudeModelProfileReconnect";
import { resolveCursorResumeAgentId } from "../utils/cursorAgentId";
import {
  loadDefaultClaudeConnectionKind,
  applyTabConnectionKindOverride,
  applyTabUltracodeOverride,
  normalizeClaudeConnectionKind,
  resolveSessionConnectionKind,
  sessionUsesStreamingConnection,
  WISE_CLAUDE_CONNECTION_KIND_CHANGED,
  type ClaudeSessionConnectionKind,
} from "../constants/claudeConnection";
import type { ClaudeSpawnCliExtras } from "../services/claudeSpawnExtras";
import { claudeSpawnExtrasForNativeSlashCommand } from "../services/claudeSpawnExtras";
import { deleteClaudeDiskSession, loadClaudeSessionJsonl, loadCodexRpcSessionJsonl } from "../services/claudeDisk";
import { loadCursorSessionJsonl } from "../services/cursorDisk";
import {
  collectInvocationSnapshotMemoryKeys,
  pruneInvocationSnapshotMemory,
} from "../services/backgroundInvocationSnapshot";
import { normalizeRepositoryPathKey, repositoryPathsMatch } from "../utils/repositoryMainSessionBinding";
import { isClaudeNativeSlashCommandText } from "../utils/composerLocalSlashCommand";
import { pathIsAccessibleDirectoryCached } from "../utils/pathAccessibilityCache";
import {
  listClaudeDiskSessionsForRepositoryScope,
  normalizeSessionRepositoryPath,
} from "../utils/sessionHistoryScope";
import { loadSessionTabsState, saveSessionTabsState } from "../services/tabsStore";
import { getAppSetting, setAppSetting } from "../services/appSettingsStore";
import {
  CLAUDE_DISK_JSONL_TAIL_LINES_LAZY,
  CLAUDE_DISK_JSONL_TAIL_LINES_RELOAD,
  IN_MEMORY_SESSION_MESSAGES_MAX,
  PERSIST_SESSION_MESSAGES_MAX,
} from "../constants/claudeMessageListWindow";
import { claudeStreamEvent } from "../constants/claudeStreamEvents";
import {
  getActiveSessionTurnIdsSnapshot,
  observeSessionTurnStatus,
  pruneSessionTurns,
} from "../stores/sessionTurnStore";
import { runWhenIdle } from "../utils/deferIdle";
import { readVisiblePollIntervalMs, startAdaptiveInterval } from "../utils/adaptivePoll";
import { isCurrentPrimaryMainWorkspaceWindowSync } from "../services/mainWindow";
import { wiseNotificationIngestWithPet } from "../services/wiseMascot";
import {
  buildQuestionFallbackUserPrompt,
  buildQuestionResumeUserPrompt,
  hasLiveStreamingClaudeProcess,
  isOneshotBootstrapPendingError,
  isQuestionStdinUnavailableError,
  isToolUseQuestionRequestId,
  QUESTION_BOOTSTRAP_PENDING_SENTINEL,
  shouldDeliverQuestionViaResume,
  shouldUseProxyQuestionResumeDelivery,
} from "../utils/questionControlDelivery";
import {
  buildPermissionStdinLine,
  buildQuestionStdinLine,
  ingestAskUserQuestionFromMessageParts,
  extractLatestTodoWriteFromMessages,
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
import { extractRecentTurnFailureError } from "../utils/claudeSessionTurnFailure";
import { createClaudeTurnCompleteWaiter } from "../utils/claudeTurnCompleteWaiter";
import { notificationBodyPrefixInRepositoryContext } from "../utils/sessionRepositoryDisplay";
import {
  buildClaudeTurnCompleteNotificationBody,
  shouldIngestWiseNotificationForClaudeTurnComplete,
} from "../utils/claudeTurnNotificationBody";
import { getWorkflowFacade } from "../services/workflow";
import {
  resolveEffectiveAutoApproveMode,
  subscribeAutoApproveSettings,
} from "../services/autoApproveSettings";
import {
  decidePermissionAutoApprove,
  decideQuestionAutoApprove,
} from "../utils/autoApproveDecide";
import {
  appendSystemMessageBySessionId,
  applyClaudeExecuteFailureNotice,
  appendUserMessageBySessionOrClaudeId,
  reconcileSessionStatusesWithRunningRegistry,
  setSessionRunningWithUserPrompt,
} from "../services/claudeSessionState";
import { markSessionToolUseStopped } from "../utils/sessionConversationTasks";
import { isTerminalWorkerWiseTab, sanitizeTerminalWorkerTranscriptMessages, waitForTerminalWorkerTurnStarted } from "../services/terminalDispatch";
import { isExecutionEnvironmentWorkerRepositoryName } from "../utils/executionEnvironmentDispatch";
import { isFeedbackLoopWorkerRepositoryName } from "../utils/sessionFeedbackLoopDispatch";
import {
  resolveDiskTranscriptSessionKey,
  resolveDiskTranscriptSource,
  sessionHasDiskTranscript,
  sessionMessagesSafeToDropForDiskReload,
  type DiskTranscriptSource,
} from "../utils/sessionExecutionEngine";
import { findSessionByTabOrClaudeId } from "../utils/claudeSessionSelection";
import { bumpSessionCreatedAtForSortActivity } from "../components/ClaudeSessions/sessionGrouping";
import { retainSessionListPreviewOnMessageDrop } from "../utils/sessionListPreview";
import {
  findSessionForMonitorDrawerResume,
  materializeWorkerTabSession,
} from "../utils/sessionExecuteResolve";
import { createClaudeStreamRuntime } from "../services/claudeStreamRuntime";
import { setBackgroundContextCompactInFlight } from "../stores/backgroundContextCompactStore";
import { migrateComposerRefocus } from "../stores/composerRefocusStore";
import { stopClaudeMainSession } from "../services/stopClaudeMainSession";
import { publishRunningClaudeSessionIds } from "../stores/claudeRunningSessionsRegistryStore";
import {
  getSystemResourceClaudeProcesses,
  refreshSystemResourceSnapshotStore,
  subscribeSystemResourceSnapshot,
} from "../stores/systemResourceSnapshotStore";
import {
  buildContextOverflowFailureHint,
  buildContextOverflowRetrySystemMessage,
  CLAUDE_COMPACT_SLASH_PROMPT,
  COMPRESS_NOTICE_DEBOUNCE_MS,
  composeCompactNoticeTokens,
  CONTEXT_BACKGROUND_COMPACT_COOLDOWN_MS,
  getSessionContextMetrics,
  isCompactSlashPrompt,
  looksLikeContextOverflowError,
  planAutoCompactBeforeSend,
  planBackgroundAutoCompact,
  resolveSessionContextMetricsForSend,
} from "../services/claudeSessionContext";
import {
  applyModelProfileFailover,
  resolveModelProfileEngineForExecution,
} from "../services/modelProfileFailover";
import { isRetryableModelApiError } from "../utils/retryableModelApiError";
import {
  applyDiskTranscriptTail as applyDiskTranscriptTailHelper,
  loadMoreTranscriptByKey,
  reloadFullDiskTranscriptByKey,
  resolveTerminalWorkerMessagesAfterDiskLoad,
  latestTerminalTurnHasAssistant,
  latestTurnHasVisibleAssistantContent,
  shouldPreserveMemoryTranscriptOverDisk,
  terminalDiskTranscriptRecoveredStatus,
} from "./useClaudeSessions.transcript";
import { CLAUDE_NO_VISIBLE_REPLY_FAILURE_HINT } from "../utils/claudeTurnCompleteGate";
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
import { createClaudeEngineHandlers } from "./useClaudeSessions.engines";
import { createSessionActionHandlers } from "./useClaudeSessions.sessionActions";

import {
  CLAUDE_STREAM_STALL_HOOK_EXTEND_MS,
  CLAUDE_STREAM_STALL_MS,
  CODEX_STREAM_STALL_MS,
  CONTROL_REQUEST_EXPIRE_MS,
  CURSOR_STREAM_STALL_MS,
  WORKFLOW_BINDING_STORAGE_KEY,
  attachClaudeSessionStreamForTurn,
  shouldKeepClaudeInvocationStreamAfterTurnComplete,
  collectClaudeSessionSidecarIds,
  generateId,
  hydrateStreamingProcessRegistryFromHost,
  markClaudeRegistryBootstrapWarmup,
  mergeRepositoryDiskSessions,
  collectDiskMergeTabIdMigrations,
  mergePersistedTabsWithLocalBackup,
  modelsForRepositoryPaths,
  persistWorkflowBindings,
  pruneClaudeRegistryBootstrapWarmup,
  pruneGhostRepositorySessions,
  pruneRepoDiskIndexSessions,
  purgeClaudeSessionStreamSidecarRefs,
  resolveTabIdForClaudeStream,
  resolveTabIdFromCompletePayload,
  sessionHasHookSystemActivity,
  sessionHasVisibleStreamProgress,
  type ClaudeStreamRuntimeHandlers,
} from "./useClaudeSessions.helpers";
import {
  publishClaudeSessions,
  subscribeClaudeSessionsLive,
  subscribeClaudeSessionsStructure,
  getClaudeSessionsSnapshot,
  getClaudeSessionSnapshot,
  getClaudeSessionsStructureKey,
} from "../stores/claudeSessionsLiveStore";
import { setSessionTranscriptHydrating } from "../stores/claudeTranscriptHydrationStore";
import type {
  PendingTurnFailoverContext,
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

  // 同步 ref：disk merge 等异步回调需读最新 companion 集合，避免闭包滞后或重建 callback。
  const companionSessionIdsRef = useRef<ReadonlySet<string>>(new Set());
  companionSessionIdsRef.current = new Set(companionSessionIds);

  const companionMemoryLimits = useMemo(
    () => ({
      companionMax: resolveCompanionSessionMessagesMax(companionSessionIds.length),
      globalBudget: resolveGlobalMessagesBudget(companionSessionIds.length),
    }),
    [companionSessionIds.length, companionSessionIdsJoinKey],
  );

  const subscribeLive = options?.subscribeLive !== false;
  const subscribeSessions = subscribeLive
    ? subscribeClaudeSessionsLive
    : subscribeClaudeSessionsStructure;

  const sessions = useSyncExternalStore(
    subscribeSessions,
    getClaudeSessionsSnapshot,
    getClaudeSessionsSnapshot,
  );
  const sessionsStructureKey = useSyncExternalStore(
    subscribeClaudeSessionsStructure,
    getClaudeSessionsStructureKey,
    getClaudeSessionsStructureKey,
  );
  const sessionsRef = useRef(sessions);
  // commitSessions / createSession 会同步写入 ref；仅在结构订阅推进时从 store 对齐，避免 subscribeLive:false 下每帧用陈旧 sessions 覆盖派发中的 worker 状态。
  useEffect(() => {
    sessionsRef.current = getClaudeSessionsSnapshot();
  }, [sessionsStructureKey]);
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
      // 派发执行环境 / 反馈循环 worker：完成后消息也不应被全局内存预算清零，
      // 否则运行面板派发任务详情抽屉会退化到 prompt-only（助手正文消失、找不到）。
      // 三类引擎（codex/opencode/claude code）均经执行环境派发，此处统一保留。
      if (
        isExecutionEnvironmentWorkerRepositoryName(session.repositoryName ?? "") ||
        isFeedbackLoopWorkerRepositoryName(session.repositoryName ?? "")
      ) {
        keep.add(session.id);
      }
    }
    return keep;
  }, []);

  const setSessions = useCallback((action: SetStateAction<ClaudeSession[]>) => {
    const prev = sessionsRef.current;
    const next = typeof action === "function" ? action(prev) : action;
    if (next === prev) return;
    const capped = applySessionsMemoryCap(next, {
      keepSessionIds: buildMemoryKeepSessionIds(next),
      globalMessagesBudget: companionMemoryLimits.globalBudget,
    });
    if (capped === prev) return;
    // 被全局预算裁剪清零的 session 需清其 diskLoadDone 标记。原实现逐 row 在 prev 里 find 为 O(n²)，
    // 流式期间 commitSessions 每帧高频触发、sessions 多时（多 tab/worker/派发）平方膨胀致卡顿。
    // capped 仅对被裁剪的 session 产生新对象，其余引用与 prev 相同；先用 messages.length!==0 跳过绝大多数 row，
    // 再用 id→session 索引 O(1) 查 prev，整体降到 O(n)，行为与原逻辑等价。
    const prevById = new Map<string, ClaudeSession>();
    for (const prevRow of prev) prevById.set(prevRow.id, prevRow);
    // 状态提交是所有会话状态变化的唯一漏斗，因此也是推进轮次生命周期的唯一观察点：
    // 无需渲染、无需轮询。只在存在活跃轮次时做这次遍历。
    const activeTurnIds = getActiveSessionTurnIdsSnapshot();
    for (const row of capped) {
      if (activeTurnIds.has(row.id)) {
        observeSessionTurnStatus(row.id, row.status === "running" || row.status === "connecting");
      }
      if (row.messages.length !== 0) continue;
      const prevRow = prevById.get(row.id);
      if (prevRow && prevRow.messages.length > 0) {
        diskLoadDoneRef.current.delete(row.id);
      }
    }
    sessionsRef.current = capped;
    publishClaudeSessions(capped);
  }, [buildMemoryKeepSessionIds, companionMemoryLimits.globalBudget]);
  /** 流式事件可能在同一帧连发多行；须在 `setSessions` updater 内同步 ref，避免 init 后 assistant 行因 ref 过期被丢弃。 */
  const commitSessions = useCallback((updater: (prev: ClaudeSession[]) => ClaudeSession[]) => {
    setSessions(updater);
  }, [setSessions]);
  const onClaudeTurnCompleteRef = useRef(options?.onClaudeTurnComplete);
  onClaudeTurnCompleteRef.current = options?.onClaudeTurnComplete;
  const onSessionTabIdMigratedRef = useRef(options?.onSessionTabIdMigrated);
  onSessionTabIdMigratedRef.current = options?.onSessionTabIdMigrated;
  const claudeSessionsOptionsRef = useRef(options);
  claudeSessionsOptionsRef.current = options;
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const modelSwitchReconnectInFlightRef = useRef(false);
  const lastModelSwitchReconnectKeyRef = useRef<string | null>(null);
  const lastModelSwitchReconnectAtRef = useRef(0);

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
  /** 防止同一会话在极短时间内重复追加相同用户气泡（双触发发送兜底）。 */
  const recentExecutePromptBySessionRef = useRef<Map<string, { prompt: string; at: number }>>(
    new Map(),
  );
  const pendingTurnFailoverRef = useRef<PendingTurnFailoverContext | null>(null);
  const turnCompleteWaiterRef = useRef(createClaudeTurnCompleteWaiter());
  const contextOverflowCompactRetriedNonceRef = useRef<Map<string, number>>(new Map());
  /** `/compact` 中间回合成功时勿清空 pendingTurnFailoverRef（用户正文尚未重发）。 */
  const compactTurnInFlightRef = useRef<{ tabId: string; nonce: number } | null>(null);
  interface BackgroundCompactState {
    inFlight?: Promise<void>;
    lastAttemptAtMs?: number;
    lastSuccessAtMs?: number;
  }
  const backgroundCompactStateRef = useRef<Map<string, BackgroundCompactState>>(new Map());
  /** 发送前判定需要压缩时，登记于此，等当前 user turn 收尾后再 fire background。 */
  const deferredBackgroundCompactRef = useRef<Map<string, { turnNonce: number; scheduledAtMs: number }>>(
    new Map(),
  );
  const scheduleBackgroundContextCompactRef = useRef<
    (sessionId: string, opts?: { delayMs?: number }) => void
  >(() => {});
  const attemptTurnFailoverAndRetryRef = useRef<
    (ctx: PendingTurnFailoverContext, errorPreview: string) => Promise<boolean>
  >(async () => false);
  const attemptContextOverflowCompactAndRetryRef = useRef<
    (ctx: PendingTurnFailoverContext) => Promise<boolean>
  >(async () => false);
  /** Which session tab receives stdout until `claude-complete` / `claude-error`. */
  const streamingTargetIdRef = useRef<string | null>(null);
  /** 多屏模式标记：companionSessionIds 非空时为 true，供 stream runtime 全局通道回调禁用 refTid 兜底路由，防多屏串屏。 */
  const isMultiPaneRef = useRef(false);
  isMultiPaneRef.current = companionSessionIds.length > 0;
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
  const defaultConnectionKindRef = useRef<ClaudeSessionConnectionKind>("oneshot");
  const streamStallTimerByTabRef = useRef<Map<string, number>>(new Map());
  /** 已对「Hook 进行中」放过一次 45s 宽限的标签 */
  const streamStallHookExtendedByTabRef = useRef<Set<string>>(new Set());
  const recentHookActivityByTabRef = useRef<Map<string, number>>(new Map());
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
  const diskHydrateInFlightRef = useRef<Set<string>>(new Set());
  const diskTailLinesBySessionRef = useRef(new Map<string, number>());
  const claudeConfigModelByRepoPathRef = useRef<Map<string, string | null>>(new Map());
  const pruneLiveSessionSidecarsRef = useRef<(liveSessions: readonly ClaudeSession[]) => boolean>(() => false);
  /** Tauri 主窗口是否在前台（与 `document.hidden` 组合判断 Phase 4 桌面摘要）。 */
  const mainWinFocusedRef = useRef(true);
  /** 供 stream runtime `notifyCompletion` 在 AskUserQuestion 等待续答时挂载 session 通道监听。 */
  const prepareStreamingControlResponseListenerRef = useRef<
    (tabSessionId: string, claudeSessionId: string, turnNonce?: number) => Promise<void>
  >(() => Promise.resolve());

  /** 追踪最新会话 tabs 状态，供 beforeunload 同步刷写时取最新快照 */
  const latestTabsForSaveRef = useRef({ sessions, activeSessionId, tabsHydrated });
  latestTabsForSaveRef.current = { sessions, activeSessionId, tabsHydrated };
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
          sessionHasHookSystemActivity(session, recentHookActivityByTabRef.current) &&
          !streamStallHookExtendedByTabRef.current.has(key)
        ) {
          streamStallHookExtendedByTabRef.current.add(key);
          const extendTimer = window.setTimeout(fireStallCheck, CLAUDE_STREAM_STALL_HOOK_EXTEND_MS);
          streamStallTimerByTabRef.current.set(key, extendTimer);
          return;
        }
        const stallMessage =
          engine === "cursor"
            ? "Cursor Agent 长时间无可见输出。请点「结束」后重试，或检查 API Key / agent login 与网络连接。"
            : engine === "codex" || engine === "codex-rpc"
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
      const stallMs =
        engine === "cursor"
          ? CURSOR_STREAM_STALL_MS
          : engine === "codex" || engine === "codex-rpc"
            ? CODEX_STREAM_STALL_MS
            : CLAUDE_STREAM_STALL_MS;
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

  const keepInvocationStreamAfterTurnComplete = useCallback((tabId: string) => {
    return shouldKeepClaudeInvocationStreamAfterTurnComplete({
      tabId,
      sessions: sessionsRef.current,
      streamingProcessByTab: streamingProcessByTabRef.current,
      claudeInvocationInflight: claudeInvocationInflightRef.current,
      defaultConnectionKind: defaultConnectionKindRef.current,
    });
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
    // Cursor ACP: session/cancel on the persistent process (kill-child alone is insufficient).
    try {
      const { interruptCursorAcp } = await import("../services/cursorAcp");
      await interruptCursorAcp(tabSessionId);
    } catch {
      /* no active ACP session for this tab */
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

  const applySessionTabIdMigration = useCallback(
    (fromTabId: string, toClaudeSessionId: string) => {
      const from = fromTabId.trim();
      const to = toClaudeSessionId.trim();
      if (!from || !to || from === to) return;
      markClaudeRegistryBootstrapWarmup(registryBootstrapDeadlineByClaudeSidRef, to);
      const nonceMap = expectedTurnNonceByTabIdRef.current;
      const pendingNonce = nonceMap.get(from);
      if (pendingNonce !== undefined) {
        nonceMap.delete(from);
        nonceMap.set(to, pendingNonce);
      }
      migrateClaudeInvocationTabId(from, to);
      const streamingEntry = streamingProcessByTabRef.current.get(from);
      if (streamingEntry) {
        streamingProcessByTabRef.current.set(from, {
          claudeSessionId: to,
        });
      }
      if (activeSessionIdRef.current === from) {
        setActiveSessionId(to);
      }
      onSessionTabIdMigratedRef.current?.(from, to);
    },
    [migrateClaudeInvocationTabId],
  );

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
      source?: DiskTranscriptSource,
    ): Promise<string[]> => {
      const rp = session.repositoryPath?.trim();
      if (!rp || !diskKey.trim()) return [];
      const target =
        source ?? resolveDiskTranscriptSource(resolveSessionExecutionEngine(session));
      if (target === "cursor") {
        return loadCursorSessionJsonl(rp, diskKey, {
          tailLines: tailLines ?? null,
        });
      }
      if (target === "codex_rpc") {
        return loadCodexRpcSessionJsonl(rp, diskKey, {
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

  const resolveSpawnExtrasForClaudePrompt = useCallback(
    async (tabSessionId: string, prompt: string): Promise<ClaudeSpawnCliExtras | null> => {
      const extras = await resolveSpawnExtrasForTab(tabSessionId);
      if (!isClaudeNativeSlashCommandText(prompt)) return extras;
      return claudeSpawnExtrasForNativeSlashCommand(extras);
    },
    [resolveSpawnExtrasForTab],
  );

  const {
    runCodexOneshotWithInvocation,
    runCodexRpcOneshotWithInvocation,
    runOpencodeOneshotWithInvocation,
    runQoderOneshotWithInvocation,
    runCursorOneshotWithInvocation,
    invokeClaudeTurn,
  } = useMemo(
    () =>
      createClaudeEngineHandlers({
        streamRuntimeRef,
        sessionIdMapRef,
        sessionsRef,
        claudeInvocationInflightRef,
        expectedTurnNonceByTabIdRef,
        streamingProcessByTabRef,
        streamingTargetIdRef,
        defaultConnectionKindRef,
        claudeSessionsOptionsRef,
        detachClaudeInvocationStreamsForTab,
        keepInvocationStreamAfterTurnComplete,
        resolveSpawnExtrasForClaudePrompt,
        commitSessions,
        scheduleStreamStallTimer,
      }),
    [
      detachClaudeInvocationStreamsForTab,
      keepInvocationStreamAfterTurnComplete,
      resolveSpawnExtrasForClaudePrompt,
      commitSessions,
      scheduleStreamStallTimer,
    ],
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
        streamStallHookExtendedByTab: streamStallHookExtendedByTabRef.current,
        recentExecutePromptBySession: recentExecutePromptBySessionRef.current,
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
    const liveTabIds = new Set(liveSessions.map((session) => session.id));
    if (pruneSessionTurns(liveTabIds)) {
      sidecarChanged = true;
    }
    notificationHub.pruneOrphanSessions(liveTabIds);
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
    turnCompleteWaiterRef.current.clear(sessionId);
    contextOverflowCompactRetriedNonceRef.current.delete(sessionId);
    if (claudeSessionId?.trim()) {
      turnCompleteWaiterRef.current.clear(claudeSessionId.trim());
      contextOverflowCompactRetriedNonceRef.current.delete(claudeSessionId.trim());
    }
    if (compactTurnInFlightRef.current?.tabId === sessionId) {
      compactTurnInFlightRef.current = null;
    }
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

  const appendContextOverflowFailureHint = useCallback(
    (tabSessionId: string) => {
      commitSessions((prev) =>
        appendSystemMessageBySessionId(
          prev.map((s) => (s.id === tabSessionId ? { ...s, status: "error" as const } : s)),
          tabSessionId,
          buildContextOverflowFailureHint(),
        ),
      );
    },
    [commitSessions],
  );

  /**
   * 写入「压缩进行中」sysmsg：同会话相邻 COMPRESS_NOTICE_DEBOUNCE_MS 内同文本直接跳过。
   * 避免 auto-compact / context-overflow / 手动 /compact / composer 本地斜杠派发同时
   * 写多条「正在压缩…」同语义消息。
   */
  const appendCompactNotice = useCallback(
    (tabSessionId: string, sysmsg: string, nowMs: number = Date.now()) => {
      const trimmed = sysmsg.trim();
      if (!trimmed) return;
      const last = sessionsRef.current
        .find((s) => s.id === tabSessionId)
        ?.messages.filter((m) => m.role === "system")
        .pop();
      if (last && last.content.trim() === trimmed) {
        const age = nowMs - last.timestamp;
        if (age >= 0 && age <= COMPRESS_NOTICE_DEBOUNCE_MS) {
          return;
        }
      }
      commitSessions((prev) =>
        appendSystemMessageBySessionId(prev, tabSessionId, sysmsg),
      );
    },
    [commitSessions],
  );

  const runCompactTurnAndWait = useCallback(
    async (params: {
      tabSessionId: string;
      turnNonce: number;
      runOnce: (outbound: string) => Promise<void>;
      reloadAfterCompact?: () => Promise<void>;
      systemMessage?: string;
    }) => {
      const { tabSessionId, turnNonce, runOnce, reloadAfterCompact, systemMessage } = params;
      if (systemMessage) {
        appendCompactNotice(tabSessionId, systemMessage);
      }
      compactTurnInFlightRef.current = { tabId: tabSessionId, nonce: turnNonce };
      await runOnce(CLAUDE_COMPACT_SLASH_PROMPT);
      await turnCompleteWaiterRef.current.wait(tabSessionId, turnNonce);
      if (reloadAfterCompact) {
        await reloadAfterCompact();
      }
    },
    [appendCompactNotice],
  );

  const flushBlockingDesktopIfHidden = useCallback(() => {
    if (typeof document === "undefined") return;
    if (!document.hidden && mainWinFocusedRef.current) return;
    for (const s of sessionsRef.current) {
      const slice = notificationHub.getDockSlice(s.id);
      const conv = s.claudeSessionId ?? s.id;
      const prefix = notificationBodyPrefixInRepositoryContext(s.repositoryName ?? "");
      if (slice.permissionRequest) {
        const pr = slice.permissionRequest;
        void wiseNotificationIngestWithPet({
          conversationId: conv,
          body: `${prefix}权限待确认: ${pr.tool}`,
          serverMsgId: `hub-pending-perm:${s.id}:${pr.id}`,
          source: "permission",
          title: pr.tool,
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
            const isTerminalWorker = isTerminalWorkerWiseTab(sess);
            const sanitizedDisk = isTerminalWorker
              ? sanitizeTerminalWorkerTranscriptMessages(messages)
              : messages;
            const nextMessages = isTerminalWorker
              ? resolveTerminalWorkerMessagesAfterDiskLoad(sess, sanitizedDisk)
              : sanitizedDisk;
            if (!nextMessages) return sess;
            if (shouldPreserveMemoryTranscriptOverDisk(sess, sanitizedDisk)) {
              return sess;
            }
            if (
              !isTerminalWorker &&
              (sess.status === "running" || sess.status === "connecting") &&
              latestTurnHasVisibleAssistantContent(sess.messages) &&
              !latestTurnHasVisibleAssistantContent(sanitizedDisk)
            ) {
              return sess;
            }
            diskTailLinesBySessionRef.current.set(sess.id, CLAUDE_DISK_JSONL_TAIL_LINES_RELOAD);
            const batch = extractLatestTodoWriteFromMessages(nextMessages);
            if (batch) {
              notificationHub.applyTodoWrite(sess.id, batch.items, batch.merge);
            }
            const hasAssistant = latestTerminalTurnHasAssistant(nextMessages);
            const recoveredMessages =
              isTerminalWorker && hasAssistant
                ? nextMessages.filter(
                    (message) =>
                      !(
                        message.role === "system" &&
                        (typeof message.content === "string"
                          ? message.content
                          : ""
                        ).includes(CLAUDE_NO_VISIBLE_REPLY_FAILURE_HINT)
                      ),
                  )
                : nextMessages;
            return {
              ...sess,
              messages: recoveredMessages,
              diskTranscriptPartial,
              transcriptMemoryUnlimited: false,
              status: isTerminalWorker
                ? terminalDiskTranscriptRecoveredStatus(sess.status, hasAssistant, true)
                : sess.status,
            };
          }),
        );
      } catch {
        /* 落盘略晚或路径异常时不打断用户 */
      }
    },
    [setSessions],
  );

  const maybeRunBackgroundContextCompact = useCallback(
    async (sessionId: string): Promise<void> => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session) return;

      const engineResolver = claudeSessionsOptionsRef.current?.resolveExecutionEngineRef?.current;
      if (engineResolver?.(session) !== "claude") return;

      if (session.status === "running" || session.status === "connecting") return;

      const claudeSessionId =
        session.claudeSessionId?.trim() ?? sessionIdMapRef.current.get(sessionId)?.trim();
      if (!claudeSessionId) return;

      if (compactTurnInFlightRef.current?.tabId === sessionId) return;

      const stateMap = backgroundCompactStateRef.current;
      const prevState = stateMap.get(sessionId);
      if (prevState?.inFlight) {
        await prevState.inFlight.catch(() => undefined);
        return;
      }

      const now = Date.now();
      if (
        prevState?.lastAttemptAtMs != null &&
        now - prevState.lastAttemptAtMs < CONTEXT_BACKGROUND_COMPACT_COOLDOWN_MS
      ) {
        return;
      }

      let metrics;
      try {
        metrics = await resolveSessionContextMetricsForSend(session, loadClaudeSessionJsonl);
      } catch {
        return;
      }

      const plan = planBackgroundAutoCompact(
        session,
        metrics,
        stateMap.get(sessionId)?.lastSuccessAtMs ?? null,
      );
      if (!plan.needed) return;

      const run = async (): Promise<void> => {
        setBackgroundContextCompactInFlight(sessionId, true);
        const turnNonce = ++streamTurnSeqRef.current;
        lastUserSendNonceRef.current = turnNonce;
        expectedTurnNonceByTabIdRef.current.set(sessionId, turnNonce);
        markClaudeRegistryBootstrapWarmup(registryBootstrapDeadlineByClaudeSidRef, claudeSessionId);
        streamingTargetIdRef.current = sessionId;
        compactTurnInFlightRef.current = { tabId: sessionId, nonce: turnNonce };

        const invokeConc =
          claudeSessionsOptionsRef.current?.claudeConcurrencyInvokeContextRef?.current?.(session) ??
          null;
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
          const result = await turnCompleteWaiterRef.current.wait(sessionId, turnNonce);
          if (result.success) {
            await reloadTranscriptFromDisk({
              tabId: sessionId,
              repositoryPath: session.repositoryPath,
              claudeSessionId,
            });
            const current = stateMap.get(sessionId) ?? {};
            current.lastSuccessAtMs = Date.now();
            stateMap.set(sessionId, current);
          }
        } catch {
          /* 后台压缩失败时不打扰用户；发送前仍会兜底 */
        } finally {
          setBackgroundContextCompactInFlight(sessionId, false);
          if (compactTurnInFlightRef.current?.tabId === sessionId) {
            compactTurnInFlightRef.current = null;
          }
        }
      };

      const state: BackgroundCompactState = {
        ...(prevState ?? {}),
        lastAttemptAtMs: now,
        inFlight: run(),
      };
      stateMap.set(sessionId, state);
      try {
        await state.inFlight;
      } finally {
        const current = stateMap.get(sessionId);
        if (current && current.inFlight === state.inFlight) {
          stateMap.set(sessionId, {
            lastAttemptAtMs: current.lastAttemptAtMs,
            lastSuccessAtMs: current.lastSuccessAtMs,
          });
        }
      }
    },
    [commitSessions, invokeClaudeTurn, reloadTranscriptFromDisk],
  );

  const scheduleBackgroundContextCompact = useCallback(
    (sessionId: string, opts?: { delayMs?: number }) => {
      runWhenIdle(() => {
        void maybeRunBackgroundContextCompact(sessionId);
      }, { timeoutMs: opts?.delayMs ?? 400 });
    },
    [maybeRunBackgroundContextCompact],
  );

  useEffect(() => {
    scheduleBackgroundContextCompactRef.current = scheduleBackgroundContextCompact;
  }, [scheduleBackgroundContextCompact]);

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

  const attemptContextOverflowCompactAndRetry = useCallback(
    async (ctx: PendingTurnFailoverContext): Promise<boolean> => {
      const tabId = ctx.tabSessionId;
      const nonce = ctx.turnNonce;
      if (contextOverflowCompactRetriedNonceRef.current.get(tabId) === nonce) {
        pendingTurnFailoverRef.current = null;
        return false;
      }
      const claudeSid = ctx.forceNewClaudeConversation ? null : ctx.resumeClaudeSid?.trim();
      if (!claudeSid) {
        pendingTurnFailoverRef.current = null;
        return false;
      }

      contextOverflowCompactRetriedNonceRef.current.set(tabId, nonce);
      const waiter = turnCompleteWaiterRef.current;

      const overflowMetrics = getSessionContextMetrics(
        sessionsRef.current.find((s) => s.id === tabId) ??
          ({
            id: tabId,
            messages: [],
          } as unknown as ClaudeSession),
      );
      appendCompactNotice(
        tabId,
        buildContextOverflowRetrySystemMessage(overflowMetrics),
      );
      commitSessions((prev) =>
        prev.map((s) =>
          s.id === tabId ? { ...s, status: "running" as const } : s,
        ),
      );
      scheduleStreamStallTimer(tabId);
      streamingTargetIdRef.current = tabId;

      const invokeTurn = async (outbound: string, compactIntermediate = false) => {
        if (compactIntermediate) {
          compactTurnInFlightRef.current = { tabId, nonce };
        }
        await invokeClaudeTurn({
          tabSessionId: tabId,
          turnNonce: nonce,
          invokeConc: ctx.invokeConc,
          repositoryPath: ctx.repositoryPath,
          prompt: outbound,
          modelArg: ctx.modelArg,
          resumeClaudeSid: claudeSid,
          cursorAttachments: ctx.cursorAttachments,
          codexContextExecutionEngine: ctx.codexContextExecutionEngine,
          forceNewClaudeConversation: ctx.forceNewClaudeConversation,
        });
        return waiter.wait(tabId, nonce);
      };

      const reloadCompactTranscript = async () => {
        const rp = ctx.repositoryPath.trim();
        if (!rp) return;
        await reloadTranscriptFromDisk({ tabId, repositoryPath: rp, claudeSessionId: claudeSid });
      };

      try {
        const compactResult = await invokeTurn(CLAUDE_COMPACT_SLASH_PROMPT, true);
        await reloadCompactTranscript();
        if (!compactResult.success) {
          pendingTurnFailoverRef.current = null;
          appendContextOverflowFailureHint(tabId);
          return false;
        }
        const retryResult = await invokeTurn(ctx.prompt);
        if (!retryResult.success) {
          pendingTurnFailoverRef.current = null;
          appendContextOverflowFailureHint(tabId);
          return false;
        }
        pendingTurnFailoverRef.current = null;
        return true;
      } catch {
        pendingTurnFailoverRef.current = null;
        appendContextOverflowFailureHint(tabId);
        return false;
      }
    },
    [
      appendCompactNotice,
      appendContextOverflowFailureHint,
      commitSessions,
      invokeClaudeTurn,
      reloadTranscriptFromDisk,
      scheduleStreamStallTimer,
    ],
  );

  useEffect(() => {
    attemptContextOverflowCompactAndRetryRef.current = attemptContextOverflowCompactAndRetry;
  }, [attemptContextOverflowCompactAndRetry]);

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

      const resolver = claudeSessionsOptionsRef.current?.resolveExecutionEngineRef?.current;
      const resolvedEngine = resolver?.(session);
      if (resolvedEngine === "codex" || resolvedEngine === "codex-rpc") {
        const contextExecutionEngine =
          params.codexContextExecutionEngine ?? resolvedEngine;
        if (params.forceNewClaudeConversation) {
          setSessions((prev) =>
            prev.map((s) => (s.id === tabSessionId ? { ...s, claudeSessionId: null } : s)),
          );
          sessionIdMapRef.current.delete(tabSessionId);
        }
        const codexResumeSessionId = params.forceNewClaudeConversation
          ? null
          : resolveCodexResumeSessionId(session, tabSessionId, sessionIdMapRef.current);
        if (resolvedEngine === "codex-rpc") {
          // 主发送路径此前误走 Codex CLI，导致不写 ~/.wise/codex-runs，刷新后无法 hydrate。
          await runCodexRpcOneshotWithInvocation({
            tabSessionId,
            turnNonce: params.turnNonce,
            repositoryPath,
            prompt,
            modelArg: params.modelArg,
            contextExecutionEngine,
            codexResumeSessionId,
          });
          return;
        }
        await runCodexOneshotWithInvocation({
          tabSessionId,
          turnNonce: params.turnNonce,
          repositoryPath,
          prompt,
          modelArg: params.modelArg,
          contextExecutionEngine,
          codexResumeSessionId,
          forceNewClaudeConversation: params.forceNewClaudeConversation,
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
      if (resolver?.(session) === "opencode") {
        const contextExecutionEngine =
          params.codexContextExecutionEngine ?? resolver(session);
        if (params.forceNewClaudeConversation) {
          setSessions((prev) =>
            prev.map((s) => (s.id === tabSessionId ? { ...s, claudeSessionId: null } : s)),
          );
          sessionIdMapRef.current.delete(tabSessionId);
        }
        const opencodeResumeSessionId = params.forceNewClaudeConversation
          ? null
          : resolveOpencodeResumeSessionId(session, tabSessionId, sessionIdMapRef.current);
        await runOpencodeOneshotWithInvocation({
          tabSessionId,
          turnNonce: params.turnNonce,
          repositoryPath,
          prompt,
          modelArg: params.modelArg,
          contextExecutionEngine,
          opencodeResumeSessionId,
          forceNewClaudeConversation: params.forceNewClaudeConversation,
        });
        return;
      }
      if (resolver?.(session) === "qoder") {
        if (params.forceNewClaudeConversation) {
          setSessions((prev) =>
            prev.map((s) => (s.id === tabSessionId ? { ...s, claudeSessionId: null } : s)),
          );
          sessionIdMapRef.current.delete(tabSessionId);
        }
        const qoderResumeSessionId = params.forceNewClaudeConversation
          ? null
          : resolveQoderResumeSessionId(session, tabSessionId, sessionIdMapRef.current);
        await runQoderOneshotWithInvocation({
          tabSessionId,
          turnNonce: params.turnNonce,
          repositoryPath,
          prompt,
          modelArg: params.modelArg,
          qoderResumeSessionId,
          forceNewClaudeConversation: params.forceNewClaudeConversation,
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

      const turnNonce = invokeRest.turnNonce;
      const waitTurnComplete = () => turnCompleteWaiterRef.current.wait(tabSessionId, turnNonce);

      const bgState = backgroundCompactStateRef.current.get(tabSessionId);
      if (bgState?.inFlight) {
        await bgState.inFlight.catch(() => undefined);
      }

      const metrics = await resolveSessionContextMetricsForSend(session, loadClaudeSessionJsonl);
      const refreshedBgState = backgroundCompactStateRef.current.get(tabSessionId);
      const pre = planAutoCompactBeforeSend(
        session,
        prompt,
        metrics,
        refreshedBgState?.lastSuccessAtMs ?? null,
      );
      if (pre.needed) {
        // 先发后压：本轮直接发出，turn 收尾后由 notifyCompletion 触发 background。
        // 体感上用户消息不再被压缩 turn 阻塞，连续对话恢复顺滑。
        // 写新 entry 前先清掉旧的，避免上一轮 turn 收尾于这条 turn 期间到达时
        // 把上一轮的 deferred 当成这一轮消费、导致后续 background 错过本轮收尾。
        deferredBackgroundCompactRef.current.delete(tabSessionId);
        appendCompactNotice(
          tabSessionId,
          composeCompactNoticeTokens(pre, "auto-after-send").sysmsg,
        );
        deferredBackgroundCompactRef.current.set(tabSessionId, {
          turnNonce,
          scheduledAtMs: Date.now(),
        });
      }

      try {
        await runOnce(prompt);
        const turnResult = await waitTurnComplete();
        if (
          !turnResult.success &&
          looksLikeContextOverflowError(
            extractRecentTurnFailureError(
              sessionsRef.current.find((s) => s.id === tabSessionId)?.messages ?? [],
            ),
          ) &&
          contextOverflowCompactRetriedNonceRef.current.get(tabSessionId) === turnNonce
        ) {
          appendContextOverflowFailureHint(tabSessionId);
        }
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
        await runCompactTurnAndWait({
          tabSessionId,
          turnNonce,
          runOnce,
          reloadAfterCompact,
          systemMessage: buildContextOverflowRetrySystemMessage(metrics),
        });
        await runOnce(prompt);
        const retryResult = await waitTurnComplete();
        if (!retryResult.success) {
          appendContextOverflowFailureHint(tabSessionId);
        }
      }
    },
    [
      appendContextOverflowFailureHint,
      invokeClaudeTurn,
      reloadTranscriptFromDisk,
      runCodexOneshotWithInvocation,
      runCodexRpcOneshotWithInvocation,
      runCursorOneshotWithInvocation,
      runOpencodeOneshotWithInvocation,
      runQoderOneshotWithInvocation,
      runCompactTurnAndWait,
    ],
  );

  const reloadFullDiskTranscript = useCallback(
    async (sessionKey: string): Promise<void> => {
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
    async (session: ClaudeSession, tailLines: number): Promise<void> => {
      try {
        await applyDiskTranscriptTailHelper({
          session,
          tailLines,
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

  const hydrateSessionTranscriptFromDisk = useCallback(
    async (
      session: ClaudeSession,
      tailLines: number = CLAUDE_DISK_JSONL_TAIL_LINES_LAZY,
    ): Promise<boolean> => {
      const fresh = sessionsRef.current.find((row) => row.id === session.id) ?? session;
      const tabId = fresh.id;
      setSessionTranscriptHydrating(tabId, true);
      try {
        const lazyOk = await applyDiskTranscriptTailHelper({
          session: fresh,
          tailLines,
          setSessions,
          diskTailLinesBySession: diskTailLinesBySessionRef.current,
          resolveSessionExecutionEngine,
          loadSessionTranscriptLines,
        });
        if (lazyOk) return true;
        return await reloadFullDiskTranscriptByKey({
          sessionKey: tabId,
          sessions: sessionsRef.current,
          setSessions,
          diskTailLinesBySession: diskTailLinesBySessionRef.current,
          resolveSessionExecutionEngine,
          loadSessionTranscriptLines,
        });
      } catch {
        return false;
      } finally {
        setSessionTranscriptHydrating(tabId, false);
      }
    },
    [loadSessionTranscriptLines, resolveSessionExecutionEngine, setSessions],
  );

  const requestDiskTranscriptHydration = useCallback(
    (sessionKey: string, tailLines: number = CLAUDE_DISK_JSONL_TAIL_LINES_LAZY) => {
      const raw = sessionKey.trim();
      if (!raw) return;
      const session = findSessionByTabOrClaudeId(sessionsRef.current, raw);
      if (!session) return;
      if (session.messages.length > 0) return;
      if (session.status === "running" || session.status === "connecting") return;
      const engine = resolveSessionExecutionEngine(session);
      const shouldHydrate =
        sessionHasDiskTranscript(session, engine) ||
        Boolean(session.claudeSessionId?.trim()) ||
        Boolean(session.diskTranscriptPartial);
      if (!shouldHydrate) return;
      const loadKey = session.id;
      if (diskHydrateInFlightRef.current.has(loadKey)) return;
      diskHydrateInFlightRef.current.add(loadKey);

      const release = () => {
        diskHydrateInFlightRef.current.delete(loadKey);
      };

      const attempt = (allowRetry: boolean) => {
        const fresh = sessionsRef.current.find((x) => x.id === loadKey);
        if (!fresh || fresh.messages.length > 0) {
          release();
          return;
        }
        void hydrateSessionTranscriptFromDisk(fresh, tailLines)
          .then((ok) => {
            const latest = sessionsRef.current.find((x) => x.id === loadKey);
            if (ok || (latest?.messages.length ?? 0) > 0) {
              release();
              return;
            }
            if (!allowRetry) {
              release();
              return;
            }
            window.setTimeout(() => {
              attempt(false);
            }, 1500);
          })
          .catch(() => {
            if (allowRetry) {
              window.setTimeout(() => attempt(false), 1500);
            } else {
              release();
            }
          });
      };

      attempt(true);
    },
    [hydrateSessionTranscriptFromDisk, resolveSessionExecutionEngine],
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

  /** localStorage 备份 key：在 beforeunload 中同步写入，供下次启动时合并恢复。 */
  const TABS_BACKUP_KEY = "wise.tabs.backup.v1";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        let data = await loadSessionTabsState();
        if (cancelled) return;
        // 合并 beforeunload 写入的 localStorage 备份（弥补异步 IPC 在页面卸载时可能未送达的空窗）
        try {
          const backupRaw = localStorage.getItem(TABS_BACKUP_KEY);
          localStorage.removeItem(TABS_BACKUP_KEY);
          if (backupRaw) {
            const backup = JSON.parse(backupRaw);
            if (backup?.sessions?.length) {
              if (!data) {
                data = backup;
              } else {
                const merged = mergePersistedTabsWithLocalBackup(
                  data.sessions as ClaudeSession[],
                  backup.sessions as ClaudeSession[],
                  typeof backup.activeSessionId === "string" ? backup.activeSessionId : null,
                );
                data = {
                  ...data,
                  sessions: merged.sessions,
                  activeSessionId:
                    data.activeSessionId ??
                    merged.activeSessionId ??
                    (typeof backup.activeSessionId === "string" ? backup.activeSessionId : null),
                };
              }
            }
          }
        } catch { /* ignore parse errors */ }
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
          const active =
            data.activeSessionId && normalizedWithModels.some((x) => x.id === data.activeSessionId)
              ? data.activeSessionId
              : normalizedWithModels[0]!.id;
          memoryKeepSessionIdsRef.current = new Set<string>([active]);

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
  }, []);

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
        const session = sessionsRef.current.find((s) => s.id === tid || s.claudeSessionId === tid);
        const tabSessionId = session?.id ?? tid;
        turnCompleteWaiterRef.current.resolve(tabSessionId, nonce, success);
        clearStreamStallTimer(tid);
        const ctx = pendingTurnFailoverRef.current;
        if (ctx && ctx.tabSessionId === tabSessionId && ctx.turnNonce === nonce) {
          if (success) {
            const compactFlight = compactTurnInFlightRef.current;
            const wasCompactTurn =
              compactFlight?.tabId === tabSessionId && compactFlight.nonce === nonce;
            if (wasCompactTurn) {
              compactTurnInFlightRef.current = null;
            } else {
              pendingTurnFailoverRef.current = null;
            }
          } else {
            const failureHint = [
              previewRaw,
              extractRecentTurnFailureError(session?.messages ?? []),
            ]
              .filter(Boolean)
              .join(" ");
            if (looksLikeContextOverflowError(failureHint)) {
              const alreadyRetried =
                contextOverflowCompactRetriedNonceRef.current.get(tabSessionId) === nonce;
              if (alreadyRetried) {
                pendingTurnFailoverRef.current = null;
                appendContextOverflowFailureHint(tabSessionId);
                return;
              }
              void (async () => {
                try {
                  const retried = await attemptContextOverflowCompactAndRetryRef.current(ctx);
                  if (!retried) {
                    appendContextOverflowFailureHint(tabSessionId);
                  }
                } catch (err) {
                  pendingTurnFailoverRef.current = null;
                  commitSessions((prev) =>
                    applyClaudeExecuteFailureNotice(
                      prev,
                      tabSessionId,
                      err,
                      { hasClaudeSessionId: true },
                    ),
                  );
                }
              })();
              return;
            }
          }
          if (!success && isRetryableModelApiError(previewRaw) && ctx.autoFailoverEnabled) {
            void (async () => {
              try {
                await attemptTurnFailoverAndRetryRef.current(ctx, previewRaw);
              } catch (err) {
                pendingTurnFailoverRef.current = null;
                commitSessions((prev) =>
                  applyClaudeExecuteFailureNotice(
                    prev,
                    tabSessionId,
                    err,
                    { hasClaudeSessionId: true },
                  ),
                );
              }
            })();
            return;
          } else if (!success) {
            pendingTurnFailoverRef.current = null;
          }
        }
        if (success && nonce > 0) {
          const compactFlight = compactTurnInFlightRef.current;
          const wasCompactTurn =
            compactFlight?.tabId === tabSessionId && compactFlight.nonce === nonce;
          if (!wasCompactTurn) {
            // 先发后压：本轮发送前已登记 deferred，user turn 收尾立刻 fire，
            // 不再等 2 秒 idle——因为 ctx% 已经到阈值，越压越好。
            const deferred = deferredBackgroundCompactRef.current.get(tabSessionId);
            if (deferred && deferred.turnNonce === nonce) {
              deferredBackgroundCompactRef.current.delete(tabSessionId);
              queueMicrotask(() =>
                scheduleBackgroundContextCompactRef.current(tabSessionId, { delayMs: 0 }),
              );
            } else {
              queueMicrotask(() =>
                scheduleBackgroundContextCompactRef.current(tabSessionId, { delayMs: 2000 }),
              );
            }
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
          void wiseNotificationIngestWithPet({
            conversationId,
            body: buildClaudeTurnCompleteNotificationBody({
              prefix,
              success: false,
              previewRaw: previewRaw.trim(),
              session: session ?? null,
            }),
            serverMsgId: `complete-err-${nonce}`,
            source: "claude",
            title: session?.repositoryName ?? session?.id ?? "Claude",
          }).catch(() => {
            /* 通知失败不影响会话 UI */
          });
          return;
        }
        const trimmed = previewRaw.trim();
        void wiseNotificationIngestWithPet({
          conversationId,
          body: buildClaudeTurnCompleteNotificationBody({
            prefix,
            success: true,
            previewRaw: trimmed,
            session: session ?? null,
          }),
          serverMsgId: `complete-${nonce}`,
          source: "claude",
          title: session?.repositoryName ?? session?.id ?? "Claude",
        }).catch(() => {
          /* 通知失败不影响会话 UI */
        });
      },
      resolveTabIdForClaudeStream: resolveTabIdForStream,
      resolveTabIdFromCompletePayload: resolveCompleteTabIdForStream,
      resolveSuccessFromCompletePayload: resolveClaudeCompleteSuccess,
      resolveSessionExecutionEngine,
      onClaudeSessionIdAssigned: (tabId, claudeSessionId) => {
        markClaudeRegistryBootstrapWarmup(registryBootstrapDeadlineByClaudeSidRef, claudeSessionId);
        const nonceMap = expectedTurnNonceByTabIdRef.current;
        const pendingNonce = nonceMap.get(tabId);
        if (pendingNonce !== undefined) {
          nonceMap.set(claudeSessionId, pendingNonce);
        }
        if (streamingProcessByTabRef.current.has(tabId)) {
          streamingProcessByTabRef.current.set(tabId, { claudeSessionId });
        }
        const session = sessionsRef.current.find((s) => s.id === tabId);
        const rt = streamRuntimeRef.current;
        const turnNonce = nonceMap.get(tabId) ?? nonceMap.get(claudeSessionId);
        const hasInvocation = [...claudeInvocationInflightRef.current.values()].some(
          (meta) => meta.tabId === tabId,
        );
        if (
          rt &&
          session &&
          isTerminalWorkerWiseTab(session) &&
          !sessionUsesStreamingConnection(session, defaultConnectionKindRef.current) &&
          !hasInvocation &&
          turnNonce !== undefined
        ) {
          void attachClaudeSessionStreamForTurn(
            claudeSessionId,
            tabId,
            rt,
            turnNonce,
            undefined,
            (id, bound) => nonceMap.get(id) ?? bound,
            () => false,
          ).catch(() => {
            /* 回退监听失败时仍依赖全局通道 */
          });
        }
      },
      onSessionTabIdMigrated: (fromTabId, toClaudeSessionId) => {
        applySessionTabIdMigration(fromTabId, toClaudeSessionId);
        // 普通会话首次发送时 session.id 从临时 tabId 迁到 realSessionId：把待聚焦请求一并迁移，
        // 否则 key={session.id} remount 后新 ComposerRegion 用 realSessionId consume 不到旧 tabId 的请求。
        migrateComposerRefocus(fromTabId, toClaudeSessionId);
      },
      reloadTranscriptFromDisk,
      expectedTurnNonceByTabIdRef,
      onStreamActivity: (tabId) => scheduleStreamStallTimer(tabId),
      onHookStreamActivity: (tabId) => {
        const key = tabId.trim();
        if (!key) return;
        recentHookActivityByTabRef.current.set(key, Date.now());
        scheduleStreamStallTimer(key);
      },
      isMultiPaneRef,
    });

    void (async () => {
      await attach(claudeStreamEvent("output"), runtime.handleOutput);
      await attach(claudeStreamEvent("complete"), runtime.handleComplete);
      await attach(claudeStreamEvent("error"), runtime.handleError);
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
    if (!(await pathIsAccessibleDirectoryCached(trimmedPath))) return;
    const { disk, listingPath: mergePath } = await listClaudeDiskSessionsForRepositoryScope(
      trimmedPath,
      sessionsRef.current,
    );
    const prev = sessionsRef.current;
    const next = mergeRepositoryDiskSessions(prev, mergePath, repositoryName, disk, "sonnet", companionSessionIdsRef.current);
    const migrations = collectDiskMergeTabIdMigrations(prev, next, mergePath);
    if (next !== prev) {
      for (const migration of migrations) {
        memoryKeepSessionIdsRef.current.add(migration.toClaudeSessionId);
        memoryKeepSessionIdsRef.current.delete(migration.fromTabId);
        if (activeSessionIdRef.current === migration.fromTabId) {
          activeSessionIdRef.current = migration.toClaudeSessionId;
        }
      }
      for (const row of next) {
        if (!repositoryPathsMatch(row.repositoryPath, mergePath)) continue;
        if (row.messages.length > 0 || row.id === activeSessionIdRef.current) {
          memoryKeepSessionIdsRef.current.add(row.id);
        }
      }
      setSessions(next);
      for (const migration of migrations) {
        applySessionTabIdMigration(migration.fromTabId, migration.toClaudeSessionId);
      }
      const activeKey = activeSessionIdRef.current?.trim();
      if (activeKey) {
        requestDiskTranscriptHydration(activeKey);
      }
    }

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
  }, [applySessionTabIdMigration, getCachedClaudeConfigModel, requestDiskTranscriptHydration, setSessions]);

  useEffect(() => {
    if (!activeSessionId) return;
    let cancelled = false;
    const cancelIdle = runWhenIdle(() => {
      if (cancelled) return;
      requestDiskTranscriptHydration(activeSessionId);
      runWhenIdle(() => {
        if (cancelled) return;
        scheduleBackgroundContextCompact(activeSessionId, { delayMs: 1200 });
      }, { timeoutMs: 900 });
    }, { timeoutMs: 0 });

    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [activeSessionId, sessionsStructureKey, requestDiskTranscriptHydration, scheduleBackgroundContextCompact]);

  /** 窗口重新可见时，为仍为空且未成功补全的当前标签重试磁盘加载。 */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const retryIfStuck = () => {
      if (document.visibilityState !== "visible") return;
      const sid = activeSessionIdRef.current;
      if (!sid) return;
      requestDiskTranscriptHydration(sid);
    };
    document.addEventListener("visibilitychange", retryIfStuck);
    return () => document.removeEventListener("visibilitychange", retryIfStuck);
  }, [requestDiskTranscriptHydration]);

  /** tabs 恢复或内存回收后：为仍有磁盘 id 但 messages 为空的标签补全 transcript。 */
  useEffect(() => {
    if (!tabsHydrated) return;
    let cancelled = false;
    const cancelIdle = runWhenIdle(() => {
      if (cancelled) return;
      const candidates = sessionsRef.current.filter((session) => {
        if (session.messages.length > 0) return false;
        if (session.status === "running" || session.status === "connecting") return false;
        return sessionHasDiskTranscript(session, resolveSessionExecutionEngine(session));
      });
      for (const session of candidates.slice(0, 16)) {
        requestDiskTranscriptHydration(session.id);
      }
    }, { timeoutMs: 1400 });
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [tabsHydrated, sessionsStructureKey, requestDiskTranscriptHydration, resolveSessionExecutionEngine]);

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
        idleCleanups.push(
          runWhenIdle(() => {
            if (cancelled) return;
            requestDiskTranscriptHydration(cid, companionDiskTailLines);
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
  }, [companionSessionIdsJoinKey, requestDiskTranscriptHydration, companionSessionIds, resolveSessionExecutionEngine]);

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
        if (isExecutionEnvironmentWorkerRepositoryName(s.repositoryName ?? "")) {
          // 执行环境 worker：侧栏可点开查看，勿在切走时清空正文（否则打开后空白、排序抖动）。
          if (s.messages.length <= IN_MEMORY_SESSION_MESSAGES_MAX) return s;
          changed = true;
          return {
            ...s,
            messages: capSessionMessagesForMemory(s.messages),
            diskTranscriptPartial: true,
            diskPreview: retainSessionListPreviewOnMessageDrop(s),
          };
        }
        if (s.status === "running" || s.status === "connecting") {
          if (s.messages.length <= IN_MEMORY_SESSION_MESSAGES_MAX) return s;
          changed = true;
          return {
            ...s,
            messages: capSessionMessagesForMemory(s.messages),
            diskTranscriptPartial: true,
          };
        }
        const engine = resolveSessionExecutionEngine(s);
        const canReloadFromDisk = sessionMessagesSafeToDropForDiskReload(s, engine);
        // tab id 不等于 jsonl 已落盘：Codex RPC 等若尚无 diskTranscriptPartial / claudeSessionId，
        // 清空内存会导致重开空白且无法 hydrate。
        if (!canReloadFromDisk) return s;
        if (s.messages.length === 0) return s;
        changed = true;
        diskLoadDoneRef.current.delete(s.id);
        return {
          ...s,
          // 丢弃正文前锁住侧栏标题，避免未选中项回落「新会话」或与真实话题脱节。
          diskPreview: retainSessionListPreviewOnMessageDrop(s),
          // 锁住排序活跃时间，避免切会话清空 messages 后「新会话」短暂插到前面再跳回。
          createdAt: bumpSessionCreatedAtForSortActivity(s),
          messages: [],
          diskTranscriptPartial: true,
          transcriptMemoryUnlimited: false,
        };
      });
      return changed ? next : prev;
    });
  }, [companionMemoryLimits.companionMax, tabsHydrated, activeSessionId, companionSessionIdsJoinKey]);

  /** 周期性收紧全局消息预算（避免流式/多标签在 cap 之外缓慢涨内存） */
  useEffect(() => {
    if (!tabsHydrated) return;
    let cancelIdle: (() => void) | null = null;
    let timer: number | null = null;

    const runMemoryCapPass = () => {
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
    };

    const scheduleTimer = () => {
      if (timer != null) window.clearInterval(timer);
      const memCapPrimaryMs = 45_000;
      const memCapHiddenMs = 90_000;
      const memCapVisibleMs = isCurrentPrimaryMainWorkspaceWindowSync() ? memCapPrimaryMs : memCapHiddenMs;
      timer = window.setInterval(
        runMemoryCapPass,
        readVisiblePollIntervalMs(memCapVisibleMs, memCapHiddenMs * 2),
      );
    };

    scheduleTimer();
    const onVisibilityChange = () => {
      scheduleTimer();
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        runMemoryCapPass();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      if (timer != null) window.clearInterval(timer);
      if (cancelIdle) cancelIdle();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [buildMemoryKeepSessionIds, companionMemoryLimits.globalBudget, pruneLiveSessionSidecars, setSessions, tabsHydrated]);

  /** 主会话 / 员工 / 团队等全部标签：定期与 Claude Code 宿主注册表对齐执行态（不限于当前活动标签）。 */
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let cancelIdle: (() => void) | null = null;
    const unsubscribeSnapshot = subscribeSystemResourceSnapshot(() => {
      /* store drives its own poll; this subscription keeps the singleton alive */
    });

    const scheduleTimer = () => {
      if (timer != null) window.clearInterval(timer);
      const regPrimaryMs = 15_000;
      const regHiddenMs = 45_000;
      const regVisibleMs = isCurrentPrimaryMainWorkspaceWindowSync() ? regPrimaryMs : regHiddenMs;
      timer = window.setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
        if (cancelIdle) cancelIdle();
        cancelIdle = runWhenIdle(() => {
          void tick();
        }, { timeoutMs: 1800 });
      }, readVisiblePollIntervalMs(regVisibleMs, regHiddenMs * 2));
    };

    const tick = async () => {
      try {
        const list = await listRunningClaudeSessions();
        if (cancelled) return;
        const claudeProcesses = [...getSystemResourceClaudeProcesses()];
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
        publishRunningClaudeSessionIds(runningIds);
        pruneClaudeRegistryBootstrapWarmup(registryBootstrapDeadlineByClaudeSidRef, runningIds);
        startTransition(() => {
          setSessions((prev) => {
            const next = reconcileSessionStatusesWithRunningRegistry(
              prev,
              runningIds,
              registryBootstrapDeadlineByClaudeSidRef.current,
              knownIds,
            );
            return next === prev ? prev : next;
          });
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
      } else {
        scheduleTimer();
      }
    };
    const onWindowResize = () => {
      scheduleTimer();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("resize", onWindowResize);

    return () => {
      cancelled = true;
      if (timer != null) window.clearInterval(timer);
      if (cancelIdle) cancelIdle();
      unsubscribeSnapshot();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("resize", onWindowResize);
    };
  }, []);

  const updateSessionModel = useCallback((sessionId: string, model: string) => {
    const trimmed = model.trim();
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (s.id !== sessionId) return s;
        if ((s.model?.trim() || "") === trimmed) return s;
        changed = true;
        return { ...s, model: trimmed };
      });
      return changed ? next : prev;
    });
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

      setSessions((prev) => {
        const nextSessions = prev.map((s) =>
          s.id === sessionId ? applyTabConnectionKindOverride(s, next, globalDefault) : s,
        );
        sessionsRef.current = nextSessions;
        return nextSessions;
      });
    },
    [detachClaudeInvocationsForSessionKey],
  );

  /**
   * Per-session ultracode 切换 setter。
   * - `next === null`：清除 override（回到 follow global）；
   * - `next === boolean`：显式覆盖（per-session false beats global true）。
   *
   * 与 `updateSessionConnectionKind` 的差异：ultracode 不影响流式子进程句柄/磁盘会话 id，
   * 因此无需 close streaming session；仅修改 store，下次 spawn 读新值。
   */
  const updateSessionUltracodeOverride = useCallback(
    (sessionId: string, next: boolean | null) => {
      setSessions((prev) => {
        let changed = false;
        const nextSessions = prev.map((s) => {
          if (s.id !== sessionId) return s;
          const updated = applyTabUltracodeOverride(s, next);
          if (updated === s) return s;
          changed = true;
          return updated;
        });
        if (!changed) return prev;
        sessionsRef.current = nextSessions;
        return nextSessions;
      });
    },
    [],
  );

  // Create a session without executing Claude (idle state); model from Claude Code settings.json
  const createSession = useCallback(
    async (
      repositoryPath: string,
      repositoryName: string,
      opts?: {
        skipActivate?: boolean;
        connectionKind?: ClaudeSessionConnectionKind;
        immediateActivate?: boolean;
        /** 初始模型；提供后跳过异步读取全局档案/仓库默认模型，用于多屏保留窗格模型。 */
        initialModel?: string;
        /** 标记为右栏侧会话：不进中栏 tab 列表、不抢 active、不写入主会话绑定表。 */
        isSide?: boolean;
        /** 激活前钩子：在 `setActiveSessionId` 触发新会话挂载与草稿 hydration 之前 await 完成。 */
        onBeforeActivate?: (newSessionId: string) => Promise<void> | void;
      },
    ) => {
      const id = generateId();
      const newSession: ClaudeSession = {
        id,
        claudeSessionId: null,
        repositoryPath: normalizeRepositoryPathKey(repositoryPath) || repositoryPath.trim(),
        repositoryName,
        model: opts?.initialModel?.trim() || "sonnet",
        status: "idle",
        messages: [],
        createdAt: Date.now(),
        pendingPrompt: "",
        ...(opts?.connectionKind ? { connectionKind: opts.connectionKind } : {}),
        ...(opts?.isSide ? { isSide: true } : {}),
      };

      // ref 同步写入，保证 bind/切会话逻辑立即可见；后台 worker（skipActivate）同步发布 store 供派发轮询读取。
      if (!sessionsRef.current.some((s) => s.id === id)) {
        const next = [...sessionsRef.current, newSession];
        sessionsRef.current = next;
        if (opts?.skipActivate) {
          publishClaudeSessions(next);
        }
      }
      // 激活前先 await 副作用（如迁移旧会话草稿到新 key）：必须在 setActiveSessionId
      // 触发新会话挂载与草稿 hydration 之前落盘，否则新会话 hydration 读盘早于写入而显示为空。
      if (!opts?.skipActivate && opts?.onBeforeActivate) {
        await opts.onBeforeActivate(id);
      }
      if (!opts?.skipActivate && opts?.immediateActivate) {
        setActiveSessionId(id);
      }
      startTransition(() => {
        setSessions((prev) => {
          if (prev.some((s) => s.id === id)) {
            return prev;
          }
          return [...prev, newSession];
        });
        if (!opts?.skipActivate && !opts?.immediateActivate) {
          setActiveSessionId(id);
        }
      });
      // 多屏保留窗格模型时传入 initialModel，跳过异步读取全局档案/仓库默认模型，避免覆盖。
      if (!opts?.initialModel?.trim()) {
        void (async () => {
          try {
            const profileModel = resolveClaudeExecModelId({ store: getCachedModelProfileStore() });
            const configModel = profileModel ?? (await getCachedClaudeConfigModel(repositoryPath));
            if (!configModel?.trim()) return;
            setSessions((prev) => {
              const next = prev.map((s) => (s.id === id ? { ...s, model: configModel } : s));
              sessionsRef.current = next;
              return next;
            });
          } catch {
            /* keep default */
          }
        })();
      }

      // 新创建会话同步落盘 localStorage，弥补 debounce 取消 + beforeunload 不可靠的双重缺口。
      // skipActivate（伴生窗格）不得改写备份里的 activeSessionId，否则刷新会落到空壳新标签。
      try {
        localStorage.setItem(
          TABS_BACKUP_KEY,
          JSON.stringify({
            version: 1,
            activeSessionId: opts?.skipActivate
              ? (activeSessionIdRef.current ?? id)
              : id,
            sessions: sessionsRef.current.map((ses) => {
              const {
                diskTranscriptPartial: _omitPartial,
                transcriptMemoryUnlimited: _omitUnlimited,
                ...rest
              } = ses;
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
          }),
        );
      } catch {
        /* localStorage full or unavailable */
      }

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
  const {
    executeSession,
    executeTerminalSession,
    sendMessageToSession,
    sendMessage,
    closeSession,
    cancelSession,
  } = useMemo(
    () =>
      createSessionActionHandlers({
        sessionsRef,
        sessionIdMapRef,
        executeSessionRetryCountRef,
        recentExecutePromptBySessionRef,
        streamingProcessByTabRef,
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
      }),
    [
      activeSessionId,
      cancelHostExecutionForTab,
      clearStreamStallTimer,
      commitSessions,
      detachClaudeInvocationsForSessionKey,
      purgeStreamSidecarsForSession,
      resolveSessionExecutionEngine,
      runClaudeTurnWithContextGuard,
      scheduleStreamStallTimer,
      setSessions,
    ],
  );

  const reconnectClaudeSessionAfterModelSwitch = useCallback(
    async (input: {
      sessionId: string;
      effectiveModel?: string | null;
      appliedProfileId?: string | null;
    }) => {
      if (modelSwitchReconnectInFlightRef.current) return;

      const tabId = input.sessionId.trim();
      if (!tabId) return;

      const session = sessionsRef.current.find((s) => s.id === tabId);
      if (!session) return;
      if (resolveSessionExecutionEngine(session) !== "claude") return;

      const claudeSid =
        session.claudeSessionId?.trim() ??
        sessionIdMapRef.current.get(tabId)?.trim() ??
        null;

      const dedupeKey = `${tabId}:${input.appliedProfileId?.trim() || ""}:${input.effectiveModel?.trim() || ""}`;
      const now = Date.now();
      if (
        lastModelSwitchReconnectKeyRef.current === dedupeKey &&
        now - lastModelSwitchReconnectAtRef.current < 2500
      ) {
        return;
      }

      const pendingCtx = pendingTurnFailoverRef.current;
      const pendingTurnPrompt =
        pendingCtx?.tabSessionId === tabId ? pendingCtx.prompt : null;
      const hasInflightInvocation = [...claudeInvocationInflightRef.current.values()].some(
        (meta) => meta.tabId === tabId,
      );
      const plan = buildClaudeModelSwitchReconnectPlan({
        session,
        effectiveModel: input.effectiveModel,
        pendingTurnPrompt,
        hasStreamingProcess: streamingProcessByTabRef.current.has(tabId),
        hasInflightInvocation,
        isTerminalWorker: isTerminalWorkerWiseTab(session),
        isFailoverInProgress: Boolean(
          pendingCtx?.tabSessionId === tabId && pendingCtx.autoFailoverEnabled,
        ),
      });

      if (!plan.shouldTeardownHost && !plan.updateModel && !plan.notifyMessage) {
        return;
      }

      modelSwitchReconnectInFlightRef.current = true;
      lastModelSwitchReconnectKeyRef.current = dedupeKey;
      lastModelSwitchReconnectAtRef.current = now;

      try {
        if (plan.updateModel) {
          updateSessionModel(tabId, plan.updateModel);
        }

        if (plan.shouldTeardownHost) {
          if (claudeSid) {
            await cancelHostExecutionForTab(tabId, claudeSid).catch(() => undefined);
            await closeStreamingSession(claudeSid).catch(() => undefined);
          }
          streamingProcessByTabRef.current.delete(tabId);
          purgeStreamSidecarsForSession(tabId, session.claudeSessionId);
          clearStreamStallTimer(tabId);
          if (pendingCtx?.tabSessionId === tabId) {
            pendingTurnFailoverRef.current = null;
          }
        }

        const refreshed = sessionsRef.current.find((s) => s.id === tabId) ?? session;
        const nextStatus =
          plan.shouldAutoResume || refreshed.status === "running" || refreshed.status === "connecting"
            ? ("idle" as const)
            : refreshed.status;

        if (plan.notifyMessage) {
          commitSessions((prev) =>
            appendSystemMessageBySessionId(
              prev.map((s) => (s.id === tabId ? { ...s, status: nextStatus } : s)),
              tabId,
              plan.notifyMessage!,
            ),
          );
        } else if (nextStatus !== refreshed.status) {
          commitSessions((prev) =>
            prev.map((s) => (s.id === tabId ? { ...s, status: nextStatus } : s)),
          );
        }

        if (plan.shouldAutoResume && plan.resumePrompt) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 0);
          });
          if (activeSessionIdRef.current !== tabId) return;
          executeSession(tabId, plan.resumePrompt, { replaceLastUserBubble: true });
        }
      } finally {
        modelSwitchReconnectInFlightRef.current = false;
      }
    },
    [
      cancelHostExecutionForTab,
      clearStreamStallTimer,
      commitSessions,
      executeSession,
      purgeStreamSidecarsForSession,
      resolveSessionExecutionEngine,
      updateSessionModel,
    ],
  );

  useEffect(() => {
    let queued: ClaudeUserSettingsChangedDetail | null = null;
    let timer: number | null = null;

    const flush = () => {
      timer = null;
      const detail = queued;
      queued = null;
      if (!detail?.sessionReconnect || detail.optimistic || detail.skipComposerPickerRefresh) {
        return;
      }
      if (detail.engine !== "claude" && detail.engine !== "opencode") return;

      if (detail.engine === "claude") {
        claudeConfigModelByRepoPathRef.current.clear();
      }

      const effectiveModel = detail.effectiveModel?.trim() || null;
      if (effectiveModel) {
        commitSessions((prev) =>
          prev.map((s) => {
            if (!isTerminalWorkerWiseTab(s) && s.id !== activeSessionIdRef.current) return s;
            if ((s.model?.trim() || "") === effectiveModel) return s;
            return { ...s, model: effectiveModel };
          }),
        );
      }

      if (detail.engine !== "claude") return;

      const targetTabIds = new Set<string>();
      const activeTabId = activeSessionIdRef.current?.trim();
      if (activeTabId) targetTabIds.add(activeTabId);
      for (const session of sessionsRef.current) {
        if (!isTerminalWorkerWiseTab(session)) continue;
        if (session.status === "running" || session.status === "connecting") {
          targetTabIds.add(session.id);
        }
      }

      for (const tabId of targetTabIds) {
        void reconnectClaudeSessionAfterModelSwitch({
          sessionId: tabId,
          effectiveModel: detail.effectiveModel,
          appliedProfileId: detail.appliedProfileId,
        });
      }
    };

    const onModelProfileApplied = (event: Event) => {
      const detail = (event as CustomEvent<ClaudeUserSettingsChangedDetail>).detail;
      if (!detail?.sessionReconnect || detail.optimistic || detail.skipComposerPickerRefresh) {
        return;
      }
      queued = detail;
      if (timer != null) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(flush, 0);
    };

    window.addEventListener(WISE_CLAUDE_USER_SETTINGS_CHANGED, onModelProfileApplied);
    return () => {
      window.removeEventListener(WISE_CLAUDE_USER_SETTINGS_CHANGED, onModelProfileApplied);
      if (timer != null) {
        window.clearTimeout(timer);
      }
    };
  }, [commitSessions, reconnectClaudeSessionAfterModelSwitch]);

  const ensureSessionForMonitorDrawer = useCallback(
    async (input: {
      sessionId: string;
      repositoryPath?: string;
      repositoryDisplayName?: string;
      taskLabel?: string;
    }): Promise<ClaudeSession | null> => {
      const workerKey = input.sessionId.trim();
      if (!workerKey) return null;

      const findWorker = () =>
        findSessionForMonitorDrawerResume(sessionsRef.current, {
          sessionId: workerKey,
          repositoryPath: input.repositoryPath,
          taskLabel: input.taskLabel,
          sessionIdMap: sessionIdMapRef.current,
        });

      let hit = findWorker();
      if (hit) return hit;

      const repoPath = input.repositoryPath?.trim();
      if (!repoPath) return null;

      const repoName =
        input.repositoryDisplayName?.trim() ||
        sessionsRef.current.find((s) => s.id === workerKey)?.repositoryName ||
        repoPath;
      await refreshDiskSessionsForRepository(repoPath, repoName);
      hit = findWorker();
      if (hit) return hit;

      try {
        const tabs = await loadSessionTabsState();
        const tabHit = tabs?.sessions.find(
          (s) => s.id === workerKey || s.claudeSessionId?.trim() === workerKey,
        );
        if (tabHit) {
          const materialized = materializeWorkerTabSession(tabHit, workerKey);
          commitSessions((prev) => {
            if (prev.some((s) => s.id === workerKey)) {
              return prev.map((s) => (s.id === workerKey ? materialized : s));
            }
            return [...prev, materialized];
          });
          const claudeSid = materialized.claudeSessionId?.trim();
          if (claudeSid) sessionIdMapRef.current.set(workerKey, claudeSid);
          return materialized;
        }
      } catch {
        /* ignore */
      }

      hit = findWorker();
      if (!hit) return null;

      if (hit.id !== workerKey) {
        const materialized = materializeWorkerTabSession(hit, workerKey);
        commitSessions((prev) => {
          const filtered = prev.filter((s) => s.id !== hit!.id && s.id !== workerKey);
          return [...filtered, materialized];
        });
        const claudeSid = materialized.claudeSessionId?.trim();
        if (claudeSid) sessionIdMapRef.current.set(workerKey, claudeSid);
        return materialized;
      }
      return hit;
    },
    [commitSessions, refreshDiskSessionsForRepository],
  );

  const resumeSessionFromMonitorDrawer = useCallback(
    async (input: {
      sessionId: string;
      prompt: string;
      repositoryPath?: string;
      repositoryDisplayName?: string;
      taskLabel?: string;
    }): Promise<boolean> => {
      const workerKey = input.sessionId.trim();
      const prompt = input.prompt.trim();
      if (!workerKey || !prompt) return false;

      const findWorker = () => {
        const snap = getClaudeSessionSnapshot(workerKey);
        const pool = snap
          ? sessionsRef.current.some((item) => item.id === snap.id)
            ? sessionsRef.current
            : [...sessionsRef.current, snap]
          : sessionsRef.current;
        return findSessionForMonitorDrawerResume(pool, {
          sessionId: workerKey,
          repositoryPath: input.repositoryPath,
          taskLabel: input.taskLabel,
          sessionIdMap: sessionIdMapRef.current,
        });
      };

      const worker = await ensureSessionForMonitorDrawer(input);
      if (!worker) return false;

      const tabId = worker.id;
      if (worker.messages.length === 0) {
        await reloadFullDiskTranscript(tabId).catch(() => {});
      }

      const latestWorker = findWorker() ?? worker;
      const shouldForceFreshTerminalTurn =
        isTerminalWorkerWiseTab(latestWorker) &&
        (!latestWorker.claudeSessionId?.trim() ||
          latestWorker.messages.length === 0 ||
          latestWorker.status === "cancelled" ||
          latestWorker.status === "error");
      const executeOpts = {
        userBubblePrompt: prompt,
        ...(shouldForceFreshTerminalTurn ? { terminalFreshTurn: true as const } : {}),
      };

      const executeTabId = latestWorker.id;
      let ok = executeSession(executeTabId, prompt, executeOpts);
      if (ok === false) {
        for (let attempt = 0; attempt < 4; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 80));
          const again = findWorker();
          if (!again) continue;
          const retryFresh =
            isTerminalWorkerWiseTab(again) &&
            (!again.claudeSessionId?.trim() ||
              again.messages.length === 0 ||
              again.status === "cancelled" ||
              again.status === "error");
          ok = executeSession(again.id, prompt, {
            userBubblePrompt: prompt,
            ...(retryFresh ? { terminalFreshTurn: true as const } : {}),
          });
          if (ok !== false) break;
        }
      }
      if (ok === false) return false;

      if (isTerminalWorkerWiseTab(latestWorker)) {
        const started = await waitForTerminalWorkerTurnStarted(() => sessionsRef.current, executeTabId);
        return started;
      }
      return true;
    },
    [commitSessions, executeSession, ensureSessionForMonitorDrawer, reloadFullDiskTranscript],
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

  const compactSessionHistory = useCallback(
    async (sessionId: string, prompt?: string) => {
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
      const compactPrompt = prompt?.trim() || CLAUDE_COMPACT_SLASH_PROMPT;
      streamingTargetIdRef.current = sessionId;
      streamTurnSeqRef.current += 1;
      lastUserSendNonceRef.current = streamTurnSeqRef.current;
      const turnNonce = lastUserSendNonceRef.current;
      expectedTurnNonceByTabIdRef.current.set(sessionId, turnNonce);
      markClaudeRegistryBootstrapWarmup(registryBootstrapDeadlineByClaudeSidRef, claudeSessionId);
      const manualMetrics = getSessionContextMetrics(session);
      appendCompactNotice(
        sessionId,
        composeCompactNoticeTokens(manualMetrics, "manual").sysmsg,
      );
      setSessions((prev) =>
        setSessionRunningWithUserPrompt(prev, sessionId, compactPrompt),
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
          prompt: compactPrompt,
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

  const releaseSessionHostProcess = useCallback(
    async (
      sessionId: string,
      opts?: { claudeProcesses?: import("../types").ClaudeHostProcess[] },
    ) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session) {
        return;
      }

      purgeStreamSidecarsForSession(sessionId, session.claudeSessionId);
      clearStreamStallTimer(sessionId);
      detachClaudeInvocationsForSessionKey(sessionId);
      streamingProcessByTabRef.current.delete(sessionId);

      const claudeSidEarly =
        session.claudeSessionId?.trim() ?? sessionIdMapRef.current.get(sessionId)?.trim() ?? null;
      const needsHostIpc =
        session.status === "running" ||
        session.status === "connecting" ||
        Boolean(claudeSidEarly?.trim());
      if (!needsHostIpc) {
        return;
      }

      const snapshot = opts?.claudeProcesses
        ? { claudeProcesses: opts.claudeProcesses }
        : await refreshSystemResourceSnapshotStore()
            .then(() => ({ claudeProcesses: [...getSystemResourceClaudeProcesses()] }))
            .catch(() => null);
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
      const [listResult] = await Promise.allSettled([
        listRunningClaudeSessions(),
        refreshSystemResourceSnapshotStore(),
      ]);
      if (listResult.status !== "fulfilled") return;
      const list = listResult.value;
      const claudeProcesses = [...getSystemResourceClaudeProcesses()];
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
        const next = reconcileSessionStatusesWithRunningRegistry(
          prev,
          runningIds,
          registryBootstrapDeadlineByClaudeSidRef.current,
          knownIds,
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
      const engineResolverForQuestion =
        claudeSessionsOptionsRef.current?.resolveExecutionEngineRef?.current;
      const questionEngine =
        engineResolverForQuestion && session
          ? engineResolverForQuestion(session)
          : null;
      if (questionEngine === "cursor") {
        try {
          const { respondCursorAcpQuestion } = await import("../services/cursorAcp");
          const { decodeCursorAcpQuestionRequestId } = await import(
            "../services/cursorAcpControlBridge"
          );
          const decoded = decodeCursorAcpQuestionRequestId(qr.id);
          const requestId = decoded?.requestId ?? qr.id;
          const questionId = decoded?.questionId ?? qr.id;
          const selected = answers.length > 0 ? answers : customAnswer ? [customAnswer] : [];
          const outcome =
            selected.length === 0
              ? { outcome: "skipped", reason: "empty answer" }
              : {
                  outcome: "answered",
                  answers: [
                    {
                      questionId,
                      selectedOptionIds: selected,
                    },
                  ],
                };
          await respondCursorAcpQuestion(tabSessionId, requestId, outcome);
          notificationHub.markRequestAnswered(qr.id);
          notificationHub.clearQuestion(ownerSessionId);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          notificationHub.markRequestFailed(qr.id, msg);
        }
        return;
      }
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

      // 终端 / 派发 / 反馈循环 sub-agent（connectionKind=oneshot）首次出题时，
      // claudeSid 还没在 oneshot bootstrap 路径里落地（参考同文件下方
      // executeSession 的 1.6s × 20 次轮询），如果直接写 stdin 会让
      // targetSessionId 退化成 Wise tab id、撞后端 claude_stdin_by_session[claude_sid]
      // map miss → "已结束" 错误 → 兜底走 resume，但 resume 会在 claudeSid=null 时
      // 重启全新进程、丢掉正在提问的旧 oneshot。
      // 这里在 oneshot 路径上对齐 executeSession 的 bootstrap 窗口轮询拿 claudeSid
      //（最多 ~1.7s = 20×80ms + 100ms 余量）；超时仍未落地且 worker 仍 running 时，
      // 抛 sentinel 让 auto-answer effect 下个 tick 重试，绝不走 stdin/resume/failed。
      let resolvedClaudeSid = claudeSid;
      if (
        !resolvedClaudeSid &&
        session &&
        !sessionUsesStreamingConnection(session, defaultConnectionKindRef.current)
      ) {
        const deadline = Date.now() + 1700;
        while (!resolvedClaudeSid && Date.now() < deadline) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 80));
          const fresh = sessionsRef.current.find(
            (row) => row.id === (session?.id ?? tabSessionId),
          );
          resolvedClaudeSid =
            fresh?.claudeSessionId?.trim() ||
            sessionIdMapRef.current.get(tabSessionId ?? "")?.trim() ||
            null;
          if (resolvedClaudeSid) break;
        }
      }
      // 1b：oneshot running worker 在 bootstrap 窗口内仍没拿到 claudeSid ——
      // 子进程大概率仍在启动，question 仍 pending。此时写 stdin 必撞 map miss、
      // 走 resume 会重启丢上下文。抛 sentinel 交由 effect 重试，直到 bootstrap 完成
      // 或子进程真退出（status !== running，届时下方 1c 的 resume 分支会接管）。
      if (
        !resolvedClaudeSid &&
        session &&
        !sessionUsesStreamingConnection(session, defaultConnectionKindRef.current) &&
        session.status === "running"
      ) {
        throw new Error(QUESTION_BOOTSTRAP_PENDING_SENTINEL);
      }
      const targetSessionId = resolvedClaudeSid || session?.id || ownerSessionId;
      const nextTurnNonceState = consumeNextTurnNonce(
        streamTurnSeqRef.current,
        Boolean(preferStdinControlResponse && resolvedClaudeSid),
      );
      streamTurnSeqRef.current = nextTurnNonceState.nextSeq;
      const nextTurnNonce = nextTurnNonceState.turnNonce;
      try {
        await submitQuestionViaStdin({
          tabSessionId,
          claudeSid: resolvedClaudeSid,
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
          // 1c：oneshot running worker 撞 map miss，多半是 bootstrap 竞态
          // （claudeSid 刚落地但 stdin map 尚未注册，或轮询边界擦过）——子进程
          // 仍存活。走 resume 会重启丢上下文，改为抛 sentinel 交由 effect 重试。
          // 子进程真退出（status !== running）时才走 resume 兜底，那是 resume 的正当场景。
          const liveSessionForRecover = sessionsRef.current.find(
            (s) => s.id === (session?.id ?? tabSessionId),
          );
          const isOneshotStillRunning =
            liveSessionForRecover &&
            !sessionUsesStreamingConnection(
              liveSessionForRecover,
              defaultConnectionKindRef.current,
            ) &&
            liveSessionForRecover.status === "running";
          if (isOneshotStillRunning) {
            throw new Error(QUESTION_BOOTSTRAP_PENDING_SENTINEL);
          }
          notificationHub.invalidateControlRequestsForSession(ownerSessionId, msg);
          await deliverQuestionAnswerViaResume(ownerSessionId, qr, answers, customAnswer);
        } else {
          // 既不匹配 stdin-unavailable 也不是"已结束"语义的子集，可能是
          // Promise cancel、序列化失败、tab 已迁移等。旧逻辑只 markRequestFailed
          // 把 lifecycle 标 failed 但不清 dock head → 用户既看不到自动答、又点不动；
          // 改为先清 head 再标 failed，让 dock 至少能手动关掉、自动答 effect 也保留机会下轮再处理。
          notificationHub.invalidateControlRequestsForSession(ownerSessionId, msg);
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
      const engineResolver = claudeSessionsOptionsRef.current?.resolveExecutionEngineRef?.current;
      const cursorEngine =
        engineResolver && session ? engineResolver(session) : null;
      if (cursorEngine === "cursor") {
        try {
          const {
            respondCursorAcpPermission,
            respondCursorAcpPlan,
          } = await import("../services/cursorAcp");
          if (pr.tool === "ExitPlanMode") {
            const outcome =
              response === "deny"
                ? { outcome: "rejected", reason: "user denied" }
                : { outcome: "accepted" };
            await respondCursorAcpPlan(tabSessionId, pr.id, outcome);
          } else {
            const decision =
              response === "allow_always"
                ? "allow-always"
                : response === "deny"
                  ? "reject-once"
                  : "allow-once";
            await respondCursorAcpPermission(tabSessionId, pr.id, decision);
          }
          notificationHub.markRequestAnswered(pr.id);
          notificationHub.clearPermission(ownerSessionId);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          notificationHub.markRequestFailed(pr.id, msg);
        }
        return;
      }
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

  // Wise 自动批准：订阅 hub，命中规则时直接调既有 respondToPermission / respondToQuestion，
  // 让 PermissionDock / QuestionDock 完全不弹（off 模式不动，保留人工兜底）。
  // 用 ref 持有「已自动处理过」的 requestId 集合，防止 hub 多次广播 / dock 重渲染导致重复触发。
  const autoApproveHandledRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const handled = autoApproveHandledRef.current;
    let disposed = false;
    const debug = import.meta.env?.DEV === true;

    const tryHandle = () => {
      if (disposed) return;
      const sessions = sessionsRef.current;
      if (!sessions || sessions.length === 0) return;

      for (const session of sessions) {
        const sid = session.id;
        const slice = notificationHub.getDockSlice(sid);
        const repoPath = session.repositoryPath ?? null;

        const pr = slice.permissionRequest;
        if (pr && !handled.has(pr.id)) {
          const life = notificationHub.getRequestLifecycle(pr.id);
          if (!life || life.status === "pending") {
            handled.add(pr.id);
            void (async () => {
              try {
                const mode = await resolveEffectiveAutoApproveMode(repoPath);
                const decision = decidePermissionAutoApprove(mode, {
                  tool: pr.tool,
                  controlSubtype: pr.controlSubtype,
                });
                if (debug) {
                  console.info(
                    `[wise:auto-approve] decide sid=${sid} tool=${pr.tool} mode=${mode} → ${decision}`,
                  );
                }
                if (decision === "allow_once") {
                  // TOCTOU 二次确认：用户可能在 await 期间把模式拨回 off。
                  const recheck = await resolveEffectiveAutoApproveMode(repoPath);
                  const recheckDecision = decidePermissionAutoApprove(recheck, {
                    tool: pr.tool,
                    controlSubtype: pr.controlSubtype,
                  });
                  if (recheckDecision !== "allow_once") {
                    if (debug) {
                      console.info(
                        `[wise:auto-approve] TOCTOU revoke sid=${sid} tool=${pr.tool} mode=${recheck}`,
                      );
                    }
                    handled.delete(pr.id);
                    return;
                  }
                  if (debug) {
                    console.info(
                      `[wise:auto-approve] permission ${pr.tool} → allow_once (mode=${recheck})`,
                    );
                  }
                  await respondToPermission(sid, "allow_once");
                  if (debug) {
                    console.info(`[wise:auto-approve] responded sid=${sid} tool=${pr.tool}`);
                  }
                } else {
                  // 未命中：撤掉 dedup 记录，让用户手动应答后下一次仍可被新的 requestId 走流程。
                  handled.delete(pr.id);
                }
              } catch (err) {
                handled.delete(pr.id);
                console.warn("[wise:auto-approve] permission decide failed", err);
              }
            })();
          } else if (debug) {
            console.info(
              `[wise:auto-approve] skip non-pending sid=${sid} tool=${pr.tool} life=${life?.status}`,
            );
          }
        } else if (pr && debug) {
          console.info(
            `[wise:auto-approve] skip handled sid=${sid} tool=${pr.tool} id=${pr.id}`,
          );
        }

        const qr = slice.questionRequest;
        if (qr && !handled.has(qr.id)) {
          const life = notificationHub.getRequestLifecycle(qr.id);
          if (!life || life.status === "pending") {
            handled.add(qr.id);
            void (async () => {
              try {
                const mode = await resolveEffectiveAutoApproveMode(repoPath);
                const decision = decideQuestionAutoApprove(mode, {
                  options: qr.options,
                  multiSelect: qr.multiSelect,
                });
                if (decision) {
                  // TOCTOU 二次确认（同 permission 分支）。
                  const recheck = await resolveEffectiveAutoApproveMode(repoPath);
                  const recheckDecision = decideQuestionAutoApprove(recheck, {
                    options: qr.options,
                    multiSelect: qr.multiSelect,
                  });
                  if (!recheckDecision) {
                    handled.delete(qr.id);
                    return;
                  }
                  if (debug) {
                    console.info(
                      `[wise:auto-approve] question → answers=[${recheckDecision.answers.join(
                        ",",
                      )}] (mode=${recheck})`,
                    );
                  }
                  await respondToQuestion(
                    sid,
                    recheckDecision.answers,
                    recheckDecision.customAnswer,
                  );
                } else {
                  handled.delete(qr.id);
                }
              } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                // respondToQuestion 在 oneshot worker bootstrap 未完成时抛 sentinel，
                // 要求下个 hub tick 重试：delete handled 让该题重新可被处理，
                // 静默返回（不 warn、不泄漏到 UI）。question 仍 pending、worker 仍 running，
                // 下次 bump（流事件 / expireStale 定时器）会再次进入。
                if (isOneshotBootstrapPendingError(errMsg)) {
                  handled.delete(qr.id);
                  return;
                }
                handled.delete(qr.id);
                console.warn("[wise:auto-approve] question decide failed", err);
              }
            })();
          }
        }
      }

      // GC：handled 体积上限，超过则原地丢弃前半（防长跑会话累积，
      // 同时保留 ref 引用稳定性，避免老闭包持有过期 Set）。
      if (handled.size > 256) {
        const arr = Array.from(handled);
        const keep = new Set(arr.slice(arr.length - 128));
        handled.clear();
        for (const id of keep) handled.add(id);
      }
    };

    // 首次挂载尝试一次（处理已经在 hub 里的 pending request）。
    tryHandle();
    const unsubscribeHub = notificationHub.subscribe(tryHandle);
    // 订阅全局 / 仓库级 auto-approve 设置变更：mode 切换后立即重跑 tryHandle，
    // 让「旧 pending request 在切到更高 mode 时被自动放行」。
    // 不加这个订阅，已存在的 pending request 会一直停在 dock 里等用户手动应答。
    const unsubscribeSettings = subscribeAutoApproveSettings(tryHandle);
    return () => {
      disposed = true;
      unsubscribeHub();
      unsubscribeSettings();
    };
  }, [respondToPermission, respondToQuestion]);

  useEffect(() => {
    const dispose = startAdaptiveInterval(
      () => {
        notificationHub.expireStaleRequests(CONTROL_REQUEST_EXPIRE_MS);
      },
      60_000,
      180_000,
    );
    return dispose;
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

  // 页面卸载前同步刷写未保存的 tabs 状态，避免 companion session 因 debounce 取消而丢失。
  // 同时使用 visibilitychange（更可靠，在 Tauri webview 页面隐藏/刷新时保证触发）与 beforeunload 兜底。
  useEffect(() => {
    const saveNow = () => {
      const latest = latestTabsForSaveRef.current;
      if (!latest.tabsHydrated) return;
      try {
        localStorage.setItem(
          TABS_BACKUP_KEY,
          JSON.stringify({
            version: 1,
            activeSessionId: latest.activeSessionId,
            sessions: latest.sessions.map((ses) => {
              const {
                diskTranscriptPartial: _omitPartial,
                transcriptMemoryUnlimited: _omitUnlimited,
                ...rest
              } = ses;
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
          }),
        );
      } catch {
        /* localStorage full or unavailable */
      }
      const latestSessions = latest.sessions;
      const bindingsChanged = pruneLiveSessionSidecars(latestSessions);
      if (bindingsChanged) {
        persistWorkflowBindings(workflowRunBySessionRef.current);
      }
      void saveSessionTabsState({
        version: 1,
        activeSessionId: latest.activeSessionId,
        sessions: latestSessions.map((ses) => {
          const {
            diskTranscriptPartial: _omitPartial,
            transcriptMemoryUnlimited: _omitUnlimited,
            ...rest
          } = ses;
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
    };
    // visibilitychange 在页面隐藏时触发，比 beforeunload 可靠性更高（Tauri webview 中也能触发）
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") saveNow();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", saveNow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", saveNow);
    };
  }, [pruneLiveSessionSidecars]);

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
    updateSessionUltracodeOverride,
    executeSession,
    executeTerminalSession,
    resumeSessionFromMonitorDrawer,
    ensureSessionForMonitorDrawer,
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
