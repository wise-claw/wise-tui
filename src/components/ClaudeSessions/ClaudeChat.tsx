import { message, Modal, Spin } from "antd";
import {
  lazy,
  Suspense,
  memo,
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useMemo,
  useSyncExternalStore,
  type PointerEvent,
} from "react";
import { runWhenIdle } from "../../utils/deferIdle";
import { prefetchModule } from "../../utils/prefetchModule";
import type {
  ClaudeComposerExecuteBubbleOptions,
  ClaudeSession,
  SessionConversationTaskItem,
  TodoItem,
  QuestionRequest,
  PermissionRequest,
} from "../../types";
import type { ControlRequestStatus } from "../../notifications";
import { useClaudeChatSessionFeaturePanel } from "../../hooks/useClaudeChatSessionFeaturePanel";
import { resolveSessionOwnerInfo } from "../../hooks/claudeChatSessionFeaturePanelHelpers";
import { ClaudeChatMessagesLiveHost } from "./ClaudeChatMessagesLiveHost";
import { claudeChatPropsEqual } from "./claudeChatPropsEqual";
import { getClaudeChatMessageScrollBridge } from "../../stores/claudeChatMessageScrollBridge";
import { ClaudeChatQuickActionsChrome } from "./ClaudeChatQuickActionsChrome";
import { composerRegionChunk } from "./ClaudeChatComposerTray";

const ClaudeChatComposerTrayLazy = lazy(() =>
  import("./ClaudeChatComposerTray").then((module) => ({ default: module.ClaudeChatComposerTray })),
);
import { ClaudeChatNotificationDock } from "./ClaudeChatNotificationDock";
import { ClaudeChatSessionOwnerBar } from "./ClaudeChatSessionOwnerBar";
import {
  SessionConversationTaskDetailDrawer,
  type SessionConversationTaskDetailTarget,
} from "../ProgressMonitorPanel/SessionConversationTaskDetailDrawer";
import { useExecutionEnvironmentDispatchTasksForChat } from "../../hooks/useExecutionEnvironmentDispatchTasksForChat";
import { createMainLaneDispatchGate } from "../../hooks/mainLaneDispatchGate";
import {
  ClaudeChatSessionFeaturePanel,
  type RefreshHistorySessionsScope,
} from "./ClaudeChatSessionFeaturePanel";
import type { ClaudeSessionConnectionKind } from "../../constants/claudeConnection";
import type { DualPaneComposerRepositoryPickerProps } from "../ClaudeChatInput";
import { PendingTaskQueuePanel } from "./PendingTaskQueuePanel";
import { usePendingTaskQueue } from "../../hooks/usePendingTaskQueue";
import { useQuestionDockTabsForRepository } from "../../hooks/useQuestionDockTabs";
import {
  wiseNotificationListRecent,
  wiseNotificationMarkAllRead,
  wiseNotificationMarkRead,
  type WiseInboundMessageRow,
} from "../../services/wiseMascot";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { safeUnlisten } from "../../utils/safeTauriUnlisten";
import {
  readDeferredSendNext,
  writeDeferredSendNext,
} from "../../services/pendingTaskQueueStore";
import {
  WISE_PENDING_NOTIFICATION_SCROLL_STORAGE_KEY,
} from "../../utils/claudeTurnNotificationBody";
import type { SessionOwnerHint } from "../../utils/sessionOwnerHints";
import {
  extractBoundEmployeeNameFromDisplay,
  loadSessionOwnerHints,
  parseOwnerHintFromNotificationBody,
  persistSessionOwnerHints,
  resolveOwnerHintForSession,
  WISE_SESSION_OWNER_HINTS_CHANGED_EVENT,
} from "../../utils/sessionOwnerHints";
import { resolveEngineForSession } from "../../utils/sessionExecutionEngine";
import { normalizeSessionExecutionEngine } from "../../constants/sessionExecutionEngine";
import { pickSessionForRepositorySidebarSelect } from "../../utils/claudeSessionSelection";

import {
  repositoryPathsMatch,
  resolveRepositoryMainSessionId,
  resolveMainOwnerAgentNameForRepositoryPath,
} from "../../utils/repositoryMainSessionBinding";
import { normalizeSessionRepositoryPath } from "../../utils/sessionHistoryScope";
import {
  buildPendingTasksQueueFingerprint,
  buildRepoRunningSessionsFingerprint,
  buildSessionsNotificationScopeFingerprint,
  countSessionUnreadNotifications,
  extractEmployeeNameFromBracketPreview,
  notificationConversationInSessionInboxScope,
  notificationRowInSessionInboxScope,
  sessionRepoPathKey,
} from "./claudeChatHelpers";
import { getSessionUpdatedAt } from "./sessionGrouping";
import {
  SESSION_NOTIFICATION_UI_EVENT_OPEN_PANEL,
  WORKFLOW_UI_EVENT_OMC_BATCH_RUNTIME_CHANGED,
  type WorkflowOmcBatchRuntimeDetail,
} from "../../constants/workflowUiEvents";
import { OMC_MONITOR_EMPLOYEE_NAME } from "../../constants/omcMonitor";
import {
  getOmcDirectBatchPipelineBusySnapshot,
  subscribeOmcDirectBatchInvocations,
} from "../../stores/omcDirectBatchInvocationsStore";
import {
  findDispatchableHeadTasksPerLane,
  findMainLaneHead,
  findNextDispatchableLaneHead,
  pendingTaskExecutorLaneKey,
} from "../../utils/pendingQueueLanes";
import { isWithinBackgroundCompactGraceWindow } from "../../stores/backgroundContextCompactStore";
import type {
  EmployeeItem,
  PendingExecutionTask,
  ProjectItem,
  Repository,
  SessionExecutionEngine,
  WorkflowGraph,
  WorkflowTaskItem,
  WorkflowTemplateItem,
} from "../../types";

function isWorkflowTraceEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("wise.workflow.trace") === "1";
  } catch {
    return false;
  }
}

function logWorkflowTrace(step: string, payload: Record<string, unknown>) {
  if (!isWorkflowTraceEnabled()) return;
  console.debug(`[wise-workflow-trace] ${step}`, payload);
}

/** 主 Claude Code 从 running/connecting 进入空闲后，自动出队待发送任务前等待，减轻与子进程收尾的竞态 */
const POST_CLAUDE_IDLE_PENDING_DISPATCH_DELAY_MS = 500;

/**
 * 中栏主区视图切换：消息列表 / 文件编辑器。
 * 有编辑器时由顶栏 Segmented 切换，当前视图占满整个主区（而非上下分屏，避免每个框过矮）。
 */
export type CenterView = "messages" | "files";

export type { RefreshHistorySessionsScope } from "./ClaudeChatSessionFeaturePanel";

