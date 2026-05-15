import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type MutableRefObject,
} from "react";
import { message } from "antd";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  ClaudeComposerExecuteBubbleOptions,
  ClaudeDiskSessionItem,
  ClaudeSession,
  QuestionRequest,
} from "../types";
import {
  executeClaudeCode,
  resumeClaudeCode,
  cancelClaudeExecution,
  getClaudeConfigModel,
  submitClaudeStdinLine,
  listRunningClaudeSessions,
} from "../services/claude";
import { deleteClaudeDiskSession, listClaudeDiskSessions, loadClaudeSessionJsonl } from "../services/claudeDisk";
import { loadSessionTabsState, saveSessionTabsState } from "../services/tabsStore";
import {
  CLAUDE_DISK_JSONL_TAIL_LINES_INITIAL,
  PERSIST_SESSION_MESSAGES_MAX,
} from "../constants/claudeMessageListWindow";
import { wiseNotificationIngest } from "../services/wiseMascot";
import {
  isQuestionStdinUnavailableError,
  shouldDeliverQuestionViaResume,
} from "../utils/questionControlDelivery";
import {
  buildPermissionStdinLine,
  buildQuestionStdinLine,
  ingestClaudeStreamLineForHub,
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
} from "../services/claudeSessionState";
import { createClaudeStreamRuntime } from "../services/claudeStreamRuntime";
import {
  extractPartsFromStreamLine,
  extractSystemErrorMessageFromStreamLine,
  parseStreamLineSessionId,
} from "../services/claudeStreamParser";
import { getAppSetting, setAppSetting } from "../services/appSettingsStore";

