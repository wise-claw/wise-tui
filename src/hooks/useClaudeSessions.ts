import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
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
} from "../types";
import {
  executeClaudeCode,
  resumeClaudeCode,
  spawnStreamingSession,
  sendStreamingUserMessage,
  closeStreamingSession,
  cancelClaudeExecution,
  getClaudeConfigModel,
  submitClaudeStdinLine,
  listRunningClaudeSessions,
} from "../services/claude";
import { executeCodexCode } from "../services/codex";
import type { SessionExecutionEngine } from "../types";
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
import { normalizeRepositoryPathKey, repositoryPathsMatch } from "../utils/repositoryMainSessionBinding";
import {
  listClaudeDiskSessionsForRepositoryScope,
  normalizeSessionRepositoryPath,
} from "../utils/sessionHistoryScope";
import { loadSessionTabsState, saveSessionTabsState } from "../services/tabsStore";
import {
  PERSIST_SESSION_MESSAGES_MAX,
} from "../constants/claudeMessageListWindow";
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
import { parseClaudeSessionJsonlLines } from "../utils/claudeSessionJsonl";
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
import { createClaudeStreamRuntime } from "../services/claudeStreamRuntime";
import {
  extractPartsFromStreamLine,
  extractSystemErrorMessageFromStreamLine,
  parseStreamLineSessionId,
} from "../services/claudeStreamParser";
import { getAppSetting, setAppSetting } from "../services/appSettingsStore";
import { stopClaudeMainSession } from "../services/stopClaudeMainSession";
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

type ClaudeStreamRuntimeHandlers = ReturnType<typeof createClaudeStreamRuntime>;

function isClaudeConversationMissingError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? "");
  if (!text) return false;
  return /no conversation found with session id/i.test(text);
}

/**
 * oneshot + invocationKey 时 Rust 只发 invocation 通道；按发送时的 tab id 订阅，避免多会话抢 `streamingTargetIdRef`。
 * `onCleaned` 在反注册监听后调用（完成 / 手动 cleanup / 关标签），用于释放 inflight 索引。
 */
async function attachClaudeInvocationStream(
  inv: string,
  stableTabId: string,
  rt: ClaudeStreamRuntimeHandlers,
  turnNonce: number,
  onCleaned?: () => void,
  resolveTurnNonce?: (stableTabId: string, boundNonce: number) => number,
  shouldKeepListeningAfterTurnComplete?: (stableTabId: string) => boolean,
): Promise<() => void> {
  let cleaned = false;
  let uo: UnlistenFn = () => {};
  let ue: UnlistenFn = () => {};
  let uc: UnlistenFn = () => {};
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    safeUnlisten(uo);
    safeUnlisten(ue);
    safeUnlisten(uc);
    onCleaned?.();
  };
  const [uo0, ue0, uc0] = await Promise.all([
    listen(`claude-output:invocation:${inv}`, (e) => {
      rt.handleOutputForSendTab(stableTabId, e.payload);
    }),
    listen(`claude-error:invocation:${inv}`, (e) => {
      rt.handleErrorForSendTab(stableTabId, e.payload);
    }),
    listen(`claude-complete:invocation:${inv}`, (e) => {
      const nonce = resolveTurnNonce?.(stableTabId, turnNonce) ?? turnNonce;
      rt.handleCompleteForSendTab(stableTabId, e.payload, nonce);
      if (!shouldKeepListeningAfterTurnComplete?.(stableTabId)) {
        cleanup();
      }
    }),
  ]);
  uo = uo0;
  ue = ue0;
  uc = uc0;
  return cleanup;
}

/**
 * Streaming 后续轮次无新 invocation_key，按 Claude `session_id` 订阅 stdout/complete。
 */
async function attachClaudeSessionStreamForTurn(
  claudeSessionId: string,
  stableTabId: string,
  rt: ClaudeStreamRuntimeHandlers,
  turnNonce: number,
  onCleaned?: () => void,
  resolveTurnNonce?: (stableTabId: string, boundNonce: number) => number,
  shouldKeepListeningAfterTurnComplete?: (stableTabId: string) => boolean,
): Promise<() => void> {
  const sid = claudeSessionId.trim();
  if (!sid) {
    return () => {};
  }
  let cleaned = false;
  let uo: UnlistenFn = () => {};
  let ue: UnlistenFn = () => {};
  let uc: UnlistenFn = () => {};
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    safeUnlisten(uo);
    safeUnlisten(ue);
    safeUnlisten(uc);
    onCleaned?.();
  };
  const [uo0, ue0, uc0] = await Promise.all([
    listen(`claude-output:${sid}`, (e) => {
      rt.handleOutputForSendTab(stableTabId, e.payload);
    }),
    listen(`claude-error:${sid}`, (e) => {
      rt.handleErrorForSendTab(stableTabId, e.payload);
    }),
    listen(`claude-complete:${sid}`, (e) => {
      const nonce = resolveTurnNonce?.(stableTabId, turnNonce) ?? turnNonce;
      rt.handleCompleteForSendTab(stableTabId, e.payload, nonce);
      if (!shouldKeepListeningAfterTurnComplete?.(stableTabId)) {
        cleanup();
      }
    }),
  ]);
  uo = uo0;
  ue = ue0;
  uc = uc0;
  return cleanup;
}