interface Props {
  session: ClaudeSession;
  sessions?: ClaudeSession[];
  /** 未按工作区焦点过滤的完整会话列表，供历史会话弹窗按仓库路径检索 */
  allSessionsForHistory?: ClaudeSession[];
  repositories?: Repository[];
  activeRepository?: Repository;
  onSwitchSession?: (
    sessionId: string,
    options?: { collapseSessionNotificationPanel?: boolean },
  ) => void;
  /** 由父级在「返回主会话」等场景传入，使重挂载后面板默认收起 */
  initialNotificationPanelCollapsed?: boolean;
  onCreateNewSession?: () => void;
  /** 新建主会话进行中 */
  creatingNewSession?: boolean;
  /** 从快捷条「更多」直达指定内置助手对话页 */
  onOpenBuiltinAssistant?: (assistantId: string) => void;
  /** 按助手模板完整激活（对话 / 链接 / 工作流 / 脚本） */
  onActivateAssistant?: (assistant: import("../../types/assistant").AssistantEntry) => void | Promise<void>;
  /** 从快捷条「更多」进入 Author 域「助手模板」 */
  onOpenAssistantsHub?: () => void;
  onOpenRepositoryScheduledTasks?: () => void;
  onSend: (prompt: string) => void;
  onExecute: (
    sessionId: string,
    prompt: string,
    dispatchTarget?: Pick<PendingExecutionTask, "targetType" | "targetEmployeeName" | "targetWorkflowId" | "targetWorkflowName">,
    executeOptions?: ClaudeComposerExecuteBubbleOptions,
  ) => boolean | void | Promise<boolean | void>;
  onResumeSessionFromMonitorDrawer?: import("../ProgressMonitorPanel/MonitorDrawerSessionComposer").MonitorDrawerResumeSessionFn;
  onPrepareSessionForMonitorDrawer?: import("../ProgressMonitorPanel/MonitorDrawerSessionComposer").MonitorDrawerPrepareSessionFn;
  onDispatchExecutionEnvironment?: (input: {
    prompt: string;
    userBubblePrompt?: string;
  }) => void | Promise<void>;
  onSessionModelChange: (model: string) => void;
  onSessionConnectionKindChange?: (kind: ClaudeSessionConnectionKind) => void;
  onUpdateRepositoryExecutionEngine?: (
    repositoryId: number,
    engine: SessionExecutionEngine,
  ) => void | Promise<void>;
  onUpdateEmployeeExecutionEngine?: (
    employeeId: string,
    engine: SessionExecutionEngine,
  ) => void | Promise<void>;
  codexAvailable?: boolean;
  cursorAvailable?: boolean;
  geminiAvailable?: boolean;
  opencodeAvailable?: boolean;
  onOpenExecutionEnvironment?: () => void;
  onCancel: (opts?: { retractLastUserTurn?: boolean }) => void;
  /** 取消任意标签会话（如执行环境 worker） */
  onCancelSessionById?: (sessionId: string, opts?: { retractLastUserTurn?: boolean }) => void;
  // Dock props
  todos: TodoItem[];
  questionRequest: QuestionRequest | null;
  questionRequestQueueLength?: number;
  questionRequestStatus?: ControlRequestStatus | null;
  questionRequestError?: string | null;
  permissionRequest: PermissionRequest | null;
  permissionRequestStatus?: ControlRequestStatus | null;
  permissionRequestError?: string | null;
  followupItems: { id: string; text: string }[];
  revertItems: { id: string; text: string }[];
  respondQuestionAt: (sessionId: string, answers: string[], customAnswer?: string) => void;
  dismissQuestionAt: (sessionId: string) => void;
  onRespondToPermission: (response: "allow_once" | "allow_always" | "deny") => void;
  onToggleTodo?: (todoId: string) => void;
  /** Hub 无 todo 时从 transcript 恢复（重开会话等） */
  onRestoreTodosFromTranscript?: () => void;
  onRestorePendingPermissionFromTranscript?: () => void;
  onClearFollowups: () => void;
  onClearRevertItems: () => void;
  onSendFollowup: (id: string) => void;
  onRestoreRevert: (id: string) => void | Promise<void>;
  onOpenWorkflowConfig?: () => void;
  employees?: EmployeeItem[];
  mentionEmployees?: EmployeeItem[];
  projectRoleTagOptions?: ReadonlyArray<import("../../utils/projectRoleTagOptions").RoleTagOption>;
  projectRepositoryMentionOptions?: ReadonlyArray<
    import("../../utils/projectRoleTagOptions").RepositoryMentionOption
  >;
  hideEmployeesInAtMode?: boolean;
  workflowTasks?: WorkflowTaskItem[];
  taskPendingEmployeesByTaskId?: Record<string, Array<{ employeeId: string; name: string }>>;
  workflowTemplates?: WorkflowTemplateItem[];
  workflowGraphsByWorkflowId?: Record<string, WorkflowGraph>;
  workflowGraphStatusByWorkflowId?: Record<string, string>;
  onOpenTaskDetail?: (taskId: string) => void;
  panelBelowMessages?: React.ReactNode;
  hideMessages?: boolean;
  hideSessionTools?: boolean;
  /** 中栏当前视图（由顶栏切换器控制）：messages=消息列表，files=文件编辑器。无编辑器时忽略。 */
  centerView?: CenterView;
  /**
   * 中栏「消息通知」浮层；默认关闭（有未读也不展示）。顶栏铃铛收件箱不受影响。
   * 多屏副窗格应设为 false，避免重复订阅通知 feed 与 IPC 拉取。
   */
  enableSessionNotificationFeed?: boolean;
  /**
   * 按当前 `session` 解析项目/仓库并发上下文（与主会话 `executeClaudeCode` 一致）；
   * 双栏时左右标签各自解析，避免误用主标签的 scope key。
   */
  resolveTaskListOmcInvokeConcurrency?: (session: ClaudeSession) => {
    concurrencyScopeKey: string;
    concurrencyLimit: number;
  } | null;
  /** 与侧栏仓库主会话绑定一致，用于 OMC 批量等挂到固定主标签 */
  repositoryMainBindings?: Record<string, string>;
  /** 将系统消息写入指定 tab 会话（如主会话上的批量 OMC 系统提示） */
  onAppendSystemMessage?: (sessionId: string, text: string) => void;
  /** 仅追加用户气泡（不 invoke），用于批量 OMC 展示与子进程一致的派发正文 */
  onAppendUserMessage?: (sessionId: string, text: string) => void;
  /**
   * 直连批量 OMC：单条任务在可执行任务中成功标为已完成时，向「OMC员工」工作标签追加系统提示。
   */
  onNotifyOmcEmployeeDirectBatchTaskDone?: (input: {
    repositoryPath: string;
    repositoryDisplayName: string;
    employeeMessage: string;
  }) => void;
  /** 直连批量 OMC 启动前：清空「OMC员工」该仓库标签并预建新会话，避免沿用 */
  onPrepareFreshOmcEmployeeWorkerForDirectBatch?: (input: {
    repositoryPath: string;
    repositoryDisplayName: string;
  }) => void | Promise<void>;
  /** 从历史会话弹窗重新扫描磁盘上的 Claude 会话并合并到标签列表 */
  onRefreshHistorySessions?: (scope: RefreshHistorySessionsScope) => void | Promise<void>;
  /** 历史会话弹窗内删除某条会话（物理删除磁盘 jsonl，不可恢复）。运行中的会话会抛错。 */
  onDeleteHistorySession?: (sessionId: string) => Promise<void>;
  /** 打开历史会话 transcript 抽屉；是否自动展开右栏由「默认配置 → 右侧面板」决定 */
  onOpenHistorySessionInInspector?: (sessionId: string) => void;
  /** 结束侧栏同源的执行环境派发任务 */
  onStopSessionConversationTask?: (item: SessionConversationTaskItem) => void;
  /** 将历史会话恢复为当前仓库主会话 */
  onRestoreHistorySessionAsMain?: (sessionId: string) => void | Promise<void>;
  /** App 侧 `omcBatchRuntime.active`：批量 OMC 调度中（含任务间隙），用于员工空闲判定 */
  omcBatchPipelineActive?: boolean;
  /** 从磁盘读取完整 jsonl 覆盖当前标签消息（`diskTranscriptPartial` 时） */
  onReloadFullDiskTranscript?: (sessionId: string) => void | Promise<void>;
  /** 渐进加载更早 jsonl 尾部（未达上限前不读全文件） */
  onLoadMoreTranscriptFromDisk?: (sessionId: string) => void | Promise<void>;
  /** 手动执行 Claude Code `/compact` 压缩会话历史 */
  onCompactSessionHistory?: (sessionId: string) => void | Promise<void>;
  /** 双栏右侧主会话：输入框底栏仓库选择（由父级仅在右侧注入） */
  dualPaneRepositoryPicker?: DualPaneComposerRepositoryPickerProps;
  activeProject?: ProjectItem | null;
  activeWorkspaceFocus?: import("../../utils/workspaceMode").WorkspaceFocus;
  activeRepositoryId?: number | null;
  workspaceMode?: import("../../utils/workspaceMode").WorkspaceMode;
  /** 工作区当前焦点标签；配合会话状态决定 BackgroundInvocationDock 是否挂载 */
  activeSessionId?: string | null;
  /** 多屏离屏窗格：跳过语音同步、ResizeObserver 等非必要副作用 */
  deferHeavySubtree?: boolean;
  /** 主窗格 vs 多屏伴生窗格的消息列表窗口配置 */
  messageListProfile?: "primary" | "companion";
  /** 伴生窗格按屏数缩小的消息列表尾部窗口 */
  companionMessageListWindow?: { initialVisible: number; loadStep: number };
  /** 多屏窗格索引：0=主窗格，1+=额外窗格。 */
  paneIndex?: number;
  paneCount?: import("../../constants/mainLayoutWidths").PaneCount;
  paneRuntimeOverride?: import("../../types/paneRuntimeOverride").PaneRuntimeOverride | null;
  onUpdatePaneRuntimeOverride?: (
    paneIndex: number,
    patch: Partial<import("../../types/paneRuntimeOverride").PaneRuntimeOverride>,
  ) => void;
}

const RETURN_MAIN_SESSION_KEY = "wise:return-main-session-id";
/** 会话内通知收件箱拉取条数（降低常驻内存） */
const NOTIFICATION_INBOX_FETCH_LIMIT = 24;