type ClaudeStreamRuntimeHandlers = ReturnType<typeof createClaudeStreamRuntime>;

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
): Promise<() => void> {
  let cleaned = false;
  let uo: UnlistenFn = () => {};
  let ue: UnlistenFn = () => {};
  let uc: UnlistenFn = () => {};
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    uo();
    ue();
    uc();
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
      rt.handleCompleteForSendTab(stableTabId, e.payload, turnNonce);
      cleanup();
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

/** stdin 已不可写时，将选择题答案改写成一条用户消息，走 resume/execute 继续同一会话（正文仅含所选文案，便于模型直接接着做） */
function buildQuestionFallbackUserPrompt(qr: QuestionRequest, answers: string[], customAnswer?: string): string {
  const byValue = new Map(qr.options.map((o) => [o.value, o.label.trim() || o.value]));
  const chosen = answers.map((v) => byValue.get(v) ?? v).filter(Boolean);
  const selection = chosen.length > 0 ? chosen.join("、") : "";
  const extra = customAnswer?.trim();
  if (selection && extra) return `${selection}\n${extra}`;
  if (selection) return selection;
  if (extra) return extra;
  return "（跳过）";
}

const WORKFLOW_BINDING_STORAGE_KEY = "wise.workflow.sessionRunBindings.v1";
const CONTROL_REQUEST_EXPIRE_MS = 60 * 60 * 1000;
/** resume 子进程从 spawn 到首行 init 写入宿主 registry 的窗口；此期间不因「注册表暂无 sid」把 running 打成 idle */
const CLAUDE_REGISTRY_BOOTSTRAP_WARMUP_MS = 60_000;
/** 全局 `claude-*` 监听挂载晚于首帧时，避免无监听就 `invoke` 导致丢流 */
const CLAUDE_STREAM_RUNTIME_READY_WAIT_MS = 12_000;
const CLAUDE_STREAM_RUNTIME_READY_POLL_MS = 40;

function persistWorkflowBindings(map: Map<string, string>): void {
  const payload = Object.fromEntries(Array.from(map.entries()));
  void setAppSetting(WORKFLOW_BINDING_STORAGE_KEY, JSON.stringify(payload));
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
): string | null {
  if (lineSid) {
    const match = sessions.find((s) => s.claudeSessionId === lineSid || s.id === lineSid);
    if (match) return match.id;
  }
  return refTid;
}

/** 与 Rust `ClaudeCompletePayload`（camelCase）及旧版 boolean 兼容。 */
function resolveTabIdFromCompletePayload(
  payload: unknown,
  sessions: ClaudeSession[],
  refTid: string | null,
): string | null {
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    const o = payload as Record<string, unknown>;
    const raw = o.sessionId ?? o.session_id;
    const sid = typeof raw === "string" ? raw.trim() : "";
    if (sid && sid !== "unknown") {
      const match = sessions.find((s) => s.claudeSessionId === sid || s.id === sid);
      if (match) return match.id;
      return sid;
    }
  }
  if (typeof payload === "boolean") {
    return refTid;
  }
  return refTid;
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

function mergeRepositoryDiskSessions(
  prev: ClaudeSession[],
  repositoryPath: string,
  repositoryName: string,
  disk: ClaudeDiskSessionItem[],
  configFallbackModel: string,
): ClaudeSession[] {
  const copy = prev.map((s) => ({ ...s }));

  for (let i = 0; i < copy.length; i++) {
    if (copy[i].repositoryPath !== repositoryPath) continue;
    const s = copy[i];
    const item = disk.find((d) => sessionMatchesDiskId(s, d.sessionId));
    if (item) {
      copy[i] = {
        ...s,
        id: item.sessionId,
        claudeSessionId: item.sessionId,
        repositoryName: shouldPreserveRepositoryDisplayName(s.repositoryName) ? s.repositoryName : repositoryName,
        model: item.modelHint ?? s.model,
        diskPreview: item.preview || s.diskPreview,
        createdAt: Math.min(s.createdAt, item.updatedAtMs),
      };
    }
  }

  const toAdd = disk.filter(
    (d) => !copy.some((s) => s.repositoryPath === repositoryPath && sessionMatchesDiskId(s, d.sessionId)),
  );
  if (toAdd.length === 0) {
    return copy;
  }

  const newRows: ClaudeSession[] = toAdd.map((item) => ({
    id: item.sessionId,
    claudeSessionId: item.sessionId,
    repositoryPath,
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
    if (copy[i].repositoryPath === repositoryPath) lastIdx = i;
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
  /** 双栏模式下右侧栏绑定的会话 id，用于磁盘 JSONL 拉取与运行态探测 */
  companionSessionId?: string | null;
  /** 流式 init 将临时 tab id 合并为真实 `session_id` 时回调（同步双栏右侧绑定） */
  onSessionTabIdMigrated?: (fromTabId: string, toClaudeSessionId: string) => void;
}

interface UseClaudeSessionsReturn {
  sessions: ClaudeSession[];
  activeSessionId: string | null;
  createSession: (
    repositoryPath: string,
    repositoryName: string,
    opts?: { skipActivate?: boolean },
  ) => Promise<string>;
  updateSessionModel: (sessionId: string, model: string) => void;
  /** 返回 false 表示未启动（例如并发门闸拦截）；其余路径为 true（含已安排重试的暂不可见会话）。 */
  executeSession: (sessionId: string, prompt: string, opts?: ClaudeComposerExecuteBubbleOptions) => boolean;
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
  respondToQuestion: (sessionId: string, answers: string[], customAnswer?: string) => void;
  /** 关闭选择题 Dock：已过期/失败则仅收起；仍可操作时等同于跳过（空选提交） */
  dismissQuestion: (sessionId: string) => void;
  respondToPermission: (sessionId: string, response: "allow_once" | "allow_always" | "deny") => void;
  clearTodos: (sessionId: string) => void;
  clearFollowups: (sessionId: string) => void;
  clearRevertItems: (sessionId: string) => void;
  sendFollowup: (sessionId: string, id: string) => void;
  restoreRevert: (sessionId: string, itemId: string) => Promise<void>;
  refreshDiskSessionsForRepository: (repositoryPath: string, repositoryName: string) => Promise<void>;
  /** False until ~/.wise/tabs.json has been read (or missing); gate disk refresh until then. */
  tabsHydrated: boolean;
  /** 从磁盘读取完整 jsonl 覆盖该标签的 messages（`sessionKey` 可为标签 id 或 `claudeSessionId`） */
  reloadFullDiskTranscript: (sessionKey: string) => Promise<void>;
}

export function useClaudeSessions(options?: UseClaudeSessionsOptions): UseClaudeSessionsReturn {
  const companionSessionId = options?.companionSessionId ?? null;
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
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
  /** 供 `attachClaudeInvocationStream` 使用；挂载后由 stream effect 赋值。 */
  const streamRuntimeRef = useRef<ClaudeStreamRuntimeHandlers | null>(null);
  /** invocation 监听仍占位时登记于此；关标签 / 卸载时反注册，避免泄漏与关页后仍改状态 */
  const claudeInvocationInflightRef = useRef(
    new Map<string, { tabId: string; detach: () => void }>(),
  );

  const detachClaudeInvocationsForSessionKey = useCallback((closedId: string) => {
    const ids = new Set<string>([closedId]);
    const mapped = sessionIdMapRef.current.get(closedId);
    if (mapped) ids.add(mapped);
    for (const [temp, real] of sessionIdMapRef.current.entries()) {
      if (real === closedId) ids.add(temp);
    }
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

  /** 整页刷新 / 离开前释放 invocation 监听（关标签仍走 `closeSession`）。 */
  const detachAllClaudeInvocationStreams = useCallback(() => {
    for (const [, meta] of [...claudeInvocationInflightRef.current.entries()]) {
      meta.detach();
    }
    claudeInvocationInflightRef.current.clear();
  }, []);

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
          detach = await attachClaudeInvocationStream(inv, tabSessionId, rt, turnNonce, () => {
            claudeInvocationInflightRef.current.delete(inv);
          });
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
      try {
        if (resumeClaudeSid) {
          await resumeClaudeCode(
            repositoryPath,
            resumeClaudeSid,
            prompt,
            modelArg,
            invocationKey,
            "oneshot",
            sk,
            lim,
          );
        } else {
          await executeClaudeCode(
            repositoryPath,
            prompt,
            modelArg,
            invocationKey,
            "oneshot",
            sk,
            lim,
          );
        }
      } catch (e) {
        detach?.();
        throw e;
      }
    },
    [],
  );

  /** 与本轮用户发送绑定，用于 `serverMsgId` 去重（单调递增，避免多会话同时发送撞号）。 */
  const lastUserSendNonceRef = useRef(0);
  const streamTurnSeqRef = useRef(0);
  /** 按标签会话 id 累积流式助手可见文本（完成时写入通知库），支持多会话并行。 */
  const assistantStreamTextByTabRef = useRef<Map<string, string>>(new Map());
  /** 防重：同一会话短时间内收到完全相同行时直接丢弃（监听重复注册/重复派发兜底）。 */
  const lastStreamLineBySessionRef = useRef<Map<string, { line: string; at: number }>>(new Map());
  /** 防重：同一会话短时间内收到相同长文本片段时丢弃（应对不同事件形态的重复内容）。 */
  const lastStreamTextBySessionRef = useRef<Map<string, { text: string; at: number }>>(new Map());
  /** Claude `session_id` → 在此之前不因「宿主 registry 暂无该 sid」将 running 降级为 idle */
  const registryBootstrapDeadlineByClaudeSidRef = useRef<Map<string, number>>(new Map());
  /** 与每轮 `executeSession` / `sendMessageToSession` 对齐，供全局 `claude-complete` 取 notify nonce、与 invocation 路径一致 */
  const expectedTurnNonceByTabIdRef = useRef<Map<string, number>>(new Map());
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
      void unlistenFocus?.();
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
            return { ...sess, messages, diskTranscriptPartial: false };
          }),
        );
      } catch {
        /* 落盘略晚或路径异常时不打断用户 */
      }
    },
    [setSessions],
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
        setSessions((prev) =>
          prev.map((sess) =>
            sess.id === tid ? { ...sess, messages, diskTranscriptPartial: false } : sess,
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
      try {
        const data = await loadSessionTabsState();
        if (cancelled) return;
        if (data?.sessions && data.sessions.length > 0) {
          const normalized = data.sessions.map((s) => ({
            ...s,
            status:
              s.status === "running" || s.status === "connecting" ? ("idle" as const) : s.status,
          }));
          const modelByPath = await modelsForRepositoryPaths(normalized.map((s) => s.repositoryPath));
          const normalizedWithModels = normalized.map((s) => {
            const cfg = modelByPath.get(s.repositoryPath);
            return cfg ? { ...s, model: cfg } : s;
          });
          for (const s of normalizedWithModels) {
            if (s.claudeSessionId && s.messages.length > 0) {
              diskLoadDoneRef.current.add(s.id);
            }
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
        u();
        return;
      }
      unlisteners.push(u);
    };

    const runtime = createClaudeStreamRuntime({
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
      ingestStreamAssistText: (sessionId, text) => notificationHub.ingestStreamAssistText(sessionId, text),
      migrateSessionKey: (from, to) => notificationHub.migrateSessionKey(from, to),
      notifyCompletion: ({ tid, success, nonce, previewRaw, structuredVerdict }) => {
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
      resolveTabIdForClaudeStream,
      resolveTabIdFromCompletePayload,
      resolveSuccessFromCompletePayload: resolveClaudeCompleteSuccess,
      extractSystemErrorMessageFromStreamLine,
      extractPartsFromStreamLine,
      onSessionTabIdMigrated: (fromTabId, toClaudeSessionId) => {
        const nonceMap = expectedTurnNonceByTabIdRef.current;
        const pendingNonce = nonceMap.get(fromTabId);
        if (pendingNonce !== undefined) {
          nonceMap.delete(fromTabId);
          nonceMap.set(toClaudeSessionId, pendingNonce);
        }
        migrateClaudeInvocationTabId(fromTabId, toClaudeSessionId);
        onSessionTabIdMigratedRef.current?.(fromTabId, toClaudeSessionId);
      },
      reloadTranscriptFromDisk,
      expectedTurnNonceByTabIdRef,
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
      unlisteners.forEach((u) => u());
    };
  }, [migrateClaudeInvocationTabId, reloadTranscriptFromDisk]);

  const refreshDiskSessionsForRepository = useCallback(async (repositoryPath: string, repositoryName: string) => {
    const disk = await listClaudeDiskSessions(repositoryPath);
    // 先合并磁盘标签，避免再等 getClaudeConfigModel 才 setSessions（多仓库并发刷新时易卡顿）。
    setSessions((prev) => {
      const next = mergeRepositoryDiskSessions(prev, repositoryPath, repositoryName, disk, "sonnet");
      sessionsRef.current = next;
      return next;
    });

    void (async () => {
      let resolved: string | null = null;
      try {
        const fromCfg = await getClaudeConfigModel(repositoryPath);
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
          if (s.repositoryPath !== repositoryPath) return s;
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
        const lines = await loadClaudeSessionJsonl(s.repositoryPath, s.claudeSessionId!, {
          tailLines: CLAUDE_DISK_JSONL_TAIL_LINES_INITIAL,
        });
        if (cancelled) return;
        const messages = parseClaudeSessionJsonlLines(lines);
        const partial = lines.length >= CLAUDE_DISK_JSONL_TAIL_LINES_INITIAL;
        setSessions((prev) =>
          prev.map((sess) =>
            sess.id === loadKey ? { ...sess, messages, diskTranscriptPartial: partial } : sess,
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
    if (!companionSessionId) return;
    const s = sessionsRef.current.find((x) => x.id === companionSessionId);
    if (!s?.claudeSessionId || s.messages.length > 0) return;
    if (s.status === "running" || s.status === "connecting") return;
    if (diskLoadDoneRef.current.has(s.id)) return;
    diskLoadDoneRef.current.add(s.id);
    const loadKey = s.id;

    let cancelled = false;
    void (async () => {
      try {
        const lines = await loadClaudeSessionJsonl(s.repositoryPath, s.claudeSessionId!, {
          tailLines: CLAUDE_DISK_JSONL_TAIL_LINES_INITIAL,
        });
        if (cancelled) return;
        const messages = parseClaudeSessionJsonlLines(lines);
        const partial = lines.length >= CLAUDE_DISK_JSONL_TAIL_LINES_INITIAL;
        setSessions((prev) =>
          prev.map((sess) =>
            sess.id === loadKey ? { ...sess, messages, diskTranscriptPartial: partial } : sess,
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
  }, [companionSessionId]);

  /** 非活动/非双栏伴生标签：丢弃正文，仅保留元数据；切回时再从磁盘懒加载（running 与无磁盘 id 的纯本地草稿保留） */
  useEffect(() => {
    if (!tabsHydrated) return;
    const keep = new Set<string>();
    if (activeSessionId) keep.add(activeSessionId);
    if (companionSessionId) keep.add(companionSessionId);
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (keep.has(s.id)) return s;
        if (s.status === "running" || s.status === "connecting") return s;
        const hasDisk = Boolean(s.claudeSessionId?.trim());
        if (!hasDisk && s.messages.length > 0) return s;
        if (s.messages.length === 0) return s;
        changed = true;
        return { ...s, messages: [], diskTranscriptPartial: false };
      });
      return changed ? next : prev;
    });
  }, [tabsHydrated, activeSessionId, companionSessionId]);

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

  // Create a session without executing Claude (idle state); model from Claude Code settings.json
  const createSession = useCallback(
    async (repositoryPath: string, repositoryName: string, opts?: { skipActivate?: boolean }) => {
      const id = generateId();
      const newSession: ClaudeSession = {
        id,
        claudeSessionId: null,
        repositoryPath,
        repositoryName,
        model: "sonnet",
        status: "idle",
        messages: [],
        createdAt: Date.now(),
        pendingPrompt: "",
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
      opts?: ClaudeComposerExecuteBubbleOptions,
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
        return true;
      }
      executeSessionRetryCountRef.current.delete(sessionId);

      const claudeSid =
        session.claudeSessionId ?? sessionIdMapRef.current.get(sessionId) ?? null;

      // 首轮已启动但尚未收到 stream-json 的 session_id 时，避免再 spawn 第二个进程
      if (!claudeSid && session.status === "running") {
        const retried = executeSessionRetryCountRef.current.get(sessionId) ?? 0;
        if (retried < 20) {
          executeSessionRetryCountRef.current.set(sessionId, retried + 1);
          window.setTimeout(() => {
            executeSession(sessionId, prompt, opts);
          }, 80);
        } else {
          executeSessionRetryCountRef.current.delete(sessionId);
        }
        return true;
      }

      streamingTargetIdRef.current = sessionId;
      streamTurnSeqRef.current += 1;
      lastUserSendNonceRef.current = streamTurnSeqRef.current;
      assistantStreamTextByTabRef.current.set(sessionId, "");

      const modelArg =
        session.model.trim().length > 0 ? session.model : undefined;

      const checker = claudeSessionsOptionsRef.current?.beforeSpawnClaudeRef?.current;
      if (checker) {
        const gate = checker(session);
        if (!gate.ok) {
          claudeSessionsOptionsRef.current?.onClaudeSpawnBlocked?.(gate.message);
          return false;
        }
      }

      expectedTurnNonceByTabIdRef.current.set(sessionId, lastUserSendNonceRef.current);
      markClaudeRegistryBootstrapWarmup(registryBootstrapDeadlineByClaudeSidRef, claudeSid);
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

      void (async () => {
        try {
          await runClaudeOneshotWithInvocation({
            tabSessionId: sessionId,
            turnNonce,
            invokeConc,
            repositoryPath: session.repositoryPath,
            prompt,
            modelArg,
            resumeClaudeSid: claudeSid,
          });
        } catch (err) {
          if (claudeSid?.trim()) {
            registryBootstrapDeadlineByClaudeSidRef.current.delete(claudeSid.trim());
          }
          setSessions((prev) =>
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
    [runClaudeOneshotWithInvocation],
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
          await runClaudeOneshotWithInvocation({
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
    [runClaudeOneshotWithInvocation],
  );

  const sendMessage = useCallback(
    (prompt: string) => {
      if (!activeSessionId) return;
      sendMessageToSession(activeSessionId, prompt);
    },
    [activeSessionId, sendMessageToSession],
  );

  const closeSession = useCallback((sessionId: string) => {
    const victim = sessionsRef.current.find((s) => s.id === sessionId);
    expectedTurnNonceByTabIdRef.current.delete(sessionId);
    if (victim?.claudeSessionId?.trim()) {
      expectedTurnNonceByTabIdRef.current.delete(victim.claudeSessionId.trim());
    }
    detachClaudeInvocationsForSessionKey(sessionId);
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
      }
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
      setSessions((prev) =>
        reconcileSessionStatusesWithRunningRegistry(
          prev,
          runningIds,
          registryBootstrapDeadlineByClaudeSidRef.current,
          knownIds,
        ),
      );
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
      const fallback = buildQuestionFallbackUserPrompt(qr, answers, customAnswer);
      try {
        const sendPromise = sendMessageToSession(ownerSessionId, fallback);
        void syncSessionStatusesWithHostRegistry();
        await sendPromise;
        notificationHub.clearQuestion(ownerSessionId);
        message.success("已把你的选择作为新用户消息发出，并以 resume 重启该会话子进程。");
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

      // 子进程已结束、stdin 已回收，或上次 stdin 失败：首次点击即走 resume，避免先报错再点「重新提交」。
      if (shouldDeliverQuestionViaResume(qrLife, session)) {
        await deliverQuestionAnswerViaResume(ownerSessionId, qr, answers, customAnswer);
        return;
      }

      const targetSessionId = session?.claudeSessionId ?? session?.id ?? ownerSessionId;
      try {
        await submitClaudeStdinLine(buildQuestionStdinLine(qr.id, answers, customAnswer, qr), targetSessionId);
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
    [deliverQuestionAnswerViaResume, ensureWorkflowRunId, syncSessionStatusesWithHostRegistry],
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
      const payload = buildPermissionStdinLine(pr.id, response);
      try {
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
    [ensureWorkflowRunId],
  );

  const clearTodos = useCallback((sessionId: string) => {
    notificationHub.clearTodos(sessionId);
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
          return { ...rest, messages };
        }),
      });
    }, 450);
    return () => window.clearTimeout(t);
  }, [sessions, activeSessionId, tabsHydrated]);

  return {
    sessions,
    activeSessionId,
    createSession,
    updateSessionModel,
    executeSession,
    appendSystemMessage,
    appendUserMessage,
    sendMessage,
    sendMessageToSession,
    closeSession,
    deleteSession,
    switchSession,
    cancelSession,
    respondToQuestion,
    dismissQuestion,
    respondToPermission,
    clearTodos,
    clearFollowups,
    clearRevertItems,
    sendFollowup,
    restoreRevert,
    refreshDiskSessionsForRepository,
    tabsHydrated,
    reloadFullDiskTranscript,
  };
}