function generateId() {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function trellisContextIdForTab(tabSessionId: string): string {
  return `wise_${tabSessionId}`;
}

const TRELLIS_CONTEXT_BINDING_STORAGE_KEY = "wise.claudeTrellisContextBindings.v1";

const WORKFLOW_BINDING_STORAGE_KEY = "wise.workflow.sessionRunBindings.v1";
const CONTROL_REQUEST_EXPIRE_MS = 60 * 60 * 1000;
/** resume 子进程从 spawn 到首行 init 写入宿主 registry 的窗口；此期间不因「注册表暂无 sid」把 running 打成 idle */
const CLAUDE_REGISTRY_BOOTSTRAP_WARMUP_MS = 60_000;
/** 全局 `claude-*` 监听挂载晚于首帧时，避免无监听就 `invoke` 导致丢流 */
const CLAUDE_STREAM_RUNTIME_READY_WAIT_MS = 12_000;
const CLAUDE_STREAM_RUNTIME_READY_POLL_MS = 40;
/** 无助手正文时的首轮无输出告警（自上次流式活动起算） */
const CLAUDE_STREAM_STALL_MS = 45_000;
/** Hook 已启动但助手正文仍迟迟未到时，再给一轮宽限 */
const CLAUDE_STREAM_STALL_HOOK_EXTEND_MS = 75_000;

function sessionHasVisibleStreamProgress(session: ClaudeSession): boolean {
  return session.messages.some((m) => {
    if (m.role === "assistant") {
      return m.content.trim().length > 0 || (m.parts?.length ?? 0) > 0;
    }
    if (m.role === "system" && m.content.trim().length > 0) return true;
    return false;
  });
}

function sessionHasHookSystemActivity(session: ClaudeSession): boolean {
  return session.messages.some(
    (m) => m.role === "system" && /Hook|hook|启动中/.test(m.content),
  );
}

function persistWorkflowBindings(map: Map<string, string>): void {
  const payload = Object.fromEntries(Array.from(map.entries()));
  void setAppSetting(WORKFLOW_BINDING_STORAGE_KEY, JSON.stringify(payload));
}

function persistTrellisContextBindings(map: Map<string, string>): void {
  const payload = Object.fromEntries(Array.from(map.entries()));
  void setAppSetting(TRELLIS_CONTEXT_BINDING_STORAGE_KEY, JSON.stringify(payload));
}

function markClaudeRegistryBootstrapWarmup(
  mapRef: MutableRefObject<Map<string, number>>,
  claudeSessionId: string | null | undefined,
) {
  const sid = claudeSessionId?.trim();
  if (!sid) return;
  mapRef.current.set(sid, Date.now() + CLAUDE_REGISTRY_BOOTSTRAP_WARMUP_MS);
}

function pruneClaudeRegistryBootstrapWarmup(
  mapRef: MutableRefObject<Map<string, number>>,
  runningIds: ReadonlySet<string>,
) {
  const m = mapRef.current;
  const now = Date.now();
  for (const [k, until] of m) {
    if (until <= now || runningIds.has(k)) {
      m.delete(k);
    }
  }
}

function resolveTabIdForClaudeStream(
  sessions: ClaudeSession[],
  lineSid: string | null,
  refTid: string | null,
  sessionIdMap?: Map<string, string>,
): string | null {
  if (lineSid) {
    const bySid = sessions.find((s) => s.claudeSessionId === lineSid || s.id === lineSid);
    if (bySid) return bySid.id;
    if (sessionIdMap) {
      for (const s of sessions) {
        if (sessionIdMap.get(s.id) === lineSid) return s.id;
      }
    }
  }
  if (refTid) {
    const byRef = sessions.find((s) => s.id === refTid || s.claudeSessionId === refTid);
    if (byRef) return byRef.id;
    if (sessionIdMap) {
      const mapped = sessionIdMap.get(refTid);
      if (mapped) {
        const byMapped = sessions.find((s) => s.id === mapped || s.claudeSessionId === mapped);
        if (byMapped) return byMapped.id;
      }
      for (const s of sessions) {
        if (sessionIdMap.get(s.id) === refTid) return s.id;
      }
    }
    return refTid;
  }
  return null;
}

/** 与 Rust `ClaudeCompletePayload`（camelCase）及旧版 boolean 兼容。 */
function resolveTabIdFromCompletePayload(
  payload: unknown,
  sessions: ClaudeSession[],
  refTid: string | null,
  sessionIdMap?: Map<string, string>,
): string | null {
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    const o = payload as Record<string, unknown>;
    const raw = o.sessionId ?? o.session_id;
    const sid = typeof raw === "string" ? raw.trim() : "";
    if (sid && sid !== "unknown") {
      const match = sessions.find((s) => s.claudeSessionId === sid || s.id === sid);
      if (match) return match.id;
      if (sessionIdMap) {
        for (const s of sessions) {
          if (sessionIdMap.get(s.id) === sid) return s.id;
        }
      }
      return sid;
    }
  }
  if (typeof payload === "boolean") {
    return refTid ? resolveTabIdForClaudeStream(sessions, null, refTid, sessionIdMap) : null;
  }
  return refTid ? resolveTabIdForClaudeStream(sessions, null, refTid, sessionIdMap) : null;
}

function sessionMatchesDiskId(s: ClaudeSession, diskSessionId: string): boolean {
  return s.claudeSessionId === diskSessionId || s.id === diskSessionId;
}

/** 员工独立会话的展示名形如 `仓库名/员工:张三`，磁盘合并时不能用裸仓库名覆盖，否则归属与通知前缀会错乱。 */
function shouldPreserveRepositoryDisplayName(previous: string): boolean {
  const marker = "员工:";
  const idx = previous.lastIndexOf(marker);
  if (idx < 0) {
    return false;
  }
  return previous.slice(idx + marker.length).trim().length > 0;
}

/** Merges disk index into `prev` without reordering existing tabs; appends new disk-only sessions after the last tab of this repository. */
async function modelsForRepositoryPaths(paths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.map((p) => p.trim()).filter(Boolean))];
  const map = new Map<string, string>();
  await Promise.all(
    unique.map(async (p) => {
      try {
        const m = await getClaudeConfigModel(p);
        if (m?.trim()) map.set(p, m.trim());
      } catch {
        /* ignore */
      }
    }),
  );
  return map;
}

/** 刷新磁盘索引后，去掉「已有 Claude session_id 但 jsonl 已不在磁盘、且无本地消息」的幽灵标签。 */
export function pruneGhostRepositorySessions(
  sessions: ClaudeSession[],
  repositoryPath: string,
  disk: ClaudeDiskSessionItem[],
): ClaudeSession[] {
  // 列表失败或尚未扫描时不裁剪，避免误删仍存在于 ~/.claude/projects 的会话标签。
  if (disk.length === 0) {
    return sessions;
  }
  const diskIds = new Set(disk.map((d) => d.sessionId));
  return sessions.filter((s) => {
    if (!repositoryPathsMatch(s.repositoryPath, repositoryPath)) return true;
    if (s.status === "running" || s.status === "connecting") return true;
    const claudeId = s.claudeSessionId?.trim();
    if (!claudeId) return true;
    if (diskIds.has(claudeId) || diskIds.has(s.id)) return true;
    if (s.messages.length > 0) return true;
    return false;
  });
}