export function ClaudeChatInner({
  session,
  sessions = [],
  allSessionsForHistory,
  repositories = [],
  activeRepository,
  onSwitchSession,
  initialNotificationPanelCollapsed = false,
  onCreateNewSession,
  creatingNewSession = false,
  onOpenBuiltinAssistant,
  onActivateAssistant,
  onOpenAssistantsHub,
  onOpenRepositoryScheduledTasks,
  onSend: _onSend,
  onExecute,
  onResumeSessionFromMonitorDrawer,
  onPrepareSessionForMonitorDrawer,
  onDispatchExecutionEnvironment,
  onSessionModelChange,
  onSessionConnectionKindChange,
  onUpdateRepositoryExecutionEngine,
  onUpdateEmployeeExecutionEngine,
  codexAvailable = true,
  cursorAvailable = true,
  geminiAvailable = false,
  opencodeAvailable = false,
  onOpenExecutionEnvironment,
  onCancel,
  onCancelSessionById,
  todos,
  questionRequest,
  questionRequestQueueLength = 0,
  questionRequestStatus,
  questionRequestError,
  permissionRequest,
  permissionRequestStatus,
  permissionRequestError,
  followupItems,
  revertItems,
  respondQuestionAt,
  dismissQuestionAt,
  onRespondToPermission,
  onToggleTodo,
  onRestoreTodosFromTranscript,
  onRestorePendingPermissionFromTranscript,
  onClearFollowups,
  onClearRevertItems,
  onSendFollowup,
  onRestoreRevert,
  onOpenWorkflowConfig,
  employees = [],
  mentionEmployees = [],
  projectRoleTagOptions = [],
  projectRepositoryMentionOptions = [],
  hideEmployeesInAtMode = false,
  workflowTasks = [],
  taskPendingEmployeesByTaskId = {},
  workflowTemplates = [],
  workflowGraphsByWorkflowId: _workflowGraphsByWorkflowId = {},
  workflowGraphStatusByWorkflowId = {},
  onOpenTaskDetail,
  panelBelowMessages,
  hideMessages = false,
  hideSessionTools = false,
  centerView = "messages",
  enableSessionNotificationFeed = false,
  resolveTaskListOmcInvokeConcurrency: _resolveTaskListOmcInvokeConcurrency,
  repositoryMainBindings = {},
  onAppendSystemMessage,
  onAppendUserMessage,
  onNotifyOmcEmployeeDirectBatchTaskDone: _onNotifyOmcEmployeeDirectBatchTaskDone,
  onPrepareFreshOmcEmployeeWorkerForDirectBatch: _onPrepareFreshOmcEmployeeWorkerForDirectBatch,
  onRefreshHistorySessions,
  onDeleteHistorySession,
  onOpenHistorySessionInInspector,
  onStopSessionConversationTask,
  onRestoreHistorySessionAsMain,
  omcBatchPipelineActive = false,
  onReloadFullDiskTranscript,
  onCompactSessionHistory: _onCompactSessionHistory,
  dualPaneRepositoryPicker,
  activeProject,
  activeWorkspaceFocus = "repository",
  activeRepositoryId = null,
  workspaceMode = "single_repo",
  activeSessionId = null,
  deferHeavySubtree = false,
  messageListProfile = "primary",
  companionMessageListWindow,
  paneIndex = 0,
  paneCount = 1,
  paneRuntimeOverride = null,
  onUpdatePaneRuntimeOverride,
}: Props) {
  const chatRootRef = useRef<HTMLDivElement>(null);
  const composerTrayRef = useRef<HTMLDivElement>(null);

  const backgroundInvocationDockEnabled = useMemo(() => {
    if (session.status === "running" || session.status === "connecting") return true;
    if (activeSessionId != null && session.id === activeSessionId) return true;
    return false;
  }, [activeSessionId, session.id, session.status]);

  const { taskItems: executionEnvironmentTaskItems, resolveDispatchTask: resolveExecutionEnvironmentDispatchTask } =
    useExecutionEnvironmentDispatchTasksForChat(session, sessions);

  const [sessionConversationTaskDetailTarget, setSessionConversationTaskDetailTarget] =
    useState<SessionConversationTaskDetailTarget | null>(null);

  const openSessionConversationTaskDetail = useCallback((task: SessionConversationTaskItem) => {
    setSessionConversationTaskDetailTarget({ task });
  }, []);

  const closeSessionConversationTaskDetail = useCallback(() => {
    setSessionConversationTaskDetailTarget(null);
  }, []);

  useEffect(() => {
    if (todos.length > 0) return;
    // 新轮发送后（最后一条是 user 消息），不还原上一轮的过期 todo
    const lastMsg = session.messages[session.messages.length - 1];
    if (lastMsg?.role === "user") return;
    onRestoreTodosFromTranscript?.();
  }, [session.id, session.messages.length, todos.length, onRestoreTodosFromTranscript]);

  useEffect(() => {
    if (permissionRequest) return;
    if (session.status !== "running" && session.status !== "connecting") return;
    onRestorePendingPermissionFromTranscript?.();
  }, [
    session.id,
    session.messages.length,
    session.status,
    permissionRequest,
    onRestorePendingPermissionFromTranscript,
  ]);

  useEffect(() => {
    if (deferHeavySubtree) return;
    const cancel = runWhenIdle(
      () => {
        prefetchModule(() => import("./ClaudeChatComposerTray"), "ClaudeChatComposerTray");
        prefetchModule(() => composerRegionChunk, "composer-region");
      },
      { timeoutMs: 900 },
    );
    return cancel;
  }, [deferHeavySubtree, session.id]);

  useLayoutEffect(() => {
    if (deferHeavySubtree) return;
    const root = chatRootRef.current;
    const tray = composerTrayRef.current;
    if (!root || !tray) return;

    function syncComposerTrayHeight() {
      const r = chatRootRef.current;
      const t = composerTrayRef.current;
      if (!r || !t) return;
      const h = Math.max(1, Math.ceil(t.offsetHeight));
      r.style.setProperty("--app-composer-tray-h", `${h}px`);
    }

    syncComposerTrayHeight();
    let rafId: number | null = null;
    const ro = new ResizeObserver(() => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        syncComposerTrayHeight();
      });
    });
    ro.observe(tray);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [deferHeavySubtree, session.id]);

  const sessionBusyForEscRef = useRef(false);
  sessionBusyForEscRef.current = session.status === "running" || session.status === "connecting";
  const onCancelForEscRef = useRef(onCancel);
  onCancelForEscRef.current = onCancel;

  /** 点击消息区等非控件时让中栏获得焦点，便于 Esc 终止 Claude Code（否则 activeElement 常在 body） */
  const onChatPointerDownCapture = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const root = chatRootRef.current;
    if (!root) return;
    const hit = e.target;
    if (!(hit instanceof Element)) return;
    if (
      hit.closest(
        "button, a, input, textarea, select, [contenteditable='true'], [role='textbox'], [role='menuitem']",
      )
    ) {
      return;
    }
    if (hit.closest(".app-session-quick-actions")) return;
    if (hit.closest("[data-wise-composer-root]")) return;
    if (hit.closest(".monaco-editor, .milkdown")) return;
    if (document.activeElement === root) return;
    root.focus({ preventScroll: true });
  }, []);

  /** 占用中 Esc 仅停止（不撤 transcript）：composer 用 useLayoutEffect 抢先处理「撤回刚发」
   *  Monaco / milkdown 等富文本/代码编辑器挂载在中栏容器内时，必须排除它们的 Esc
   *  （如关闭 Monaco find widget、多光标回到单光标、milkdown 浮层收起等），否则用户在
   *  文件预览、设置 JSON 编辑、消息中的 milkdown 视图里按 Esc 会把正在跑的会话停掉。 */
  useEffect(() => {
    function isEditableSurfaceElement(el: Element | null): boolean {
      if (!el) return false;
      // Monaco 编辑器（含 find/rename/replace widget、菜单）、milkdown 富文本
      return Boolean(el.closest(".monaco-editor, .milkdown"));
    }
    function onWindowEscCapture(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (!sessionBusyForEscRef.current) return;
      const root = chatRootRef.current;
      if (!root) return;
      const t = e.target;
      const ae = document.activeElement;
      const inside =
        (t instanceof Node && root.contains(t)) || (ae instanceof Node && root.contains(ae));
      if (!inside) return;
      if (ae instanceof Element) {
        if (ae.closest(".ant-modal-wrap") || ae.closest(".ant-image-preview-root")) return;
      }
      if (root.querySelector(".app-claude-slash-popover")) return;

      // Esc 落在 Monaco 编辑器或 milkdown 富文本上时，让编辑器自己处理
      // （关闭查找、多光标归一、浮层收起等），不要再冒泡为「取消会话」。
      if (isEditableSurfaceElement(e.target as Element | null)) return;
      if (ae instanceof Element && isEditableSurfaceElement(ae)) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      onCancelForEscRef.current();
    }
    window.addEventListener("keydown", onWindowEscCapture, { capture: true });
    return () => window.removeEventListener("keydown", onWindowEscCapture, { capture: true });
  }, []);

  const { tasks: pendingTasks, addTask, removeTask, pinTask, updateTask, clearAll } = usePendingTaskQueue(
    session.id,
    session.repositoryPath,
  );
  const showPendingTaskQueue = pendingTasks.length > 0;

  const sessionRepository = useMemo(
    () =>
      activeRepository ??
      repositories.find(
        (repository) => sessionRepoPathKey(repository.path) === sessionRepoPathKey(session.repositoryPath),
      ) ?? null,
    [activeRepository, repositories, session.repositoryPath],
  );
  const repositoryScopePath = normalizeSessionRepositoryPath(
    sessionRepository?.path?.trim() || session.repositoryPath.trim(),
  );
  const gitRepositoryPath = sessionRepository?.path?.trim() || session.repositoryPath.trim();
  const omcBatchUserAbortRef = useRef(false);

  const pendingTasksRef = useRef(pendingTasks);
  pendingTasksRef.current = pendingTasks;
  /** 各执行体车道独立出队（主会话 / 终端 / 团队），互不争用全局门闸 */
  const pendingQueueDispatchInFlightLanesRef = useRef<Set<string>>(new Set());

  /**
   * main lane 派发握手门闸：记录「已派发但 session.status 尚未翻 running」的窗口。
   * 解决 race：onExecute 同步翻 store status=running，但 React 重渲染到本组件闭包
   * 是异步的；finally 的微任务 flush 跑时 `isMainIdle` 闭包可能仍为 true，导致
   * canDispatchHead 把队列里剩余 main 任务一次性派完。gate 持有期间 canDispatchHead
   * 返回 false，等 status effect（idle->running）或 5s 兜底释放后才允许下一条。
   * inFlight set 防 onExecute 重入；gate 防「status 翻转传播延迟」--两者正交。
   */
  const mainLaneDispatchGateRef = useRef(createMainLaneDispatchGate());

  const wasRunningRef = useRef(session.status === "running");
  const deferredSendNextRef = useRef(false);
  const deferredQueueHydratedRef = useRef(false);
  const lastPendingFlushGateKeyRef = useRef("");
  const [deferredSendQueued, setDeferredSendQueued] = useState(false);

  const dispatchPendingTask = useCallback(
    (task: PendingExecutionTask) => {
      const laneKey = pendingTaskExecutorLaneKey(task);
      if (pendingQueueDispatchInFlightLanesRef.current.has(laneKey)) {
        return;
      }
      pendingQueueDispatchInFlightLanesRef.current.add(laneKey);
      // main lane 打点：进入「已派但 status 未翻 running」窗口，gate 持有期间
      // canDispatchHead 返回 false，阻止 finally 微任务 flush 把后续 main 任务一次性派完。
      if (laneKey === "main") {
        mainLaneDispatchGateRef.current.markDispatched(task.id);
      }
      const {
        id,
        promptText,
        targetType,
        targetEmployeeName,
        targetWorkflowId,
        targetWorkflowName,
        executorLabel,
        executeBubbleOptions,
      } = task;
      logWorkflowTrace("queue.dispatch.consume", {
        sessionId: session.id,
        taskId: id,
        laneKey,
        targetType: targetType ?? "main",
        targetEmployeeName: targetEmployeeName ?? "",
        targetWorkflowId: targetWorkflowId ?? "",
        targetWorkflowName: targetWorkflowName ?? "",
      });
      void (async () => {
        try {
          const started = await Promise.resolve(
            onExecute(
              session.id,
              promptText,
              { targetType, targetEmployeeName, targetWorkflowId, targetWorkflowName },
              executeBubbleOptions,
            ),
          );
          if (started === false) {
            // 并发门闸：`executeSession` 内已 `onClaudeSpawnBlocked`，此处不再重复 toast
            // 未真正派发 -> status 不会翻 running，gate 不能等 status effect 释放，立即手动释放。
            if (laneKey === "main") {
              mainLaneDispatchGateRef.current.release();
            }
            return;
          }
          removeTask(id);
        } catch (error) {
          console.error("Failed to dispatch pending task, requeueing:", error);
          // onExecute 抛错 -> status 不会翻 running，gate 立即释放，避免 hold 死锁接力。
          if (laneKey === "main") {
            mainLaneDispatchGateRef.current.release();
          }
          addTask({
            promptText,
            executorLabel,
            targetType,
            targetEmployeeName,
            targetWorkflowId,
            targetWorkflowName,
          });
          void message.error("任务分发失败，已重新加入待办队列。");
        } finally {
          pendingQueueDispatchInFlightLanesRef.current.delete(laneKey);
          queueMicrotask(() => flushPendingLaneDispatchesRef.current());
        }
      })();
    },
    [addTask, onExecute, removeTask, session.id],
  );

  const wasClaudeCodeSessionActiveRef = useRef(
    session.status === "running" || session.status === "connecting",
  );
  const idlePendingDispatchHoldUntilRef = useRef(0);
  const idlePendingDispatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearIdlePendingDispatchTimer = useCallback(() => {
    if (idlePendingDispatchTimerRef.current !== null) {
      clearTimeout(idlePendingDispatchTimerRef.current);
      idlePendingDispatchTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearIdlePendingDispatchTimer();
    };
  }, [clearIdlePendingDispatchTimer]);

  useEffect(() => {
    const active = session.status === "running" || session.status === "connecting";
    const prev = wasClaudeCodeSessionActiveRef.current;
    wasClaudeCodeSessionActiveRef.current = active;
    if (prev && !active) {
      idlePendingDispatchHoldUntilRef.current = Date.now() + POST_CLAUDE_IDLE_PENDING_DISPATCH_DELAY_MS;
    } else if (!prev && active) {
      clearIdlePendingDispatchTimer();
      idlePendingDispatchHoldUntilRef.current = 0;
      // status 已翻 running：派发握手完成，释放 main lane gate。
      // 之后 m1 跑完（running->idle）时 canDispatchHead 才会对 m2 返回 true，实现接力。
      mainLaneDispatchGateRef.current.releaseIfMatchesActive(active);
    }
  }, [session.status, clearIdlePendingDispatchTimer]);

  // 5s 兜底：onExecute 既不翻 status 也不抛错的极端故障下，status effect 不会释放 gate。
  // 每 1s 轮询 releaseIfExpired，到点强制释放，避免 main lane 永久卡死接力。
  useEffect(() => {
    const timer = setInterval(() => {
      mainLaneDispatchGateRef.current.releaseIfExpired(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleComposerExecute = useCallback(
    (
      sessionId: string,
      prompt: string,
      consumePending?: string | PendingExecutionTask,
      dispatchTarget?: {
        targetType: "main" | "employee" | "team";
        targetEmployeeName?: string;
        targetWorkflowId?: string;
        targetWorkflowName?: string;
      },
      executeOptions?: ClaudeComposerExecuteBubbleOptions,
    ) => {
      if (consumePending) {
        const queued =
          typeof consumePending === "object"
            ? consumePending
            : pendingTasksRef.current.find((item) => item.id === consumePending);
        if (queued) {
          dispatchPendingTask({
            ...queued,
            executeBubbleOptions: executeOptions ?? queued.executeBubbleOptions,
          });
          return;
        }
        if (typeof consumePending === "string") {
          removeTask(consumePending);
        }
        if (dispatchTarget && dispatchTarget.targetType !== "main") {
          onExecute(sessionId, prompt, dispatchTarget, executeOptions);
          return;
        }
      }
      onExecute(sessionId, prompt, dispatchTarget, executeOptions);
    },
    [dispatchPendingTask, onExecute, removeTask, session.repositoryPath],
  );

  const isMainIdle = session.status !== "running" && session.status !== "connecting";

  const omcDirectBatchPipelineBusy = useSyncExternalStore(
    subscribeOmcDirectBatchInvocations,
    getOmcDirectBatchPipelineBusySnapshot,
    () => false,
  );
  const omcMonitorPipelineBusy = omcBatchPipelineActive || omcDirectBatchPipelineBusy;

  const isEmployeeIdle = useCallback(
    (employeeName?: string) => {
      const normalized = employeeName?.trim();
      if (!normalized) {
        return true;
      }
      const employee = employees.find((item) => item.name.trim() === normalized);
      if (!employee) {
        // 未匹配到员工时降级为主会话调度，避免任务永久阻塞。
        return true;
      }
      if (normalized === OMC_MONITOR_EMPLOYEE_NAME && omcMonitorPipelineBusy) {
        return false;
      }
      const hasRunningEmployeeSession = sessions.some((item) => {
        if (item.repositoryPath !== session.repositoryPath) {
          return false;
        }
        const ownerName =
          extractBoundEmployeeNameFromDisplay(item.repositoryName ?? "") ??
          extractEmployeeNameFromBracketPreview(item.diskPreview);
        if (!ownerName || ownerName.trim() !== normalized) {
          return false;
        }
        return item.status === "running" || item.status === "connecting";
      });
      if (hasRunningEmployeeSession) {
        return false;
      }
      return !workflowTasks.some((task) => {
        if (task.status !== "in_progress") {
          return false;
        }
        return (taskPendingEmployeesByTaskId[task.id] ?? []).some((pending) => pending.employeeId === employee.id);
      });
    },
    [
      employees,
      workflowTasks,
      taskPendingEmployeesByTaskId,
      sessions,
      session.repositoryPath,
      omcMonitorPipelineBusy,
    ],
  );

  const isTeamIdle = useCallback(
    (workflowId?: string) => {
      const targetWorkflowId = workflowId?.trim();
      if (!targetWorkflowId) {
        return true;
      }
      const status = (workflowGraphStatusByWorkflowId[targetWorkflowId] ?? "").toLowerCase();
      if (status !== "published") {
        return false;
      }
      return !workflowTasks.some((task) => task.workflowId === targetWorkflowId && task.status === "in_progress");
    },
    [workflowTasks, workflowGraphStatusByWorkflowId],
  );

  const canDispatchHead = useCallback(
    (task: (typeof pendingTasks)[number] | undefined) => {
      if (!task) return false;
      const targetType = task.targetType ?? "main";
      if (targetType === "main") {
        // gate 持有期间（已派但 status 未翻 running）禁止派发下一条 main，
        // 阻止 finally 微任务 flush 在 status 翻转传播延迟窗口内一次性出栈。
        // ref.current 读取总取最新值，绕开 React 重渲染闭包时序。
        if (!mainLaneDispatchGateRef.current.canDispatch()) return false;
        return isMainIdle;
      }
      if (targetType === "employee") {
        return isEmployeeIdle(task.targetEmployeeName);
      }
      if (targetType === "team") {
        return isTeamIdle(task.targetWorkflowId);
      }
      return true;
    },
    [isMainIdle, isEmployeeIdle, isTeamIdle, mainLaneDispatchGateRef],
  );

  const flushPendingLaneDispatchesRef = useRef<() => void>(() => {});

  const flushPendingLaneDispatches = useCallback(() => {
    const tasks = pendingTasksRef.current;
    const dispatchable = findDispatchableHeadTasksPerLane(tasks, (task) => canDispatchHead(task));
    if (dispatchable.length === 0) {
      return;
    }

    // 后台压缩（auto-compact / /compact）刚结束的 grace 窗口内，gate-key 翻转
    // 会让所有 lane head 同时满足 canDispatchHead，于是同一 flush 把多条同时派发。
    // grace 窗内收敛 main lane：仅派 main head1，其它 lane 仍保持既定并行语义。
    // 窗结束后恢复旧行为（dispatchable 全发），保证非压缩场景零回归。
    const inCompactGraceWindow = isWithinBackgroundCompactGraceWindow(session.id);

    let mainHoldDelay = 0;
    for (const task of dispatchable) {
      const laneKey = pendingTaskExecutorLaneKey(task);
      if (pendingQueueDispatchInFlightLanesRef.current.has(laneKey)) {
        continue;
      }
      if (laneKey === "main" && deferredSendNextRef.current) {
        continue;
      }
      if (laneKey === "main") {
        mainHoldDelay = Math.max(mainHoldDelay, Math.max(0, idlePendingDispatchHoldUntilRef.current - Date.now()));
      }
    }

    if (mainHoldDelay > 0) {
      clearIdlePendingDispatchTimer();
      idlePendingDispatchTimerRef.current = setTimeout(() => {
        idlePendingDispatchTimerRef.current = null;
        flushPendingLaneDispatchesRef.current();
      }, mainHoldDelay);
      return;
    }

    clearIdlePendingDispatchTimer();
    // 决定本次派发集合。
    let toDispatch = dispatchable;
    if (inCompactGraceWindow) {
      let mainHeadQueued = false;
      toDispatch = dispatchable.filter((task) => {
        const laneKey = pendingTaskExecutorLaneKey(task);
        if (laneKey !== "main") {
          return true; // employee / team 仍并行
        }
        if (mainHeadQueued) {
          return false; // grace 窗内 main 只派队首
        }
        mainHeadQueued = true;
        return true;
      });
    }
    for (const task of toDispatch) {
      const laneKey = pendingTaskExecutorLaneKey(task);
      if (pendingQueueDispatchInFlightLanesRef.current.has(laneKey)) {
        continue;
      }
      if (laneKey === "main" && deferredSendNextRef.current) {
        continue;
      }
      dispatchPendingTask(task);
    }
  }, [canDispatchHead, clearIdlePendingDispatchTimer, dispatchPendingTask, session.id]);

  flushPendingLaneDispatchesRef.current = flushPendingLaneDispatches;

  const canDispatchHeadRef = useRef(canDispatchHead);
  canDispatchHeadRef.current = canDispatchHead;

  const pendingTasksFingerprint = useMemo(
    () => buildPendingTasksQueueFingerprint(pendingTasks),
    [pendingTasks],
  );

  const repoRunningSessionsFingerprint = useMemo(
    () => buildRepoRunningSessionsFingerprint(sessions, session.repositoryPath),
    [sessions, session.repositoryPath],
  );
  const workflowBusyFingerprint = useMemo(
    () =>
      workflowTasks
        .filter((task) => task.status === "in_progress")
        .map((task) => `${task.id}:${task.workflowId ?? ""}`)
        .sort()
        .join(","),
    [workflowTasks],
  );

  const taskPendingEmployeesFingerprint = useMemo(() => {
    return Object.entries(taskPendingEmployeesByTaskId)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([taskId, rows]) => `${taskId}:${rows.map((row) => row.employeeId).join(",")}`)
      .join("\n");
  }, [taskPendingEmployeesByTaskId]);

  // 提及员工选项（仅 id/name），两处子组件共用；memo 化避免每次渲染都新建数组。
  const employeeMentionOptions = useMemo(
    () => mentionEmployees.map((item) => ({ id: item.id, name: item.name })),
    [mentionEmployees],
  );

  const pendingDispatchGateKey = useMemo(
    () =>
      [
        session.status,
        omcMonitorPipelineBusy ? "1" : "0",
        repoRunningSessionsFingerprint,
        workflowBusyFingerprint,
        taskPendingEmployeesFingerprint,
        pendingTasksFingerprint,
      ].join("|"),
    [
      session.status,
      omcMonitorPipelineBusy,
      repoRunningSessionsFingerprint,
      workflowBusyFingerprint,
      taskPendingEmployeesFingerprint,
      pendingTasksFingerprint,
    ],
  );

  const getPendingTaskDispatchState = useCallback(
    (task: PendingExecutionTask): { label: string; tone: "ready" | "waiting" } => {
      const targetType = task.targetType ?? "main";
      if (targetType === "main" && !isMainIdle) {
        return { label: "等待空闲", tone: "waiting" };
      }
      if (targetType === "employee") {
        if (isEmployeeIdle(task.targetEmployeeName)) {
          return { label: "员工空闲可执行", tone: "ready" };
        }
        const name = task.targetEmployeeName?.trim() || task.executorLabel;
        return { label: `等待员工空闲: ${name}`, tone: "waiting" };
      }
      if (targetType === "team") {
        const workflowId = task.targetWorkflowId?.trim();
        const status = workflowId ? (workflowGraphStatusByWorkflowId[workflowId] ?? "").toLowerCase() : "";
        if (status !== "published") {
          return { label: "团队未发布，无法调度", tone: "waiting" };
        }
        if (isTeamIdle(task.targetWorkflowId)) {
          return { label: "团队空闲可执行", tone: "ready" };
        }
        const teamName = task.targetWorkflowName?.trim() || task.executorLabel;
        return { label: `等待团队空闲: ${teamName}`, tone: "waiting" };
      }
      return { label: "可执行", tone: "ready" };
    },
    [isMainIdle, isEmployeeIdle, isTeamIdle, workflowGraphStatusByWorkflowId],
  );

  const handleSendNextFromQueue = useCallback(() => {
    if (pendingTasks.length === 0) {
      message.warning("队列为空");
      return;
    }
    const mainLaneHead = findMainLaneHead(pendingTasks);
    if (session.status === "running" && mainLaneHead) {
      deferredSendNextRef.current = true;
      setDeferredSendQueued(true);
      void writeDeferredSendNext(session.id, session.repositoryPath, true);
      message.info("当前主会话有任务在执行，主会话队首将在本轮结束后自动发送（终端/团队队列不受影响）。");
      return;
    }
    const next = findNextDispatchableLaneHead(pendingTasks, (task) => canDispatchHead(task));
    if (!next) {
      const first = pendingTasks[0];
      const dispatchState = first ? getPendingTaskDispatchState(first) : { label: "暂无可派发任务" };
      message.info(dispatchState.label);
      return;
    }
    if (next.targetType === "team") {
      const workflowId = next.targetWorkflowId?.trim();
      const status = workflowId ? (workflowGraphStatusByWorkflowId[workflowId] ?? "").toLowerCase() : "";
      if (status !== "published") {
        const teamName = next.targetWorkflowName?.trim() || next.executorLabel;
        logWorkflowTrace("queue.dispatch.blocked_unpublished", {
          sessionId: session.id,
          queueTaskId: next.id,
          workflowId: workflowId ?? "",
          teamName,
        });
        Modal.confirm({
          title: "团队未发布，无法调度",
          content: `队首任务目标为「${teamName}」，请先发布团队流程后再发送。`,
          okText: "去团队配置",
          cancelText: "稍后处理",
          onOk: () => {
            onOpenWorkflowConfig?.();
          },
        });
        return;
      }
    }
    dispatchPendingTask(next);
  }, [
    session.status,
    session.repositoryPath,
    pendingTasks,
    canDispatchHead,
    getPendingTaskDispatchState,
    dispatchPendingTask,
    workflowGraphStatusByWorkflowId,
    onOpenWorkflowConfig,
  ]);

  const clearAllPendingAndDeferred = useCallback(() => {
    deferredSendNextRef.current = false;
    setDeferredSendQueued(false);
    void writeDeferredSendNext(session.id, session.repositoryPath, false);
    clearAll();
  }, [clearAll, session.id, session.repositoryPath]);

  useEffect(() => {
    deferredQueueHydratedRef.current = false;
    lastPendingFlushGateKeyRef.current = "";
    const sid = session.id;
    const rp = session.repositoryPath;
    let cancelled = false;
    void (async () => {
      let stored = await readDeferredSendNext(sid, rp);
      const queue = pendingTasksRef.current;
      if (stored && queue.length === 0) {
        await writeDeferredSendNext(sid, rp, false);
        stored = false;
      }
      if (cancelled) return;
      deferredQueueHydratedRef.current = true;
      deferredSendNextRef.current = stored;
      setDeferredSendQueued((prev) => (prev === stored ? prev : stored));
      wasRunningRef.current = session.status === "running";

      if (
        stored &&
        queue.length > 0 &&
        session.status !== "running" &&
        session.status !== "connecting"
      ) {
        if (session.status === "error" || session.status === "cancelled") {
          await writeDeferredSendNext(sid, rp, false);
          if (cancelled) return;
          deferredSendNextRef.current = false;
          setDeferredSendQueued((prev) => (prev === false ? prev : false));
          message.warning("检测到上次「本轮结束后发送」预约，但会话未成功结束，已取消自动发送。");
          return;
        }
        const dispatchable = findNextDispatchableLaneHead(queue, (task) => canDispatchHeadRef.current(task));
        if (dispatchable) {
          await writeDeferredSendNext(sid, rp, false);
          if (cancelled) return;
          deferredSendNextRef.current = false;
          setDeferredSendQueued((prev) => (prev === false ? prev : false));
          queueMicrotask(() => flushPendingLaneDispatchesRef.current());
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.id, session.repositoryPath]);

  useEffect(() => {
    const running = session.status === "running";
    const prevWasRunning = wasRunningRef.current;
    wasRunningRef.current = running;
    if (!prevWasRunning || running) return;

    if (!deferredSendNextRef.current) return;
    deferredSendNextRef.current = false;
    setDeferredSendQueued((prev) => (prev === false ? prev : false));
    void writeDeferredSendNext(session.id, session.repositoryPath, false);

    if (session.status === "error" || session.status === "cancelled") {
      message.warning(
        session.status === "cancelled" ? "执行已取消，未自动发送队首任务。" : "执行出错，未自动发送队首任务。",
      );
      return;
    }

    const dispatchable = findNextDispatchableLaneHead(pendingTasksRef.current, (task) =>
      canDispatchHeadRef.current(task),
    );
    if (!dispatchable) return;
    lastPendingFlushGateKeyRef.current = "";
    queueMicrotask(() => flushPendingLaneDispatchesRef.current());
  }, [session.status, session.id, session.repositoryPath]);

  useEffect(() => {
    if (!deferredQueueHydratedRef.current) return;

    if (pendingTasks.length === 0 && deferredSendQueued) {
      deferredSendNextRef.current = false;
      setDeferredSendQueued((prev) => (prev === false ? prev : false));
      void writeDeferredSendNext(session.id, session.repositoryPath, false);
      return;
    }

    if (lastPendingFlushGateKeyRef.current === pendingDispatchGateKey) return;
    lastPendingFlushGateKeyRef.current = pendingDispatchGateKey;
    queueMicrotask(() => flushPendingLaneDispatchesRef.current());
  }, [
    pendingDispatchGateKey,
    session.id,
    session.repositoryPath,
    pendingTasks.length,
    deferredSendQueued,
  ]);

  const scrollToSessionMessageId = useCallback((messageId: number) => {
    getClaudeChatMessageScrollBridge().scrollToSessionMessageId(messageId);
  }, []);

  const [fullTranscriptLoading, setFullTranscriptLoading] = useState(false);

  const [notificationRows, setNotificationRows] = useState<WiseInboundMessageRow[]>([]);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationPanelCollapsed, setNotificationPanelCollapsed] = useState(
    () => initialNotificationPanelCollapsed,
  );
  /** 已在当前会话通知列表中出现过的未读 id，用于首屏不闪、仅对新条目播放冒泡入场 */
  const sessionNotificationSeenIdsRef = useRef<Set<string>>(new Set());
  const [notificationBubbleEnterIds, setNotificationBubbleEnterIds] = useState<Set<string>>(() => new Set());
  const [notificationBadgePulse, setNotificationBadgePulse] = useState(false);
  const [notificationTitleCountPulse, setNotificationTitleCountPulse] = useState(false);
  const prevSessionUnreadCountRef = useRef(0);
  const [returnMainSessionId, setReturnMainSessionId] = useState<string | null>(null);
  const [sessionOwnerHints, setSessionOwnerHints] = useState<Record<string, SessionOwnerHint>>(() => loadSessionOwnerHints());
  const sessionForNotificationPanelRef = useRef(session);
  sessionForNotificationPanelRef.current = session;
  const sessionsForNotificationMatchRef = useRef(sessions);
  sessionsForNotificationMatchRef.current = sessions;
  /** 每实例固定（主栏 true / 多屏副窗 false）；用 ref 保持 effect deps 长度稳定，避免 HMR 改 deps 时报错。 */
  const enableSessionNotificationFeedRef = useRef(enableSessionNotificationFeed);
  enableSessionNotificationFeedRef.current = enableSessionNotificationFeed;

  const handleFullTranscriptStart = useCallback(() => {
    setFullTranscriptLoading(true);
  }, []);

  const handleFullTranscriptEnd = useCallback(() => {
    setFullTranscriptLoading(false);
  }, []);

  useEffect(() => {
    const onHintsExternal = () => setSessionOwnerHints(loadSessionOwnerHints());
    window.addEventListener(WISE_SESSION_OWNER_HINTS_CHANGED_EVENT, onHintsExternal);
    return () => window.removeEventListener(WISE_SESSION_OWNER_HINTS_CHANGED_EVENT, onHintsExternal);
  }, []);

  const sessionOwnerInfo = useMemo(
    () =>
      resolveSessionOwnerInfo({
        session,
        workflowTasks,
        workflowTemplates,
        taskPendingEmployeesByTaskId,
        ownerHint: resolveOwnerHintForSession(sessionOwnerHints, session),
      }),
    [session, workflowTasks, workflowTemplates, taskPendingEmployeesByTaskId, sessionOwnerHints],
  );

  const questionDockTabs = useQuestionDockTabsForRepository(session, sessions, sessionOwnerHints);

  const sessionExecutionEngine = useMemo(() => {
    if (paneCount > 1 && paneRuntimeOverride?.executionEngine) {
      return normalizeSessionExecutionEngine(paneRuntimeOverride.executionEngine);
    }
    return resolveEngineForSession(session, repositories, employees, sessionRepository);
  }, [paneCount, paneRuntimeOverride?.executionEngine, session, repositories, employees, sessionRepository]);

  const handleSessionExecutionEngineChange = useCallback(
    (engine: SessionExecutionEngine) => {
      if (paneCount > 1 && onUpdatePaneRuntimeOverride) {
        onUpdatePaneRuntimeOverride(paneIndex, {
          executionEngine: engine,
          claudeProxyRoute: engine === "claude" ? paneRuntimeOverride?.claudeProxyRoute ?? "auto" : undefined,
        });
        return;
      }
      const employeeName = extractBoundEmployeeNameFromDisplay(session.repositoryName ?? "");
      if (employeeName) {
        const match = employees.find(
          (item) => item.enabled && item.name.trim() === employeeName.trim(),
        );
        if (match) {
          void onUpdateEmployeeExecutionEngine?.(match.id, engine);
          return;
        }
      }
      const repo = sessionRepository;
      if (repo) {
        void onUpdateRepositoryExecutionEngine?.(repo.id, engine);
      }
    },
    [
      employees,
      onUpdateEmployeeExecutionEngine,
      onUpdateRepositoryExecutionEngine,
      onUpdatePaneRuntimeOverride,
      paneCount,
      paneIndex,
      paneRuntimeOverride?.claudeProxyRoute,
      session.repositoryName,
      sessionRepository,
    ],
  );

  /** OMC 批量与后台 invocation 流统一挂到「仓库主标签」，避免从员工子标签发起时执行详情无法在中栏主会话打开。 */
  const omcBatchAnchorSessionId = useMemo(() => {
    const mainOwnerAgentName = resolveMainOwnerAgentNameForRepositoryPath(repositories, repositoryScopePath);
    const bound = resolveRepositoryMainSessionId(
      repositoryScopePath,
      repositoryMainBindings,
      sessions,
      mainOwnerAgentName,
    );
    if (bound) return bound;
    const main = pickSessionForRepositorySidebarSelect(sessions, repositoryScopePath, sessionOwnerHints, {
      mainOwnerAgentName,
    });
    return main?.id ?? session.id;
  }, [sessions, repositoryScopePath, session.id, sessionOwnerHints, repositoryMainBindings, repositories]);

  useEffect(() => {
    function onOmcBatchRuntime(ev: Event) {
      const detail = (ev as CustomEvent<WorkflowOmcBatchRuntimeDetail>).detail;
      if (!detail || detail.active || !detail.abortedByUser) return;
      const sid = detail.sessionId?.trim() ?? "";
      if (!sid) return;
      const anchor = omcBatchAnchorSessionId.trim();
      const claudeSid = session.claudeSessionId?.trim() ?? "";
      if (sid !== anchor && sid !== session.id.trim() && sid !== claudeSid) return;
      omcBatchUserAbortRef.current = true;
    }
    window.addEventListener(WORKFLOW_UI_EVENT_OMC_BATCH_RUNTIME_CHANGED, onOmcBatchRuntime as EventListener);
    return () => {
      window.removeEventListener(WORKFLOW_UI_EVENT_OMC_BATCH_RUNTIME_CHANGED, onOmcBatchRuntime as EventListener);
    };
  }, [omcBatchAnchorSessionId, session.claudeSessionId, session.id]);

  const inferredMainSessionId = useMemo(() => {
    if (sessionOwnerInfo.type === "main") {
      return null;
    }
    const candidates = sessions
      .filter(
        (item) =>
          item.id !== session.id && repositoryPathsMatch(item.repositoryPath, session.repositoryPath),
      )
      .map((item) => ({
        session: item,
        ownerInfo: resolveSessionOwnerInfo({
          session: item,
          workflowTasks,
          workflowTemplates,
          taskPendingEmployeesByTaskId,
          ownerHint: resolveOwnerHintForSession(sessionOwnerHints, item),
        }),
      }))
      .filter((item) => item.ownerInfo.type === "main")
      .sort((a, b) => getSessionUpdatedAt(b.session) - getSessionUpdatedAt(a.session));
    return candidates[0]?.session.id ?? null;
  }, [
    sessionOwnerInfo.type,
    sessions,
    session.id,
    session.repositoryPath,
    workflowTasks,
    workflowTemplates,
    taskPendingEmployeesByTaskId,
    sessionOwnerHints,
  ]);

  const effectiveReturnMainSessionId =
    returnMainSessionId && returnMainSessionId !== session.id
      ? returnMainSessionId
      : inferredMainSessionId && inferredMainSessionId !== session.id
        ? inferredMainSessionId
        : null;

  const publishedTeamMentions = useMemo(
    () =>
      workflowTemplates
        .filter((item) => (workflowGraphStatusByWorkflowId[item.id] ?? "").toLowerCase() === "published")
        .map((item) => ({ id: item.id, name: item.name })),
    [workflowTemplates, workflowGraphStatusByWorkflowId],
  );

  const { featurePanelProps, appendSessionSendTrace } = useClaudeChatSessionFeaturePanel({
    session,
    sessions,
    allSessionsForHistory,
    repositories,
    activeRepository,
    activeProject,
    activeWorkspaceFocus,
    activeRepositoryId,
    workspaceMode,
    repositoryScopePath,
    sessionRepository,
    repositoryMainBindings,
    hideSessionTools,
    scrollToSessionMessageId,
    onRefreshHistorySessions,
    onDeleteHistorySession,
    onOpenHistorySessionInInspector,
    onRestoreHistorySessionAsMain,
    onOpenRepositoryScheduledTasks,
  });

  /** 当前仓库范围内未读通知（含员工/团队子会话），用于会话内消息通知面板列表与显隐 */
  const sessionsNotificationScopeFingerprint = useMemo(
    () => buildSessionsNotificationScopeFingerprint(sessions),
    [sessions],
  );

  const sessionUnreadNotificationRows = useMemo(
    () => notificationRows.filter((row) => notificationRowInSessionInboxScope(row, session, sessions)),
    [
      notificationRows,
      session.id,
      session.repositoryPath,
      session.claudeSessionId,
      sessionsNotificationScopeFingerprint,
    ],
  );

  const sessionUnreadCount = sessionUnreadNotificationRows.length;

  useEffect(() => {
    sessionNotificationSeenIdsRef.current.clear();
    setNotificationBubbleEnterIds(new Set());
    prevSessionUnreadCountRef.current = 0;
    setNotificationBadgePulse(false);
    setNotificationTitleCountPulse(false);
    setNotificationRows([]);
  }, [session.id, session.repositoryPath]);

  useLayoutEffect(() => {
    const rows = sessionUnreadNotificationRows;
    const seen = sessionNotificationSeenIdsRef.current;
    const ids = rows.map((r) => r.id);
    if (seen.size === 0) {
      ids.forEach((id) => seen.add(id));
      return;
    }
    const newly = ids.filter((id) => !seen.has(id));
    ids.forEach((id) => seen.add(id));
    if (newly.length === 0) {
      return;
    }
    setNotificationBubbleEnterIds(new Set(newly));
    const t = window.setTimeout(() => setNotificationBubbleEnterIds(new Set()), 520);
    return () => window.clearTimeout(t);
  }, [sessionUnreadNotificationRows]);

  useEffect(() => {
    const n = sessionUnreadCount;
    const prev = prevSessionUnreadCountRef.current;
    const increased = n > prev && prev > 0;
    prevSessionUnreadCountRef.current = n;
    if (!increased) {
      return;
    }
    if (notificationPanelCollapsed) {
      setNotificationBadgePulse(true);
      const t = window.setTimeout(() => setNotificationBadgePulse(false), 480);
      return () => window.clearTimeout(t);
    }
    setNotificationTitleCountPulse(true);
    const t = window.setTimeout(() => setNotificationTitleCountPulse(false), 480);
    return () => window.clearTimeout(t);
  }, [sessionUnreadCount, notificationPanelCollapsed]);

  const loadNotificationRows = useCallback(async (options?: { quiet?: boolean }) => {
    const quiet = options?.quiet === true;
    const loadScopeId = sessionForNotificationPanelRef.current.id;
    if (!quiet) {
      setNotificationLoading(true);
    }
    try {
      const rows = await wiseNotificationListRecent(NOTIFICATION_INBOX_FETCH_LIMIT);
      if (sessionForNotificationPanelRef.current.id !== loadScopeId) {
        return;
      }
      setNotificationRows(rows);
    } catch {
      if (!quiet && sessionForNotificationPanelRef.current.id === loadScopeId) {
        setNotificationRows([]);
      }
    } finally {
      if (!quiet && sessionForNotificationPanelRef.current.id === loadScopeId) {
        setNotificationLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!enableSessionNotificationFeedRef.current) {
      return;
    }
    void loadNotificationRows({ quiet: true });
  }, [session.id, session.repositoryPath, loadNotificationRows]);

  const handleNotificationMarkRead = useCallback((row: WiseInboundMessageRow) => {
    if (row.readAt) {
      return;
    }
    const readStamp = new Date().toISOString();
    setNotificationRows((prev) => {
      const next = prev.map((r) => (r.id === row.id ? { ...r, readAt: readStamp } : r));
      queueMicrotask(() => {
        if (
          countSessionUnreadNotifications(
            next,
            sessionForNotificationPanelRef.current,
            sessionsForNotificationMatchRef.current,
          ) === 0
        ) {
          setNotificationPanelCollapsed(true);
        }
      });
      return next;
    });
    void wiseNotificationMarkRead(row.id).catch(() => {
      setNotificationRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, readAt: null } : r)));
      void message.error("标记已读失败");
    });
  }, []);

  const handleNotificationMarkAllRead = useCallback(() => {
    void (async () => {
      try {
        await wiseNotificationMarkAllRead();
        const readStamp = new Date().toISOString();
        setNotificationRows((prev) => prev.map((r) => (r.readAt ? r : { ...r, readAt: readStamp })));
        setNotificationPanelCollapsed(true);
        void loadNotificationRows({ quiet: true });
      } catch {
        void message.error("全部已读失败");
        void loadNotificationRows({ quiet: true });
      }
    })();
  }, [loadNotificationRows]);

  const handleNotificationJump = useCallback(
    (row: WiseInboundMessageRow) => {
      const conversationId = row.conversationId.trim();
      if (!conversationId) {
        return;
      }
      const targetSession = sessions.find(
        (item) => item.id === conversationId || item.claudeSessionId === conversationId,
      );
      if (!targetSession) {
        message.warning("未找到该通知对应的会话");
        return;
      }
      const ownerHint = parseOwnerHintFromNotificationBody(row.body);
      if (ownerHint) {
        setSessionOwnerHints((prev) => {
          const next = { ...prev, [conversationId]: ownerHint };
          persistSessionOwnerHints(next);
          return next;
        });
      }
      if (targetSession.id !== session.id) {
        try {
          sessionStorage.setItem(RETURN_MAIN_SESSION_KEY, session.id);
          setReturnMainSessionId(session.id);
        } catch {
          /* ignore */
        }
      }
      try {
        const taskIdHint = row.body.match(/任务\s+([^\s：\n]+)/)?.[1]?.trim();
        sessionStorage.setItem(
          WISE_PENDING_NOTIFICATION_SCROLL_STORAGE_KEY,
          JSON.stringify({
            conversationId: conversationId,
            messageId: row.id,
            body: row.body,
            taskId: taskIdHint || undefined,
          }),
        );
      } catch {
        /* ignore */
      }
      onSwitchSession?.(targetSession.id);
      if (!row.readAt) {
        const readStamp = new Date().toISOString();
        setNotificationRows((prev) => {
          const next = prev.map((r) => (r.id === row.id ? { ...r, readAt: readStamp } : r));
          queueMicrotask(() => {
            if (
              countSessionUnreadNotifications(
                next,
                sessionForNotificationPanelRef.current,
                sessionsForNotificationMatchRef.current,
              ) === 0
            ) {
              setNotificationPanelCollapsed(true);
            }
          });
          return next;
        });
        void wiseNotificationMarkRead(row.id).catch(() => {
          setNotificationRows((prev) =>
            prev.map((r) => (r.id === row.id ? { ...r, readAt: null } : r)),
          );
        });
      }
    },
    [onSwitchSession, session.id, sessions],
  );

  const handleNotificationDockCollapse = useCallback(() => {
    setNotificationPanelCollapsed(true);
  }, []);

  const handleNotificationDockExpand = useCallback(() => {
    setNotificationPanelCollapsed(false);
  }, []);

  const handleNotificationDockRefresh = useCallback(() => {
    void loadNotificationRows();
  }, [loadNotificationRows]);

  const handleReturnMainSession = useCallback(() => {
    const targetId = effectiveReturnMainSessionId?.trim();
    if (!targetId) {
      return;
    }
    const targetExists = sessions.some((item) => item.id === targetId);
    if (!targetExists) {
      message.warning("主会话不存在或已关闭");
      try {
        sessionStorage.removeItem(RETURN_MAIN_SESSION_KEY);
      } catch {
        /* ignore */
      }
      setReturnMainSessionId(null);
      return;
    }
    const mainSession = sessions.find((item) => item.id === targetId);
    setSessionOwnerHints((prev) => {
      const next = { ...prev };
      delete next[targetId];
      const claudeId = mainSession?.claudeSessionId?.trim();
      if (claudeId) {
        delete next[claudeId];
      }
      persistSessionOwnerHints(next);
      return next;
    });
    onSwitchSession?.(targetId, { collapseSessionNotificationPanel: true });
    try {
      sessionStorage.removeItem(RETURN_MAIN_SESSION_KEY);
    } catch {
      /* ignore */
    }
    setReturnMainSessionId(null);
  }, [effectiveReturnMainSessionId, onSwitchSession, sessions]);


  useEffect(() => {
    if (!enableSessionNotificationFeedRef.current) {
      return;
    }
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    void (async () => {
      const u = await listen("wise-unread-changed", () => {
        void loadNotificationRows({ quiet: true });
      });
      if (cancelled) {
        safeUnlisten(u);
        return;
      }
      unlisten = u;
    })();

    function handleOpenSessionNotificationPanel(event: Event) {
      const custom = event as CustomEvent<{ conversationId?: string }>;
      const conversationId = custom.detail?.conversationId;
      if (typeof conversationId !== "string" || !conversationId.trim()) {
        return;
      }
      const s = sessionForNotificationPanelRef.current;
      if (!notificationConversationInSessionInboxScope(conversationId, s, sessionsForNotificationMatchRef.current)) {
        return;
      }
      setNotificationPanelCollapsed(false);
      void loadNotificationRows({ quiet: true });
    }
    window.addEventListener(SESSION_NOTIFICATION_UI_EVENT_OPEN_PANEL, handleOpenSessionNotificationPanel);
    return () => {
      cancelled = true;
      safeUnlisten(unlisten);
      window.removeEventListener(SESSION_NOTIFICATION_UI_EVENT_OPEN_PANEL, handleOpenSessionNotificationPanel);
    };
  }, [loadNotificationRows]);

  useEffect(() => {
    if (sessionUnreadNotificationRows.length === 0) {
      setNotificationPanelCollapsed(true);
    }
  }, [sessionUnreadNotificationRows.length]);





  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(RETURN_MAIN_SESSION_KEY);
      setReturnMainSessionId(stored && stored.trim() ? stored : null);
    } catch {
      setReturnMainSessionId(null);
    }
  }, [session.id]);

  return (
    <div
      ref={chatRootRef}
      className="app-claude-chat"
      tabIndex={-1}
      onPointerDownCapture={onChatPointerDownCapture}
    >
      {!hideSessionTools && !deferHeavySubtree ? (
        <ClaudeChatSessionFeaturePanel {...featurePanelProps} />
      ) : null}


      {!hideMessages ? (
        <ClaudeChatSessionOwnerBar
          session={session}
          type={sessionOwnerInfo.type}
          typeLabel={sessionOwnerInfo.typeLabel}
          name={sessionOwnerInfo.name}
          effectiveReturnMainSessionId={effectiveReturnMainSessionId}
          onCancel={onCancel}
          onReturnMainSession={handleReturnMainSession}
        />
      ) : null}

      <div className="app-claude-chat-body">
        <div className="app-claude-chat-main">

      <div
        className={`app-claude-chat-center-pane${
          !hideMessages && (!panelBelowMessages || centerView === "messages") ? "" : " is-hidden"
        }`}
      >
        {!hideMessages ? (
          <ClaudeChatMessagesLiveHost
            sessionId={session.id}
            claudeSessionId={session.claudeSessionId}
            hideMessagesScroll={
              hideMessages ||
              deferHeavySubtree ||
              (Boolean(panelBelowMessages) && centerView === "files")
            }
            fullTranscriptLoading={fullTranscriptLoading}
            onReloadFullDiskTranscript={onReloadFullDiskTranscript}
            onOpenTaskDetail={onOpenTaskDetail}
            onOpenHistorySessionInInspector={onOpenHistorySessionInInspector}
            onOpenSessionConversationTaskDetail={openSessionConversationTaskDetail}
            resolveExecutionEnvironmentDispatchTask={resolveExecutionEnvironmentDispatchTask}
            sessionsForDispatchLookup={sessions}
            onFullTranscriptStart={handleFullTranscriptStart}
            onFullTranscriptEnd={handleFullTranscriptEnd}
            messageListProfile={messageListProfile}
            companionMessageListWindow={companionMessageListWindow}
            sessionExecutionEngine={sessionExecutionEngine}
          />
        ) : null}
      </div>
      {panelBelowMessages ? (
        <div
          className={`app-claude-chat-center-pane${
            hideMessages || centerView === "files" ? "" : " is-hidden"
          }`}
        >
          {panelBelowMessages}
        </div>
      ) : null}

      {showPendingTaskQueue ? (
        <div className="app-pending-task-queue-anchor">
          <PendingTaskQueuePanel
            sessionStatus={session.status}
            tasks={pendingTasks}
            repositoryPath={session.repositoryPath}
            employees={employees}
            employeeMentions={employeeMentionOptions}
            teamMentions={publishedTeamMentions}
            codexAvailable={codexAvailable}
            cursorAvailable={cursorAvailable}
            geminiAvailable={geminiAvailable}
            opencodeAvailable={opencodeAvailable}
            deferredSendQueued={deferredSendQueued}
            taskDispatchStateById={Object.fromEntries(
              pendingTasks.map((task) => [task.id, getPendingTaskDispatchState(task)]),
            )}
            onPin={pinTask}
            onRemove={removeTask}
            onUpdate={updateTask}
            onSendNext={handleSendNextFromQueue}
            onClearAll={clearAllPendingAndDeferred}
          />
        </div>
      ) : null}

      {enableSessionNotificationFeed ? (
        <ClaudeChatNotificationDock
          session={session}
          sessions={sessions}
          rows={sessionUnreadNotificationRows}
          unreadCount={sessionUnreadCount}
          collapsed={notificationPanelCollapsed}
          loading={notificationLoading}
          badgePulse={notificationBadgePulse}
          titleCountPulse={notificationTitleCountPulse}
          bubbleEnterIds={notificationBubbleEnterIds}
          onCollapse={handleNotificationDockCollapse}
          onExpand={handleNotificationDockExpand}
          onRefresh={handleNotificationDockRefresh}
          onMarkAllRead={handleNotificationMarkAllRead}
          onMarkRead={handleNotificationMarkRead}
          onJump={handleNotificationJump}
        />
      ) : null}

      <div className="app-claude-chat-bottom">
        {!deferHeavySubtree ? (
          <ClaudeChatQuickActionsChrome
            sessionId={session.id}
            gitRepositoryPath={gitRepositoryPath}
            repositoryId={sessionRepository?.id ?? null}
            onCreateNewSession={onCreateNewSession}
            creatingNewSession={creatingNewSession}
            onOpenBuiltinAssistant={onOpenBuiltinAssistant}
            onActivateAssistant={onActivateAssistant}
            onOpenAssistantsHub={onOpenAssistantsHub}
            onDispatchExecutionEnvironment={onDispatchExecutionEnvironment}
          />
        ) : null}
        {!deferHeavySubtree ? (
          <Suspense
            fallback={
              <div
                ref={composerTrayRef}
                className="app-claude-composer-tray app-claude-composer-tray__loading"
                aria-busy="true"
                aria-label="输入区加载中"
              >
                <Spin size="small" />
              </div>
            }
          >
            <ClaudeChatComposerTrayLazy
              composerTrayRef={composerTrayRef}
              backgroundInvocationDockEnabled={backgroundInvocationDockEnabled}
              session={session}
              gitRepositoryPath={gitRepositoryPath}
              repositoryId={sessionRepository?.id ?? null}
              employeesForDispatchRoute={employees}
              pendingExecutionTaskCount={pendingTasks.length}
              onExecute={handleComposerExecute}
              onDispatchExecutionEnvironment={onDispatchExecutionEnvironment}
              onSessionModelChange={onSessionModelChange}
              onSessionConnectionKindChange={onSessionConnectionKindChange}
              sessionExecutionEngine={sessionExecutionEngine}
              codexAvailable={codexAvailable}
              cursorAvailable={cursorAvailable}
              geminiAvailable={geminiAvailable}
              opencodeAvailable={opencodeAvailable}
              onOpenExecutionEnvironment={onOpenExecutionEnvironment}
              onSessionExecutionEngineChange={handleSessionExecutionEngineChange}
              paneIndex={paneIndex}
              paneCount={paneCount}
              paneRuntimeOverride={paneRuntimeOverride}
              onUpdatePaneRuntimeOverride={onUpdatePaneRuntimeOverride}
              onCancel={onCancel}
              todos={todos}
              questionRequest={questionRequest}
              questionRequestQueueLength={questionRequestQueueLength}
              questionRequestStatus={questionRequestStatus}
              questionRequestError={questionRequestError}
              questionDockTabs={questionDockTabs}
              permissionRequest={permissionRequest}
              permissionRequestStatus={permissionRequestStatus}
              permissionRequestError={permissionRequestError}
              followupItems={followupItems}
              revertItems={revertItems}
              respondQuestionAt={respondQuestionAt}
              dismissQuestionAt={dismissQuestionAt}
              onRespondToPermission={onRespondToPermission}
              onToggleTodo={onToggleTodo}
              onClearFollowups={onClearFollowups}
              onClearRevertItems={onClearRevertItems}
              onSendFollowup={onSendFollowup}
              onRestoreRevert={onRestoreRevert}
              employeeMentions={employeeMentionOptions}
              teamMentions={publishedTeamMentions}
              projectRoleTagOptions={projectRoleTagOptions}
              projectRepositoryMentionOptions={projectRepositoryMentionOptions}
              hideEmployeesInAtMode={hideEmployeesInAtMode}
              onEnqueueAsPendingTask={(payload) => addTask(payload)}
              onTrackSendFlow={appendSessionSendTrace}
              onAppendSystemMessage={onAppendSystemMessage}
              onAppendUserMessage={onAppendUserMessage}
              onCompactSessionHistory={_onCompactSessionHistory}
              onCreateNewSession={onCreateNewSession}
              dualPaneRepositoryPicker={dualPaneRepositoryPicker}
            />
          </Suspense>
        ) : (
          <div ref={composerTrayRef} className="app-claude-composer-tray app-claude-composer-tray--deferred" aria-hidden />
        )}
      </div>
        </div>
      </div>

      {sessionConversationTaskDetailTarget ? (
        <SessionConversationTaskDetailDrawer
          target={sessionConversationTaskDetailTarget}
          sessions={allSessionsForHistory ?? sessions}
          sessionConversationTaskItems={executionEnvironmentTaskItems}
          onClose={closeSessionConversationTaskDetail}
          onStopTask={onStopSessionConversationTask}
          onStopSessionConversationTask={onStopSessionConversationTask}
          onCancelSession={onCancelSessionById}
          onReloadFullDiskTranscript={onReloadFullDiskTranscript}
          onPrepareSessionForMonitorDrawer={onPrepareSessionForMonitorDrawer}
          onResumeSession={
            onResumeSessionFromMonitorDrawer ??
            (async (input) => {
              const result = await onExecute(input.sessionId, input.prompt, undefined, {
                userBubblePrompt: input.prompt,
              });
              return result !== false;
            })
          }
        />
      ) : null}
    </div>
  );
}

export const ClaudeChat = memo(ClaudeChatInner, claudeChatPropsEqual);