/** @internal Exported for unit tests. */
export function mergeRepositoryDiskSessions(
  prev: ClaudeSession[],
  repositoryPath: string,
  repositoryName: string,
  disk: ClaudeDiskSessionItem[],
  configFallbackModel: string,
): ClaudeSession[] {
  const canonicalPath = normalizeRepositoryPathKey(repositoryPath) || repositoryPath.trim();
  const pruned = pruneGhostRepositorySessions(prev, canonicalPath, disk);
  const copy = pruned.map((s) => ({ ...s }));

  for (let i = 0; i < copy.length; i++) {
    if (!repositoryPathsMatch(copy[i].repositoryPath, canonicalPath)) continue;
    const s = copy[i];
    const item = disk.find((d) => sessionMatchesDiskId(s, d.sessionId));
    if (item) {
      const preserveWiseTabId = isTerminalWorkerWiseTab(s);
      copy[i] = {
        ...s,
        id: preserveWiseTabId ? s.id : item.sessionId,
        claudeSessionId: item.sessionId,
        repositoryPath: canonicalPath,
        repositoryName: shouldPreserveRepositoryDisplayName(s.repositoryName) ? s.repositoryName : repositoryName,
        model: item.modelHint ?? s.model,
        diskPreview: item.preview || s.diskPreview,
        createdAt: Math.min(s.createdAt, item.updatedAtMs),
      };
    } else {
      copy[i] = { ...s, repositoryPath: canonicalPath };
    }
  }

  const toAdd = disk.filter(
    (d) => !copy.some((s) => repositoryPathsMatch(s.repositoryPath, canonicalPath) && sessionMatchesDiskId(s, d.sessionId)),
  );
  if (toAdd.length === 0) {
    return copy;
  }

  const newRows: ClaudeSession[] = toAdd.map((item) => ({
    id: item.sessionId,
    claudeSessionId: item.sessionId,
    repositoryPath: canonicalPath,
    repositoryName,
    model: item.modelHint ?? configFallbackModel,
    status: "completed" as const,
    messages: [],
    createdAt: item.updatedAtMs,
    pendingPrompt: "",
    diskPreview: item.preview,
  }));

  let lastIdx = -1;
  for (let i = 0; i < copy.length; i++) {
    if (repositoryPathsMatch(copy[i].repositoryPath, canonicalPath)) lastIdx = i;
  }
  if (lastIdx === -1) {
    return [...copy, ...newRows];
  }
  return [...copy.slice(0, lastIdx + 1), ...newRows, ...copy.slice(lastIdx + 1)];
}

export interface ClaudeTurnCompletePayload {
  sessionId: string;
  success: boolean;
  assistantPreviewRaw: string;
  /** T5: Tool/Structured 主路径可直接携带机器可读 verdict。 */
  structuredVerdict?: unknown;
}

interface UseClaudeSessionsOptions {
  /** 一轮 Claude 输出结束（成功或失败）时调用；用于团队流程自动推进 */
  onClaudeTurnComplete?: (payload: ClaudeTurnCompletePayload) => void;
  /**
   * 在即将 `executeClaudeCode` / `resumeClaudeCode` 启动子进程前调用（oneshot 下每轮都会起进程）。
   * 由 App 注入：按项目+仓库并发上限拦截。
   */
  beforeSpawnClaudeRef?: MutableRefObject<
    ((session: ClaudeSession) => { ok: true } | { ok: false; message: string }) | null
  >;
  /** `beforeSpawnClaudeRef` 返回 `ok: false` 时展示 */
  onClaudeSpawnBlocked?: (message: string) => void;
  /**
   * 传给 `execute_claude_code` / `resume_claude_code` 的并发槽位（Rust 侧与侧栏上限一致）。
   * 由 App 注入；无法解析仓库归属时可返回 null（不占用后台槽位）。
   */
  claudeConcurrencyInvokeContextRef?: MutableRefObject<
    ((session: ClaudeSession) => { concurrencyScopeKey: string; concurrencyLimit: number } | null) | null
  >;
  /**
   * 主会话 spawn 前解析 CLI 扩展（助手 tools / systemPrompt 等）；省略则仅使用 Claude Code 默认配置。
   */
  claudeSpawnExtrasContextRef?: MutableRefObject<
    ((session: ClaudeSession) => Promise<ClaudeSpawnCliExtras | null>) | null
  >;
  /** 多屏模式下额外窗格绑定的会话 id 列表，用于磁盘 JSONL 拉取与运行态探测 */
  companionSessionIds?: string[];
  /** @deprecated 使用 companionSessionIds；保留向后兼容 */
  companionSessionId?: string | null;
  /** 流式 init 将临时 tab id 合并为真实 `session_id` 时回调（同步双栏右侧绑定） */
  onSessionTabIdMigrated?: (fromTabId: string, toClaudeSessionId: string) => void;
  /** 解析会话应使用的执行引擎（主会话读仓库配置，成员会话读员工配置）。 */
  resolveExecutionEngineRef?: MutableRefObject<
    ((session: ClaudeSession) => SessionExecutionEngine) | null
  >;
}

type SessionExecuteOpts = ClaudeComposerExecuteBubbleOptions & {
  /** 仅 `executeTerminalSession` 使用：强制新 Claude 回合。 */
  terminalFreshTurn?: boolean;
};

interface UseClaudeSessionsReturn {
  sessions: ClaudeSession[];
  sessionsLiveRef: MutableRefObject<ClaudeSession[]>;
  activeSessionId: string | null;
  createSession: (
    repositoryPath: string,
    repositoryName: string,
    opts?: { skipActivate?: boolean; connectionKind?: ClaudeSessionConnectionKind },
  ) => Promise<string>;
  updateSessionModel: (sessionId: string, model: string) => void;
  /** 切换本标签连接方式；运行中拒绝；会结束长驻子进程以便下一条按新模式拉起。 */
  updateSessionConnectionKind: (
    sessionId: string,
    kind: ClaudeSessionConnectionKind,
  ) => Promise<void>;
  /** 返回 false 表示未启动（例如并发门闸拦截）；其余路径为 true（含已安排重试的暂不可见会话）。 */
  executeSession: (sessionId: string, prompt: string, opts?: ClaudeComposerExecuteBubbleOptions) => boolean;
  executeTerminalSession: (
    sessionId: string,
    outboundPrompt: string,
    opts?: { userBubblePrompt?: string },
  ) => boolean;
  appendSystemMessage: (sessionId: string, text: string) => void;
  /** 仅写入用户气泡（不调用 Claude），供批量 OMC 等在标签内展示派发正文 */
  appendUserMessage: (sessionId: string, text: string) => void;
  sendMessage: (prompt: string) => void;
  sendMessageToSession: (sessionId: string, prompt: string, opts?: ClaudeComposerExecuteBubbleOptions) => void;
  closeSession: (sessionId: string) => void;
  /**
   * 物理删除磁盘 jsonl（`~/.claude/projects/<encoded>/<sid>.jsonl`）并清理内存标签。
   *
   * 行为：
   * - 运行中 / 连接中（status === "running" | "connecting"）会拒绝并抛错；
   * - 仅存在于内存的草稿（无 `claudeSessionId`）不会调用后端，但仍会触发 `closeSession`；
   * - 后端 IPC 失败时抛错，标签不会被清掉，便于上层 toast 后用户重试。
   *
   * 调用方必须先做二次确认（jsonl 删除不可恢复）。
   */
  deleteSession: (sessionId: string) => Promise<void>;
  switchSession: (sessionId: string) => void;
  cancelSession: (sessionId: string, opts?: { retractLastUserTurn?: boolean }) => void;
  /** 结束当前对话子代理 / 任务：标记 tool_use、取消 Claude 执行并刷新会话状态 */
  stopSessionConversationTask: (item: SessionConversationTaskItem) => boolean;
  respondToQuestion: (sessionId: string, answers: string[], customAnswer?: string) => void;
  /** 关闭选择题 Dock：已过期/失败则仅收起；仍可操作时等同于跳过（空选提交） */
  dismissQuestion: (sessionId: string) => void;
  respondToPermission: (sessionId: string, response: "allow_once" | "allow_always" | "deny") => void;
  clearTodos: (sessionId: string) => void;
  restoreTodosFromTranscript: (sessionId: string) => void;
  restorePendingPermissionFromTranscript: (sessionId: string) => void;
  toggleTodo: (sessionId: string, todoId: string) => void;
  clearFollowups: (sessionId: string) => void;
  clearRevertItems: (sessionId: string) => void;
  sendFollowup: (sessionId: string, id: string) => void;
  restoreRevert: (sessionId: string, itemId: string) => Promise<void>;
  refreshDiskSessionsForRepository: (repositoryPath: string, repositoryName: string) => Promise<void>;
  /** False until ~/.wise/tabs.json has been read (or missing); gate disk refresh until then. */
  tabsHydrated: boolean;
  /** 从磁盘读取完整 jsonl 覆盖该标签的 messages（`sessionKey` 可为标签 id 或 `claudeSessionId`） */
  reloadFullDiskTranscript: (sessionKey: string) => Promise<void>;
  /** 手动触发 Claude Code `/compact` 压缩会话历史 */
  compactSessionHistory: (sessionId: string) => Promise<void>;
  /**
   * 结束指定标签对应的本机长驻/逐轮子进程（不关标签、不删绑定）。
   * 用于仓库/项目主会话换绑前释放旧进程，保证同一绑定仅一个长驻子进程。
   */
  releaseSessionHostProcess: (sessionId: string) => Promise<void>;
}

export function useClaudeSessions(options?: UseClaudeSessionsOptions): UseClaudeSessionsReturn {
  const companionSessionIds = useMemo(() => {
    const ids = new Set<string>();
    if (options?.companionSessionIds) {
      for (const id of options.companionSessionIds) {
        if (id) ids.add(id);
      }
    }
    if (options?.companionSessionId) ids.add(options.companionSessionId);
    return Array.from(ids);
  }, [options?.companionSessionIds, options?.companionSessionId]);
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  /** 流式事件可能在同一帧连发多行；须在 `setSessions` updater 内同步 ref，避免 init 后 assistant 行因 ref 过期被丢弃。 */
  const commitSessions = useCallback((updater: (prev: ClaudeSession[]) => ClaudeSession[]) => {
    setSessions((prev) => {
      const next = updater(prev);
      sessionsRef.current = next;
      return next;
    });
  }, []);
  const [trellisContextBindingsHydrated, setTrellisContextBindingsHydrated] = useState(false);
  const onClaudeTurnCompleteRef = useRef(options?.onClaudeTurnComplete);
  onClaudeTurnCompleteRef.current = options?.onClaudeTurnComplete;
  const onSessionTabIdMigratedRef = useRef(options?.onSessionTabIdMigrated);
  onSessionTabIdMigratedRef.current = options?.onSessionTabIdMigrated;
  const claudeSessionsOptionsRef = useRef(options);
  claudeSessionsOptionsRef.current = options;
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [tabsHydrated, setTabsHydrated] = useState(false);
  const workflowRunBySessionRef = useRef<Map<string, string>>(new Map());
  const sessionIdMapRef = useRef<Map<string, string>>(new Map());
  const executeSessionRetryCountRef = useRef<Map<string, number>>(new Map());
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
        if (
          sessionHasHookSystemActivity(session) &&
          !streamStallHookExtendedByTabRef.current.has(key)
        ) {
          streamStallHookExtendedByTabRef.current.add(key);
          const extendTimer = window.setTimeout(fireStallCheck, CLAUDE_STREAM_STALL_HOOK_EXTEND_MS);
          streamStallTimerByTabRef.current.set(key, extendTimer);
          return;
        }
        commitSessions((prev) =>
          appendSystemMessageBySessionId(
            prev.map((s) =>
              s.id === session.id ? { ...s, status: "error" as const } : s,
            ),
            session.id,
            "Claude 子进程长时间无可见输出。请点「结束」后重试；若反复出现，可暂时关闭 Cockpit 助手 MCP 或在终端用 stream-json 自检。",
          ),
        );
      };
      const timer = window.setTimeout(fireStallCheck, CLAUDE_STREAM_STALL_MS);
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

  const detachClaudeInvocationsForSessionKey = useCallback((closedId: string) => {
    const ids = new Set<string>([closedId]);
    const mapped = sessionIdMapRef.current.get(closedId);
    if (mapped) ids.add(mapped);
    for (const [temp, real] of sessionIdMapRef.current.entries()) {
      if (real === closedId) ids.add(temp);
    }
    for (const id of ids) {
      trellisContextIdBySessionRef.current.delete(id);
    }
    persistTrellisContextBindings(trellisContextIdBySessionRef.current);
    for (const [, meta] of [...claudeInvocationInflightRef.current.entries()]) {
      if (ids.has(meta.tabId)) {
        meta.detach();
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
    }) => {
      const { tabSessionId, turnNonce, repositoryPath, prompt, modelArg } = params;
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
      try {
        await executeCodexCode(
          repositoryPath,
          prompt,
          modelArg,
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
    }) => {
      const session = sessionsRef.current.find((s) => s.id === params.tabSessionId);
      const resolver = claudeSessionsOptionsRef.current?.resolveExecutionEngineRef?.current;
      const engine: SessionExecutionEngine =
        session && resolver ? resolver(session) : "claude";
      if (engine === "codex") {
        await runCodexOneshotWithInvocation({
          tabSessionId: params.tabSessionId,
          turnNonce: params.turnNonce,
          repositoryPath: params.repositoryPath,
          prompt: params.prompt,
          modelArg: params.modelArg,
        });
        return;
      }
      if (sessionUsesStreamingConnection(session, defaultConnectionKindRef.current)) {
        await runClaudeStreamingWithInvocation(params);
      } else {
        await runClaudeOneshotWithInvocation(params);
      }
    },
    [runClaudeStreamingWithInvocation, runClaudeOneshotWithInvocation, runCodexOneshotWithInvocation],
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
  /** Tauri 主窗口是否在前台（与 `document.hidden` 组合判断 Phase 4 桌面摘要）。 */
  const mainWinFocusedRef = useRef(true);

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
  }, [flushBlockingDesktopIfHidden]);

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
      const cc = input.claudeSessionId.trim();
      const tab = input.tabId.trim();
      if (!rp || !cc) return;
      try {
        const lines = await loadClaudeSessionJsonl(rp, cc);
        const messages = parseClaudeSessionJsonlLines(lines);
        if (messages.length === 0) return;
        setSessions((prev) =>
          prev.map((sess) => {
            const match =
              sess.id === tab || sess.claudeSessionId === cc || sess.id === cc || sess.claudeSessionId === tab;
            if (!match) return sess;
            const nextMessages = isTerminalWorkerWiseTab(sess)
              ? sanitizeTerminalWorkerTranscriptMessages(messages)
              : messages;
            return { ...sess, messages: nextMessages, diskTranscriptPartial: false };
          }),
        );
      } catch {
        /* 落盘略晚或路径异常时不打断用户 */
      }
    },
    [setSessions],
  );

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
    }) => {
      const { tabSessionId, prompt, repositoryPath, ...invokeRest } = params;
      const session = sessionsRef.current.find((s) => s.id === tabSessionId);
      if (!session) {
        await invokeClaudeTurn(params);
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
        await runCodexOneshotWithInvocation({
          tabSessionId,
          turnNonce: params.turnNonce,
          repositoryPath,
          prompt,
          modelArg: params.modelArg,
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
    [invokeClaudeTurn, reloadTranscriptFromDisk, runCodexOneshotWithInvocation],
  );

  const reloadFullDiskTranscript = useCallback(
    async (sessionKey: string) => {
      const raw = sessionKey.trim();
      if (!raw) return;
      const s = sessionsRef.current.find((x) => x.id === raw || x.claudeSessionId === raw);
      if (!s) return;
      const tid = s.id;
      const rp = s.repositoryPath?.trim();
      const cc = s.claudeSessionId?.trim();
      if (!rp || !cc) return;
      try {
        const lines = await loadClaudeSessionJsonl(rp, cc);
        const messages = parseClaudeSessionJsonlLines(lines);
        if (messages.length === 0) return;
        const nextMessages = isTerminalWorkerWiseTab(s)
          ? sanitizeTerminalWorkerTranscriptMessages(messages)
          : messages;
        setSessions((prev) =>
          prev.map((sess) =>
            sess.id === tid ? { ...sess, messages: nextMessages, diskTranscriptPartial: false } : sess,
          ),
        );
      } catch {
        /* ignore */
      }
    },
    [setSessions],
  );

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
            return cfg ? { ...s, model: cfg } : s;
          });
          let trellisContextChanged = false;
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
      migrateSessionKey: (from, to) => notificationHub.migrateSessionKey(from, to),
      notifyCompletion: ({ tid, success, nonce, previewRaw, structuredVerdict }) => {
        clearStreamStallTimer(tid);
        const session = sessionsRef.current.find((s) => s.id === tid || s.claudeSessionId === tid);
        const tabSessionId = session?.id ?? tid;
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
      let resolved: string | null = null;
      try {
        const fromCfg = await getClaudeConfigModel(mergePath);
        if (fromCfg?.trim()) resolved = fromCfg.trim();
      } catch {
        return;
      }
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
  }, []);

  useEffect(() => {
    if (!activeSessionId) return;
    const s = sessionsRef.current.find((x) => x.id === activeSessionId);
    if (!s?.claudeSessionId || s.messages.length > 0) return;
    if (s.status === "running" || s.status === "connecting") return;
    if (diskLoadDoneRef.current.has(s.id)) return;
    diskLoadDoneRef.current.add(s.id);
    const loadKey = s.id;

    let cancelled = false;
    void (async () => {
      try {
        const lines = await loadClaudeSessionJsonl(s.repositoryPath, s.claudeSessionId!);
        if (cancelled) return;
        const messages = parseClaudeSessionJsonlLines(lines);
        const nextMessages = isTerminalWorkerWiseTab(s)
          ? sanitizeTerminalWorkerTranscriptMessages(messages)
          : messages;
        setSessions((prev) =>
          prev.map((sess) =>
            sess.id === loadKey ? { ...sess, messages: nextMessages, diskTranscriptPartial: false } : sess,
          ),
        );
      } catch {
        diskLoadDoneRef.current.delete(loadKey);
      }
    })();

    return () => {
      cancelled = true;
      diskLoadDoneRef.current.delete(loadKey);
    };
  }, [activeSessionId]);

  useEffect(() => {
    if (companionSessionIds.length === 0) return;
    const cleanups: Array<() => void> = [];
    for (const cid of companionSessionIds) {
      const s = sessionsRef.current.find((x) => x.id === cid);
      if (!s?.claudeSessionId || s.messages.length > 0) continue;
      if (s.status === "running" || s.status === "connecting") continue;
      if (diskLoadDoneRef.current.has(s.id)) continue;
      diskLoadDoneRef.current.add(s.id);
      const loadKey = s.id;

      let cancelled = false;
      void (async () => {
        try {
          const lines = await loadClaudeSessionJsonl(s.repositoryPath, s.claudeSessionId!);
          if (cancelled) return;
          const messages = parseClaudeSessionJsonlLines(lines);
          const nextMessages = isTerminalWorkerWiseTab(s)
            ? sanitizeTerminalWorkerTranscriptMessages(messages)
            : messages;
          setSessions((prev) =>
            prev.map((sess) =>
              sess.id === loadKey ? { ...sess, messages: nextMessages, diskTranscriptPartial: false } : sess,
            ),
          );
        } catch {
          diskLoadDoneRef.current.delete(loadKey);
        }
      })();

      cleanups.push(() => {
        cancelled = true;
        diskLoadDoneRef.current.delete(loadKey);
      });
    }
    return () => {
      for (const fn of cleanups) fn();
    };
  }, [companionSessionIds]);

  /** 非活动/非多屏伴生标签：丢弃正文，仅保留元数据；切回时再从磁盘懒加载（running 与无磁盘 id 的纯本地草稿保留） */
  useEffect(() => {
    if (!tabsHydrated) return;
    const keep = new Set<string>();
    if (activeSessionId) keep.add(activeSessionId);
    for (const cid of companionSessionIds) keep.add(cid);
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (keep.has(s.id)) return s;
        if (isTerminalWorkerWiseTab(s)) return s;
        if (s.status === "running" || s.status === "connecting") return s;
        const hasDisk = Boolean(s.claudeSessionId?.trim());
        if (!hasDisk && s.messages.length > 0) return s;
        if (s.messages.length === 0) return s;
        changed = true;
        return { ...s, messages: [], diskTranscriptPartial: false };
      });
      return changed ? next : prev;
    });
  }, [tabsHydrated, activeSessionId, companionSessionIds]);

  /** 主会话 / 员工 / 团队等全部标签：定期与 Claude Code 宿主注册表对齐执行态（不限于当前活动标签）。 */
  useEffect(() => {
    let cancelled = false;
    const VISIBLE_POLL_MS = 8000;
    const HIDDEN_POLL_MS = 20000;

    const tick = async () => {
      try {
        const list = await listRunningClaudeSessions();
        if (cancelled) return;
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
        setSessions((prev) =>
          reconcileSessionStatusesWithRunningRegistry(
            prev,
            runningIds,
            registryBootstrapDeadlineByClaudeSidRef.current,
            knownIds,
          ),
        );
      } catch {
        /* 与流式事件并存：拉取失败则保持当前 UI */
      }
    };

    void tick();
    const intervalMs =
      typeof document !== "undefined" && document.visibilityState === "visible"
        ? VISIBLE_POLL_MS
        : HIDDEN_POLL_MS;
    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void tick();
    }, intervalMs);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
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
          const fromCfg = await getClaudeConfigModel(repositoryPath);
          if (!fromCfg?.trim()) return;
          const model = fromCfg.trim();
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
    [],
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
      if (forceFreshClaudeSession) {
        sessionIdMapRef.current.delete(sessionId);
        const staleClaudeSid = session.claudeSessionId?.trim();
        if (staleClaudeSid) {
          void cancelClaudeExecution(staleClaudeSid).catch(() => {});
          streamingProcessByTabRef.current.delete(sessionId);
        }
      }
      const claudeSidRaw =
        session.claudeSessionId ?? sessionIdMapRef.current.get(sessionId) ?? null;
      const claudeSid = forceFreshClaudeSession ? null : claudeSidRaw;

      const liveSession = sessionsRef.current.find((s) => s.id === sessionId) ?? session;
      // 首轮已启动但尚未收到 stream-json 的 session_id 时，避免再 spawn 第二个进程。
      // 终端派发强制新回合时已主动取消旧进程并重置为 idle，不得在此阻塞。
      if (!claudeSid && liveSession.status === "running" && !forceFreshClaudeSession) {
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
      const bubblePrompt = opts?.userBubblePrompt?.trim() ? opts.userBubblePrompt : prompt;
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
          });
        } catch (err) {
          clearStreamStallTimer(sessionId);
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
    [clearStreamStallTimer, commitSessions, runClaudeTurnWithContextGuard, scheduleStreamStallTimer],
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
    [runClaudeTurnWithContextGuard],
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

      expectedTurnNonceByTabIdRef.current.delete(sessionId);
      if (session.claudeSessionId?.trim()) {
        expectedTurnNonceByTabIdRef.current.delete(session.claudeSessionId.trim());
      }
      detachClaudeInvocationsForSessionKey(sessionId);
      streamingProcessByTabRef.current.delete(sessionId);
      const streamTarget = streamingTargetIdRef.current?.trim();
      if (
        streamTarget &&
        (streamTarget === sessionId || streamTarget === session.claudeSessionId?.trim())
      ) {
        streamingTargetIdRef.current = null;
      }

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
    [commitSessions, detachClaudeInvocationsForSessionKey],
  );

  const closeSession = useCallback((sessionId: string) => {
    const victim = sessionsRef.current.find((s) => s.id === sessionId);
    expectedTurnNonceByTabIdRef.current.delete(sessionId);
    if (victim?.claudeSessionId?.trim()) {
      expectedTurnNonceByTabIdRef.current.delete(victim.claudeSessionId.trim());
    }
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
    notificationHub.removeSession(sessionId);
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    setActiveSessionId((prev) => {
      if (prev === sessionId) return null;
      return prev;
    });
    sessionIdMapRef.current.delete(sessionId);
    executeSessionRetryCountRef.current.delete(sessionId);
    workflowRunBySessionRef.current.delete(sessionId);
    persistWorkflowBindings(workflowRunBySessionRef.current);
  }, [detachClaudeInvocationsForSessionKey]);

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
      if (realSessionId) {
        cancelClaudeExecution(realSessionId).catch((err) => {
          console.error("Failed to cancel session:", err);
        });
        void closeStreamingSession(realSessionId).catch(() => {
          /* 长驻进程可能已退出 */
        });
      }
      streamingProcessByTabRef.current.delete(sessionId);
      if (opts?.retractLastUserTurn) {
        const tabId = sessionId;
        assistantStreamTextByTabRef.current.delete(tabId);
        if (session?.claudeSessionId?.trim()) {
          assistantStreamTextByTabRef.current.delete(session.claudeSessionId.trim());
        }
        const refT = streamingTargetIdRef.current;
        if (refT !== null && (refT === tabId || refT === session?.claudeSessionId?.trim())) {
          streamingTargetIdRef.current = null;
        }
      }
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          if (opts?.retractLastUserTurn) {
            return retractLastClaudeTurnFromSession(s);
          }
          return { ...s, status: "cancelled" as const };
        }),
      );
    },
    [],
  );

  const stopSessionConversationTask = useCallback((item: SessionConversationTaskItem): boolean => {
    if (item.status !== "running" || !item.cancellable) return false;
    const sid = item.sessionId?.trim();
    if (!sid) return false;

    const session = sessionsRef.current.find((s) => s.id === sid);
    const realSessionId =
      session?.claudeSessionId ?? sessionIdMapRef.current.get(sid) ?? null;
    if (realSessionId) {
      cancelClaudeExecution(realSessionId).catch((err) => {
        console.error("Failed to cancel session:", err);
      });
      void closeStreamingSession(realSessionId).catch(() => {
        /* 长驻进程可能已退出 */
      });
    }
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
  }, []);

  /** 供 stream runtime `notifyCompletion` 在 AskUserQuestion 等待续答时挂载 session 通道监听。 */
  const prepareStreamingControlResponseListenerRef = useRef<
    (tabSessionId: string, claudeSessionId: string, turnNonce?: number) => Promise<void>
  >(() => Promise.resolve());

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
      const list = await listRunningClaudeSessions();
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
        let next = reconcileSessionStatusesWithRunningRegistry(
          prev,
          runningIds,
          registryBootstrapDeadlineByClaudeSidRef.current,
          knownIds,
        );
        // 长驻单轮 complete 后注册表常为 completed；AskUserQuestion 续答刚 mark_running 前不要被 reconcile 打成 idle。
        next = next.map((s) => {
          if (s.status === "running" || s.status === "connecting") return s;
          if (!streamingProcessByTabRef.current.has(s.id)) return s;
          if (!sessionUsesStreamingConnection(s, defaultConnectionKindRef.current)) return s;
          const sid = s.claudeSessionId?.trim();
          if (!sid) return s;
          return { ...s, status: "running" as const };
        });
        return next;
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
      const session = sessionsRef.current.find(
        (s) => s.id === ownerSessionId || s.claudeSessionId === ownerSessionId,
      );
      const tabSessionId = session?.id ?? ownerSessionId;
      const claudeSid =
        session?.claudeSessionId?.trim() ??
        sessionIdMapRef.current.get(tabSessionId)?.trim() ??
        null;
      const liveStreamingProcess = hasLiveStreamingClaudeProcess({
        session,
        defaultConnectionKind: defaultConnectionKindRef.current,
        streamingTabTracked: streamingProcessByTabRef.current.has(tabSessionId),
        streamingProcessClaudeSessionId: streamingProcessByTabRef.current.get(tabSessionId)?.claudeSessionId,
      });
      const userAnswerText = buildQuestionFallbackUserPrompt(qr, answers, customAnswer);
      const preferStdinControlResponse =
        liveStreamingProcess ||
        Boolean(
          session &&
            sessionUsesStreamingConnection(session, defaultConnectionKindRef.current) &&
            claudeSid,
        );

      let configModel: string | null = null;
      if (session?.repositoryPath?.trim()) {
        try {
          configModel = (await getClaudeConfigModel(session.repositoryPath))?.trim() ?? null;
        } catch {
          configModel = null;
        }
      }
      const proxyStreamingQuestion =
        session &&
        sessionUsesStreamingConnection(session, defaultConnectionKindRef.current) &&
        shouldUseProxyQuestionResumeDelivery(session.model, configModel);

      // Qwen 等代理：长驻子进程在 AskUserQuestion 后无法靠 control_response / 同进程 user 行续跑，须结束旧进程再以 resume 起新轮。
      if (proxyStreamingQuestion) {
        if (claudeSid) {
          await closeStreamingSession(claudeSid).catch(() => {
            /* 可能已退出 */
          });
        }
        streamingProcessByTabRef.current.delete(tabSessionId);
        streamingSessionStreamDetachByTabRef.current.get(tabSessionId)?.();
        streamingSessionStreamDetachByTabRef.current.delete(tabSessionId);
        detachClaudeInvocationStreamsForTab(tabSessionId);
        await deliverQuestionAnswerViaResume(ownerSessionId, qr, answers, customAnswer);
        return;
      }

      // 子进程已结束、stdin 已回收，或上次 stdin 失败：首次点击即走 resume，避免先报错再点「重新提交」。
      // 长驻 streaming 单轮 result 后 UI 会 idle/expired，但子进程仍等 control_response，必须优先写 stdin。
      if (shouldDeliverQuestionViaResume(qrLife, session, { preferStdinControlResponse })) {
        await deliverQuestionAnswerViaResume(ownerSessionId, qr, answers, customAnswer);
        return;
      }

      const targetSessionId = claudeSid ?? session?.id ?? ownerSessionId;
      const nextTurnNonce =
        preferStdinControlResponse && claudeSid
          ? (() => {
              streamTurnSeqRef.current += 1;
              return streamTurnSeqRef.current;
            })()
          : null;
      try {
        appendUserMessage(tabSessionId, userAnswerText);
        if (nextTurnNonce !== null && claudeSid) {
          expectedTurnNonceByTabIdRef.current.set(tabSessionId, nextTurnNonce);
          streamingTargetIdRef.current = tabSessionId;
          markClaudeRegistryBootstrapWarmup(registryBootstrapDeadlineByClaudeSidRef, claudeSid);
          streamingProcessByTabRef.current.set(tabSessionId, { claudeSessionId: claudeSid });
          commitSessions((prev) =>
            prev.map((s) =>
              s.id === tabSessionId ? { ...s, status: "running" as const } : s,
            ),
          );
          await prepareStreamingControlResponseListener(tabSessionId, claudeSid, nextTurnNonce);
          scheduleStreamStallTimer(tabSessionId);
        }
        await submitClaudeStdinLine(buildQuestionStdinLine(qr.id, answers, customAnswer, qr), targetSessionId);
        const needsStreamUserFallback =
          preferStdinControlResponse &&
          claudeSid &&
          userAnswerText.trim().length > 0 &&
          isToolUseQuestionRequestId(qr.id);
        if (needsStreamUserFallback) {
          await sendStreamingUserMessage(claudeSid, userAnswerText).catch(() => {
            /* control_response 已写入时忽略重复用户行失败 */
          });
        }
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
      prepareStreamingControlResponseListener,
      scheduleStreamStallTimer,
      syncSessionStatusesWithHostRegistry,
    ],
  );

  const dismissQuestion = useCallback(
    (sessionId: string) => {
      const qr = notificationHub.getDockSlice(sessionId).questionRequest;
      if (!qr) return;
      const life = notificationHub.getRequestLifecycle(qr.id)?.status;
      const ownerSessionId = notificationHub.findRequestSessionId(qr.id) ?? sessionId;
      if (life === "expired" || life === "failed") {
        notificationHub.userDismissNonPendingQuestionHeadAt(ownerSessionId);
        return;
      }
      void respondToQuestion(sessionId, []);
    },
    [respondToQuestion],
  );

  const respondToPermission = useCallback(
    async (sessionId: string, response: "allow_once" | "allow_always" | "deny") => {
      const pr = notificationHub.getDockSlice(sessionId).permissionRequest;
      if (!pr) return;
      const prLife = notificationHub.getRequestLifecycle(pr.id);
      if (prLife?.status === "expired") {
        message.warning("该权限请求已随上一轮进程结束，无法提交。请重新发起对话后再操作。");
        return;
      }
      const ownerSessionId = notificationHub.findRequestSessionId(pr.id) ?? sessionId;
      const session = sessionsRef.current.find((s) => s.id === ownerSessionId || s.claudeSessionId === ownerSessionId);
      const targetSessionId = session?.claudeSessionId ?? session?.id ?? ownerSessionId;
      const payload = buildPermissionStdinLine(pr.id, response, pr.toolInput, pr.toolUseId);
      const tabSessionId = session?.id ?? ownerSessionId;
      const claudeSid =
        session?.claudeSessionId?.trim() ??
        sessionIdMapRef.current.get(tabSessionId)?.trim() ??
        null;
      const preferStdin =
        session &&
        claudeSid &&
        sessionUsesStreamingConnection(session, defaultConnectionKindRef.current);
      const nextTurnNonce = preferStdin
        ? (() => {
            streamTurnSeqRef.current += 1;
            return streamTurnSeqRef.current;
          })()
        : null;
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
    const session = sessionsRef.current.find((s) => s.id === sessionId || s.claudeSessionId === sessionId);
    if (!session) return;
    const batch = extractLatestTodoWriteFromMessages(session.messages);
    if (!batch) return;
    notificationHub.restoreTodosFromTranscript(sessionId, batch.items, batch.merge);
    if (session.claudeSessionId && session.claudeSessionId !== sessionId) {
      notificationHub.restoreTodosFromTranscript(session.claudeSessionId, batch.items, batch.merge);
    }
  }, []);

  const restorePendingPermissionFromTranscript = useCallback((sessionId: string) => {
    const session = sessionsRef.current.find((s) => s.id === sessionId || s.claudeSessionId === sessionId);
    if (!session) return;
    ingestPendingPermissionsFromSessionMessages(sessionId, session.messages);
    if (session.claudeSessionId && session.claudeSessionId !== sessionId) {
      ingestPendingPermissionsFromSessionMessages(session.claudeSessionId, session.messages);
    }
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
      const item = notificationHub.getDockSlice(sessionId).followupItems.find((f) => f.id === id);
      if (item) {
        sendMessageToSession(sessionId, item.text);
        notificationHub.removeFollowupItem(sessionId, id);
      }
    },
    [sendMessageToSession],
  );

  const restoreRevert = useCallback(
    async (sessionId: string, itemId: string) => {
      const tabSession = sessionsRef.current.find((s) => s.id === sessionId);
      if (!tabSession) return;

      const item = notificationHub.getDockSlice(sessionId).revertItems.find((r) => r.id === itemId);
      if (!item) return;

      const body = item.text.trim();
      if (!body) {
        notificationHub.removeRevertItem(sessionId, itemId);
        return;
      }

      const prompt = `请按此前给出的回退点执行恢复：\n${body}`;
      try {
        await sendMessageToSession(sessionId, prompt);
        notificationHub.removeRevertItem(sessionId, itemId);
      } catch {
        /* sendMessageToSession 已将失败写入会话；保留 Dock 条目便于重试 */
      }
    },
    [sendMessageToSession],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      notificationHub.expireStaleRequests(CONTROL_REQUEST_EXPIRE_MS);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!tabsHydrated) return;
    const t = window.setTimeout(() => {
      void saveSessionTabsState({
        version: 1,
        activeSessionId,
        sessions: sessions.map((s) => {
          const { diskTranscriptPartial: _omitPartial, ...rest } = s;
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
    }, 450);
    return () => window.clearTimeout(t);
  }, [sessions, activeSessionId, tabsHydrated]);

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
    compactSessionHistory,
    releaseSessionHostProcess,
  };
}
