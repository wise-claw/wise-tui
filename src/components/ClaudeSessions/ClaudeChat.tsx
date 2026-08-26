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
  type CSSProperties,
  type PointerEvent,
} from "react";
import { runWhenIdle } from "../../utils/deferIdle";
import { loadGlobalUltracodeEnabled } from "../../services/claudeSpawnExtras";
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
import { ClaudeChatMessagesLiveHost } from "./ClaudeChatMessagesLiveHost";
import { claudeChatPropsEqual } from "./claudeChatPropsEqual";
import { getClaudeChatMessageScrollBridge } from "../../stores/claudeChatMessageScrollBridge";
import { ClaudeChatQuickActionsChrome } from "./ClaudeChatQuickActionsChrome";
import { composerRegionChunk } from "./ClaudeChatComposerTray";
import type { CenterView } from "../../stores/paneCenterViewControlStore";
import { adjustMainWindowLogicalWidthByDelta } from "../../services/mainWindowLayout";
import { useCenterViewControl } from "./claudeChatHelpers";

/** 会话功能栏默认宽度；比窗口扩展量略大，让右栏打开时消息区适度收窄。 */
const SESSION_AUX_RAIL_DEFAULT_WIDTH_PX = 640;
/** 与 index.css 的 `.app-claude-chat-aux-rail` min-width 保持一致。 */
const SESSION_AUX_RAIL_MIN_WIDTH_PX = 480;
/** 右栏打开时中栏适度让出的宽度（避免消息区几乎不变、仍显得过宽）。 */
const SESSION_AUX_RAIL_MIDDLE_SHRINK_PX = 320;
/** 中栏最小可用宽度，与右栏拖拽 resize 的 460 下限保持一致。 */
const SESSION_AUX_RAIL_MIDDLE_MIN_PX = 460;

const ClaudeChatComposerTrayLazy = lazy(() =>
  import("./ClaudeChatComposerTray").then((module) => ({ default: module.ClaudeChatComposerTray })),
);
import { ClaudeChatNotificationDock } from "./ClaudeChatNotificationDock";
import { prefetchSessionConversationTaskDetailDrawer } from "../ProgressMonitorPanel/prefetchSessionConversationTaskDetailDrawer";
import {
  SessionConversationTaskDetailDrawer,
  type SessionConversationTaskDetailTarget,
} from "../ProgressMonitorPanel/SessionConversationTaskDetailDrawer";
import { useExecutionEnvironmentDispatchTasksForChat } from "../../hooks/useExecutionEnvironmentDispatchTasksForChat";
import { createDispatchFailureTracker } from "../../hooks/dispatchFailureTracker";
import { claimPendingTaskQueueOwner } from "../../stores/pendingTaskQueueOwnerStore";
import { hasActiveSessionTurn, subscribeSessionTurns } from "../../stores/sessionTurnStore";
import type { RefreshHistorySessionsScope } from "./ClaudeChatSessionFeaturePanel";
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
import { openCodeReviewFromNotification } from "../../services/codeReview/codeReviewNotification";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { safeUnlisten } from "../../utils/safeTauriUnlisten";
import {
  readDeferredSendNext,
  writeDeferredSendNext,
} from "../../services/pendingTaskQueueStore";
import {
  WISE_UI_EVENT_DISPATCH_REQUIREMENT_TO_EXEC_ENV,
  prefixExecutionEnvironmentMention,
  type DispatchRequirementToExecutionEnvironmentDetail,
} from "../../constants/pendingTaskQueueEvents";
import {
  WISE_PENDING_NOTIFICATION_SCROLL_STORAGE_KEY,
} from "../../utils/claudeTurnNotificationBody";
import type { SessionOwnerHint } from "../../utils/sessionOwnerHints";
import {
  extractBoundEmployeeNameFromDisplay,
  loadSessionOwnerHints,
  parseOwnerHintFromNotificationBody,
  persistSessionOwnerHints,
  WISE_SESSION_OWNER_HINTS_CHANGED_EVENT,
} from "../../utils/sessionOwnerHints";
import { resolveEngineForSession } from "../../utils/sessionExecutionEngine";
import { normalizeSessionExecutionEngine } from "../../constants/sessionExecutionEngine";
import { pickSessionForRepositorySidebarSelect } from "../../utils/claudeSessionSelection";

import {
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
export type { CenterView };

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
    requirementId?: string;
    requirementRepositoryId?: string | null;
  }) => void | Promise<void>;
  onSessionModelChange: (model: string) => void;
  onSessionConnectionKindChange?: (kind: ClaudeSessionConnectionKind) => void;
  /**
   * Per-session ultracode setter（顶层 `(sessionId, next)` 签名，与 connectionKind 对称）。
   * 多屏下每屏各自 toggle 自己的 session。
   */
  onUpdateSessionUltracode?: (sessionId: string, next: boolean | null) => void;
  /** Codex RPC 推理强度；写入会话并落盘 tabs.json。 */
  onUpdateSessionCodexReasoningEffort?: (sessionId: string, effort: string) => void;
  /** Claude Code 推理强度；写入会话并落盘 tabs.json。 */
  onUpdateSessionClaudeReasoningEffort?: (sessionId: string, effort: string) => void;
  /** Composer 切换执行环境：写入当前会话标签级引擎。 */
  onUpdateSessionExecutionEngine?: (
    sessionId: string,
    engine: SessionExecutionEngine,
  ) => void | Promise<void>;
  /** 全局 ultracode 状态，注入 composer 避免重复读 store。 */
  globalUltracodeEnabled?: boolean;
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
  qoderAvailable?: boolean;
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
  /** 详情 drawer 复用主输入框后：按 worker sessionId 路由的控制请求回调（execution_environment worker ≠ 当前会话）。 */
  onRespondToPermissionAt?: (
    sessionId: string,
    response: "allow_once" | "allow_always" | "deny",
  ) => void;
  onToggleTodoAt?: (sessionId: string, todoId: string) => void;
  onClearFollowupsAt?: (sessionId: string) => void;
  onClearRevertItemsAt?: (sessionId: string) => void;
  onSendFollowupAt?: (sessionId: string, id: string) => void;
  onRestoreRevertAt?: (sessionId: string, itemId: string) => void | Promise<void>;
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
  /** 需求管理中栏节点；与文件/快捷操作/终端在 DOM 中可并存，由 centerView 互斥显隐。 */
  panelBelowRequirements?: React.ReactNode;
  /** 快捷操作中栏节点；与文件/需求/终端在 DOM 中可并存，由 centerView 互斥显隐。 */
  panelBelowQuickActions?: React.ReactNode;
  /** 内置终端节点；与其它中栏 slot 在 DOM 中并存，由 centerView 互斥显隐。 */
  panelBelowTerminal?: React.ReactNode;
  hideMessages?: boolean;
  hideSessionTools?: boolean;
  /** 中栏当前视图（由顶栏切换器控制）。无对应 panel 时忽略。 */
  centerView?: CenterView;
  /** 右侧功能栏当前功能变化；消息固定展示，不再参与切换。 */
  onCenterViewChange?: (view: CenterView) => void;
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
  onUpdateSessionUltracode,
  onUpdateSessionCodexReasoningEffort,
  onUpdateSessionClaudeReasoningEffort,
  onUpdateSessionExecutionEngine,
  globalUltracodeEnabled,
  onUpdateRepositoryExecutionEngine,
  onUpdateEmployeeExecutionEngine,
  codexAvailable = true,
  cursorAvailable = true,
  geminiAvailable = false,
  opencodeAvailable = false,
  qoderAvailable = false,
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
  onRespondToPermissionAt,
  onToggleTodoAt,
  onClearFollowupsAt,
  onClearRevertItemsAt,
  onSendFollowupAt,
  onRestoreRevertAt,
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
  panelBelowRequirements,
  panelBelowQuickActions,
  panelBelowTerminal,
  hideMessages = false,
  hideSessionTools = false,
  centerView = "messages",
  onCenterViewChange,
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

  const openSessionConversationTaskDetail = useCallback(
    (task: SessionConversationTaskItem) => {
      // 执行环境派发：直接打开新建会话窗口，不再弹详情 drawer。
      const sid = task.sessionId?.trim();
      if (task.source === "execution_environment" && sid && onSwitchSession) {
        onSwitchSession(sid);
        return;
      }
      prefetchSessionConversationTaskDetailDrawer();
      setSessionConversationTaskDetailTarget({ task });
    },
    [onSwitchSession],
  );

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

  const replayUserMessage = useCallback(
    (prompt: string) => {
      void onExecute(session.id, prompt);
    },
    [onExecute, session.id],
  );

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
    // 内置终端表面自己管焦点；不要抢到 chatRoot，否则 Claude Code CLI 无法继续接收按键。
    if (hit.closest(".terminal-shell, .terminal-surface, .terminal-input")) return;
    if (hit.closest(".app-session-quick-actions")) return;
    if (hit.closest("[data-wise-composer-root]")) return;
    if (hit.closest(".monaco-editor, .milkdown, .tiptap, .ProseMirror")) return;
    if (document.activeElement === root) return;
    root.focus({ preventScroll: true });
  }, []);

  /** 占用中 Esc 仅停止（不撤 transcript）：composer 用 useLayoutEffect 抢先处理「撤回刚发」
   *  Monaco / 富文本编辑器挂载在中栏容器内时，必须排除它们的 Esc
   *  （如关闭 Monaco find widget、多光标回到单光标、编辑器浮层收起等），否则用户在
   *  文件预览、设置 JSON 编辑、消息中的富文本视图里按 Esc 会把正在跑的会话停掉。 */
  useEffect(() => {
    function isEditableSurfaceElement(el: Element | null): boolean {
      if (!el) return false;
      // Monaco 编辑器（含 find/rename/replace widget、菜单）、Tiptap 富文本
      return Boolean(el.closest(".monaco-editor, .milkdown, .tiptap, .ProseMirror"));
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
      // slash/@ 弹层 portal 到 body，不在 chat 子树内
      if (document.querySelector(".app-claude-slash-popover")) return;

      // Esc 落在 Monaco 编辑器或 Tiptap 富文本上时，让编辑器自己处理
      // （关闭查找、多光标归一、浮层收起等），不要再冒泡为「取消会话」。
      if (isEditableSurfaceElement(e.target as Element | null)) return;
      if (ae instanceof Element && isEditableSurfaceElement(ae)) return;

      // 内置终端里跑的是 Claude Code CLI：Esc 必须交给 PTY，不能在此取消会话并吞掉按键。
      const inTerminal =
        (t instanceof Element && Boolean(t.closest(".terminal-shell, .terminal-input"))) ||
        (ae instanceof Element && Boolean(ae.closest(".terminal-shell, .terminal-input")));
      if (inTerminal) return;

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

  // 声明本窗格拥有该会话队列的前台消费权；切走 / 离屏卸挂后由后台 flush 接管。
  useEffect(() => claimPendingTaskQueueOwner(session.id), [session.id]);


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
   * 派发失败追踪：catch 路径按 fingerprint 累加失败次数，达上限 drop（避免无限重入循环 +
   * 队列重复增长：原 task 派发时未 removeTask，抛错时仍在队列，若再 addTask 会新增重复条目）。
   * 未达上限则退避（setTimeout 延迟 addTask）重入队。与 inFlight set / gate 正交：
   * 后两者防「同一帧重入 / status 翻转延迟」，本追踪器防「持续抛错的无限重派」。
   */
  const dispatchFailureTrackerRef = useRef(createDispatchFailureTracker());
  /** 退避重入队的 setTimeout 句柄：会话切换/卸载时清理，避免把旧会话任务派发到新会话队列。 */
  const dispatchRequeueTimerRef = useRef<number | null>(null);
  const dispatchRequeueSessionIdRef = useRef(session.id);
  dispatchRequeueSessionIdRef.current = session.id;

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
      // 失败追踪 fingerprint：相同目标 + 相同 prompt 的连续失败累加，达上限 drop。
      const failureFp = `${targetType ?? "main"}|${targetEmployeeName ?? ""}|${targetWorkflowId ?? ""}|${promptText}`;
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
        let suppressFinalFlush = false;
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
            // 未真正派发（并发阻塞 / session 尚未 hydrate / gemini 不支持 / bootstrap 超限等）。
            // `executeSession` 内已 `onClaudeSpawnBlocked` 提示，此处不重复 toast。
            // 轮次由 `executeSession` 自己注销，此处无需额外释放。
            // 抑制 finally 的 microtask flush：立即重派会撞同一门闸形成紧循环；且历史上 dedup
            // 假命中曾致任务被当成功移除而丢失（已由 dedup 记录后移到 spawn 门闸后修复）。
            // task 留队列，靠 pendingDispatchGateKey effect（含 repoRunningSessionsFingerprint /
            // session.status / pendingTasksFingerprint）在并发释放 / session hydration / 引擎切换
            // 等条件变化时重新 flush 推进；gemini 等真终态则永久留队列由用户切引擎后推进。
            suppressFinalFlush = true;
            return;
          }
          removeTask(id);
          dispatchFailureTrackerRef.current.onSuccess(failureFp);
        } catch (error) {
          console.error("Failed to dispatch pending task:", error);
          // 轮次由 `executeSession` 单点持有并在自身失败分支注销；此处不重复释放，
          // 否则可能误杀用户在 await 期间手动发起的新轮次。
          // 抑制 finally 的 microtask flush：removeTask 的 setTasks 是异步渲染，finally
          // microtask 跑时 pendingTasksRef 仍是旧快照（含本 task），而轮次已注销 ->
          // canDispatchHead 会判定可派发 -> 立即重派，绕过下方退避。退避重入队改由
          // setTimeout 内的 flush 驱动；drop 后其它 lane 靠 pendingTasks 变化触发的
          // gate key effect flush 推进，不会卡死。
          suppressFinalFlush = true;
          // 原 task 在派发时未 removeTask（仅在 success 路径移除），抛错时仍在队列。
          // 必须先 removeTask 去重，否则 addTask 会新增重复条目导致队列爆炸增长。
          removeTask(id);
          const outcome = dispatchFailureTrackerRef.current.onFailure(failureFp);
          if (outcome.action === "drop") {
            void message.error(`任务连续分发失败 ${outcome.count} 次，已从队列移除，请检查执行环境后重试。`);
            return;
          }
          // 退避重入队：延迟 addTask + flush，避免立即重派形成紧循环。
          // timer 绑定发起会话：会话切换/卸载时清理，触发时校验会话未变才重入队，
          // 否则把旧会话任务派发到新会话共享队列（串会话执行）或已卸载组件 state（静默丢失）。
          const requeueSessionId = session.id;
          if (dispatchRequeueTimerRef.current !== null) {
            window.clearTimeout(dispatchRequeueTimerRef.current);
          }
          dispatchRequeueTimerRef.current = window.setTimeout(() => {
            dispatchRequeueTimerRef.current = null;
            if (dispatchRequeueSessionIdRef.current !== requeueSessionId) {
              return;
            }
            addTask({
              promptText,
              executorLabel,
              targetType,
              targetEmployeeName,
              targetWorkflowId,
              targetWorkflowName,
            });
            queueMicrotask(() => flushPendingLaneDispatchesRef.current());
          }, outcome.backoffMs);
        } finally {
          pendingQueueDispatchInFlightLanesRef.current.delete(laneKey);
          if (!suppressFinalFlush) {
            queueMicrotask(() => flushPendingLaneDispatchesRef.current());
          }
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
    }
  }, [session.status, clearIdlePendingDispatchTimer]);

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

  /**
   * 订阅本会话的轮次是否活跃，仅用于在轮次结束时唤醒队列 flush。
   * 派发判定本身仍直接读 store（见 `canDispatchHead`），不依赖这个渲染值。
   */
  const mainLaneTurnActive = useSyncExternalStore(
    subscribeSessionTurns,
    () => hasActiveSessionTurn(session.id),
    () => false,
  );

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
        // 已登记轮次意味着本会话正在跑或刚派发但状态尚未渲染；两种情况都不能再出队。
        // 读的是模块级 store 而非渲染值，因此不受 React 重渲染时序影响。
        if (hasActiveSessionTurn(session.id)) return false;
        // 轮次之外的运行来源（磁盘恢复、外部 spawn、后台接管）只体现在 status 上。
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
    [isMainIdle, isEmployeeIdle, isTeamIdle, session.id],
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
        mainLaneTurnActive ? "1" : "0",
        omcMonitorPipelineBusy ? "1" : "0",
        repoRunningSessionsFingerprint,
        workflowBusyFingerprint,
        taskPendingEmployeesFingerprint,
        pendingTasksFingerprint,
      ].join("|"),
    [
      session.status,
      mainLaneTurnActive,
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

  // 队列派发态按 task.id 预计算，避免每次 render 内联 Object.fromEntries 产生新引用触发下游重渲染。
  const taskDispatchStateById = useMemo(
    () =>
      Object.fromEntries(
        pendingTasks.map((task) => [task.id, getPendingTaskDispatchState(task)]),
      ),
    [pendingTasks, getPendingTaskDispatchState],
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
    // 会话切换：清空派发失败计数，避免新会话的同指纹任务被旧计数误判 drop。
    dispatchFailureTrackerRef.current.clear();
    // 会话切换：清理上一会话遗留的退避重入队 timer，防止任务重入队到新会话队列。
    if (dispatchRequeueTimerRef.current !== null) {
      window.clearTimeout(dispatchRequeueTimerRef.current);
      dispatchRequeueTimerRef.current = null;
    }
    // 轮次状态按 tabSessionId 隔离，切换会话不会继承上一个会话的门闸，无需在此重置。
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
      // 卸载/切会话：清退避重入队 timer，避免 timer 回调访问已卸载组件 state。
      if (dispatchRequeueTimerRef.current !== null) {
        window.clearTimeout(dispatchRequeueTimerRef.current);
        dispatchRequeueTimerRef.current = null;
      }
    };
  }, [session.id, session.repositoryPath]);

  // 会话切换 reset：取代旧 key={activeSession.id} 的整棵 remount。
  // 仅清"按会话生命周期绑定、不应跨会话残留"的瞬态量。
  // 不动：composer draft（carryDraft 语义依赖）、sessionOwnerHints（来自 localStorage 的全局提示）、
  //      notificationPanelCollapsed（由 initialNotificationPanelCollapsed prop 驱动）、
  //      messages（来自 session.messages props，自身随 session 切换重渲染）、
  //      dispatchFailureTracker/deferredSendHydrated（紧邻的 1130-1178 effect 已重置）。
  useEffect(() => {
    setNotificationRows([]);
    setNotificationLoading(false);
    setNotificationBubbleEnterIds(new Set());
    setNotificationBadgePulse(false);
    setNotificationTitleCountPulse(false);
    sessionNotificationSeenIdsRef.current = new Set();
    prevSessionUnreadCountRef.current = 0;
  }, [session.id]);

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
  // 一次性读全局 ultracode 状态供 composer chip 展示；仅在挂载时读一次，
  // 全局开关变更不会立刻反映到 chip（与「下次 spawn 才生效」的语义一致）。
  const [globalUltracodeEnabledState, setGlobalUltracodeEnabled] = useState<boolean | undefined>(
    globalUltracodeEnabled,
  );
  useEffect(() => {
    if (globalUltracodeEnabledState !== undefined) return;
    let cancelled = false;
    void loadGlobalUltracodeEnabled().then((v) => {
      if (!cancelled) setGlobalUltracodeEnabled(v);
    });
    return () => {
      cancelled = true;
    };
  }, [globalUltracodeEnabledState]);
  const resolvedGlobalUltracodeEnabled = globalUltracodeEnabled ?? globalUltracodeEnabledState ?? false;

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
  const [sessionOwnerHints, setSessionOwnerHints] = useState<Record<string, SessionOwnerHint>>(() => loadSessionOwnerHints());
  const sessionForNotificationPanelRef = useRef(session);
  sessionForNotificationPanelRef.current = session;
  const sessionsForNotificationMatchRef = useRef(sessions);
  sessionsForNotificationMatchRef.current = sessions;
  /** 稳定查找面：引用不随整表 sessions 重建变化，避免消息行 element cache 被结构 tick 打穿。 */
  const sessionsForDispatchLookup = useCallback((sessionId: string) => {
    const key = sessionId.trim();
    if (!key) return undefined;
    return sessionsForNotificationMatchRef.current.find(
      (item) => item.id === key || item.claudeSessionId === key,
    );
  }, []);
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

  const questionDockTabs = useQuestionDockTabsForRepository(session, sessions, sessionOwnerHints);

  const sessionExecutionEngine = useMemo(() => {
    if (paneCount > 1 && paneRuntimeOverride?.executionEngine) {
      return normalizeSessionExecutionEngine(paneRuntimeOverride.executionEngine);
    }
    return resolveEngineForSession(session, repositories, employees, sessionRepository);
  }, [paneCount, paneRuntimeOverride?.executionEngine, session, repositories, employees, sessionRepository]);

  // 中栏「需求」面板派发：走当前执行环境（@Claude Code / @Codex …），开 worker，不占主会话队列。
  // 仅 pane 0 接收（需求 slot 也只挂在 pane 0）。
  useEffect(() => {
    if (paneIndex !== 0) return;
    const onDispatchRequirement = (event: Event) => {
      const detail = (event as CustomEvent<DispatchRequirementToExecutionEnvironmentDetail>).detail;
      const promptText = typeof detail?.promptText === "string" ? detail.promptText.trim() : "";
      if (!promptText) return;
      if (!onDispatchExecutionEnvironment) {
        message.warning("当前无法派发到执行环境");
        return;
      }
      const promptWithMention = prefixExecutionEnvironmentMention(promptText, sessionExecutionEngine);
      const userBubble =
        typeof detail.userBubblePrompt === "string" && detail.userBubblePrompt.trim()
          ? detail.userBubblePrompt.trim()
          : promptText;
      detail.onAccepted?.();
      // 自动派发按轮汇总提示（见 useWorkspaceRequirementAutoDispatch），避免每个需求各弹一条成功框。
      if (detail.source !== "workspace-requirement-auto") {
        message.success("需求已派发到执行环境");
      }
      void onDispatchExecutionEnvironment({
        prompt: promptWithMention,
        userBubblePrompt: userBubble,
        requirementId: detail.requirementId,
        requirementRepositoryId: detail.requirementRepositoryId,
      });
    };
    window.addEventListener(WISE_UI_EVENT_DISPATCH_REQUIREMENT_TO_EXEC_ENV, onDispatchRequirement);
    return () =>
      window.removeEventListener(WISE_UI_EVENT_DISPATCH_REQUIREMENT_TO_EXEC_ENV, onDispatchRequirement);
  }, [paneIndex, onDispatchExecutionEnvironment, sessionExecutionEngine]);

  const handleSessionExecutionEngineChange = useCallback(
    (engine: SessionExecutionEngine) => {
      // 先写标签级引擎：当前会话下一回合立即按新引擎 spawn（此前只改仓库默认，须新建会话才生效）。
      void onUpdateSessionExecutionEngine?.(session.id, engine);
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
      onUpdateSessionExecutionEngine,
      onUpdatePaneRuntimeOverride,
      paneCount,
      paneIndex,
      paneRuntimeOverride?.claudeProxyRoute,
      session.id,
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

  const publishedTeamMentions = useMemo(
    () =>
      workflowTemplates
        .filter((item) => (workflowGraphStatusByWorkflowId[item.id] ?? "").toLowerCase() === "published")
        .map((item) => ({ id: item.id, name: item.name })),
    [workflowTemplates, workflowGraphStatusByWorkflowId],
  );

  const { appendSessionSendTrace } = useClaudeChatSessionFeaturePanel({
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
  const sessionUnreadCountRef = useRef(sessionUnreadCount);
  useEffect(() => {
    sessionUnreadCountRef.current = sessionUnreadCount;
  }, [sessionUnreadCount]);

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
      if (openCodeReviewFromNotification({ conversationId, body: row.body })) {
        if (!row.readAt) {
          const readStamp = new Date().toISOString();
          setNotificationRows((prev) =>
            prev.map((r) => (r.id === row.id ? { ...r, readAt: readStamp } : r)),
          );
          void wiseNotificationMarkRead(row.id).catch(() => {
            setNotificationRows((prev) =>
              prev.map((r) => (r.id === row.id ? { ...r, readAt: null } : r)),
            );
          });
        }
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
      const custom = event as CustomEvent<{ conversationId?: string; any?: boolean }>;
      const conversationId = custom.detail?.conversationId;
      if (!custom.detail?.any) {
        if (typeof conversationId !== "string" || !conversationId.trim()) {
          return;
        }
        const s = sessionForNotificationPanelRef.current;
        if (!notificationConversationInSessionInboxScope(conversationId, s, sessionsForNotificationMatchRef.current)) {
          return;
        }
      } else if (sessionUnreadCountRef.current <= 0) {
        // 任意展开模式：本会话无未读时不抢着展开，让有未读的会话负责显示。
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





  // 防御：centerView 指向某 slot 但对应 panel 已卸挂时，不得全隐成白屏
  // （典型：终端被 collapse 后 Segmented 仍停在 terminal）。
  const hasFilesPanel = Boolean(panelBelowMessages);
  const hasRequirementsPanel = Boolean(panelBelowRequirements);
  const hasQuickActionsPanel = Boolean(panelBelowQuickActions);
  const hasTerminalPanel = Boolean(panelBelowTerminal);
  const hasAnyAuxPanel =
    hasFilesPanel || hasRequirementsPanel || hasQuickActionsPanel || hasTerminalPanel;
  const auxRailWindowDeltaRef = useRef(0);
  const centerViewControl = useCenterViewControl();
  const workbenchRef = useRef<HTMLDivElement | null>(null);
  const [auxRailWidth, setAuxRailWidth] = useState(SESSION_AUX_RAIL_DEFAULT_WIDTH_PX);
  const [auxRailFitsWindow, setAuxRailFitsWindow] = useState(false);
  const auxRailResizeActiveRef = useRef(false);
  useEffect(() => {
    const updateFit = () => {
      // 窗口已经为当前右栏扩展过时，保持扩展锁，避免测量到新宽度后立即收回，
      // 造成“扩展-收回-再扩展”的闪烁循环。
      if (auxRailWindowDeltaRef.current > 0) {
        setAuxRailFitsWindow(false);
        return;
      }
      const width = workbenchRef.current?.getBoundingClientRect().width ?? 0;
      // 右栏打开时，中栏至少保留 460px，避免消息内容被压缩到不可用。
      setAuxRailFitsWindow(width >= 460 + SESSION_AUX_RAIL_DEFAULT_WIDTH_PX);
    };
    updateFit();
    window.addEventListener("resize", updateFit);
    return () => window.removeEventListener("resize", updateFit);
  }, [hasAnyAuxPanel]);

  const shouldExpandWindowForAuxRail =
    paneIndex === 0 && hasAnyAuxPanel && !hideMessages && !auxRailFitsWindow;

  useEffect(() => {
    if (shouldExpandWindowForAuxRail && auxRailWindowDeltaRef.current === 0) {
      // 右栏打开时中栏适度收窄（默认让出 320px，但保留 460px 下限），
      // 窗口只扩展补足差额；避免固定补 480px 时中栏几乎不变、消息区仍显得过宽。
      const workbenchWidth = workbenchRef.current?.getBoundingClientRect().width ?? 0;
      if (workbenchWidth <= 0) {
        // 布局尚未测量：按旧固定扩展量兜底，避免算出过大的差额。
        auxRailWindowDeltaRef.current = 480;
        void adjustMainWindowLogicalWidthByDelta(480);
        return;
      }
      const targetMiddleWidth = Math.max(
        SESSION_AUX_RAIL_MIDDLE_MIN_PX,
        workbenchWidth - SESSION_AUX_RAIL_MIDDLE_SHRINK_PX,
      );
      const delta = Math.max(
        0,
        targetMiddleWidth + SESSION_AUX_RAIL_DEFAULT_WIDTH_PX + 9 - workbenchWidth,
      );
      auxRailWindowDeltaRef.current = delta;
      if (delta > 0) {
        void adjustMainWindowLogicalWidthByDelta(delta);
      }
      return;
    }
    if (!shouldExpandWindowForAuxRail && auxRailWindowDeltaRef.current > 0) {
      const delta = auxRailWindowDeltaRef.current;
      auxRailWindowDeltaRef.current = 0;
      void adjustMainWindowLogicalWidthByDelta(-delta);
    }
  }, [shouldExpandWindowForAuxRail]);

  useEffect(() => {
    return () => {
      const delta = auxRailWindowDeltaRef.current;
      auxRailWindowDeltaRef.current = 0;
      if (delta > 0) void adjustMainWindowLogicalWidthByDelta(-delta);
    };
  }, []);

  const resizeAuxRailFromPointer = useCallback((clientX: number) => {
    const bounds = workbenchRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const maxWidth = Math.max(SESSION_AUX_RAIL_MIN_WIDTH_PX, bounds.width - 460);
    setAuxRailWidth(
      Math.min(maxWidth, Math.max(SESSION_AUX_RAIL_MIN_WIDTH_PX, bounds.right - clientX)),
    );
  }, []);

  const handleAuxRailResizePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    auxRailResizeActiveRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeAuxRailFromPointer(event.clientX);
    event.preventDefault();
  }, [resizeAuxRailFromPointer]);

  const handleAuxRailResizePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!auxRailResizeActiveRef.current) return;
    resizeAuxRailFromPointer(event.clientX);
  }, [resizeAuxRailFromPointer]);

  const handleAuxRailResizePointerEnd = useCallback((event: PointerEvent<HTMLDivElement>) => {
    auxRailResizeActiveRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);
  const effectiveCenterView: CenterView = (() => {
    if (centerView === "messages") return "messages";
    if (centerView === "files" && hasFilesPanel) return "files";
    if (centerView === "requirements" && hasRequirementsPanel) return "requirements";
    if (centerView === "quickActions" && hasQuickActionsPanel) return "quickActions";
    if (centerView === "terminal" && hasTerminalPanel) return "terminal";
    if (hasFilesPanel) return "files";
    if (hasRequirementsPanel) return "requirements";
    if (hasQuickActionsPanel) return "quickActions";
    if (hasTerminalPanel) return "terminal";
    return "messages";
  })();

  const effectiveAuxView: CenterView = effectiveCenterView === "messages"
    ? hasFilesPanel
      ? "files"
      : hasRequirementsPanel
        ? "requirements"
        : hasQuickActionsPanel
          ? "quickActions"
          : hasTerminalPanel
            ? "terminal"
            : "messages"
    : effectiveCenterView;
  const messagesPaneVisible = !hideMessages;
  const filesPaneVisible =
    hasFilesPanel && (hideMessages || effectiveAuxView === "files");
  const requirementsPaneVisible =
    hasRequirementsPanel && (hideMessages || effectiveAuxView === "requirements");
  const quickActionsPaneVisible =
    hasQuickActionsPanel && (hideMessages || effectiveAuxView === "quickActions");
  const terminalPaneVisible =
    hasTerminalPanel && (hideMessages || effectiveAuxView === "terminal");
  const auxOptions = [
    hasFilesPanel ? { label: "文件", value: "files" as const } : null,
    hasRequirementsPanel ? { label: "需求", value: "requirements" as const } : null,
    hasQuickActionsPanel ? { label: "快捷操作", value: "quickActions" as const } : null,
    hasTerminalPanel ? { label: "终端", value: "terminal" as const } : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <div
      ref={chatRootRef}
      className="app-claude-chat"
      tabIndex={-1}
      onPointerDownCapture={onChatPointerDownCapture}
    >
      <div className="app-claude-chat-body">
        <div className="app-claude-chat-main">

      <div
        ref={workbenchRef}
        className={`app-claude-chat-workbench${hasAnyAuxPanel && !hideMessages ? " has-aux-rail" : ""}`}
        style={
          hasAnyAuxPanel && !hideMessages
            ? ({ "--app-session-aux-rail-width": `${auxRailWidth}px` } as CSSProperties)
            : undefined
        }
      >
      <div
        className={`app-claude-chat-center-pane app-claude-chat-messages-pane${messagesPaneVisible ? "" : " is-hidden"}`}
        // keep-alive 隐藏时用 inert 移出键盘焦点（visibility:hidden 仍可能进 Tab 序）
        inert={messagesPaneVisible ? undefined : true}
        aria-hidden={messagesPaneVisible ? undefined : true}
      >
        {!hideMessages ? (
          <ClaudeChatMessagesLiveHost
            sessionId={session.id}
            claudeSessionId={session.claudeSessionId}
            hideMessagesScroll={
              hideMessages ||
              deferHeavySubtree ||
              !messagesPaneVisible
            }
            fullTranscriptLoading={fullTranscriptLoading}
            onReloadFullDiskTranscript={onReloadFullDiskTranscript}
            onOpenTaskDetail={onOpenTaskDetail}
            onOpenHistorySessionInInspector={onOpenHistorySessionInInspector}
            onOpenSessionConversationTaskDetail={openSessionConversationTaskDetail}
            resolveExecutionEnvironmentDispatchTask={resolveExecutionEnvironmentDispatchTask}
            sessionsForDispatchLookup={sessionsForDispatchLookup}
            onReplayUserMessage={replayUserMessage}
            onFullTranscriptStart={handleFullTranscriptStart}
            onFullTranscriptEnd={handleFullTranscriptEnd}
            messageListProfile={messageListProfile}
            companionMessageListWindow={companionMessageListWindow}
            sessionExecutionEngine={sessionExecutionEngine}
          />
        ) : null}
      </div>
      {hasAnyAuxPanel && !hideMessages ? (
        <div
          className="app-claude-chat-aux-resizer"
          role="separator"
          aria-label="调整消息区与功能栏宽度"
          aria-orientation="vertical"
          onPointerDown={handleAuxRailResizePointerDown}
          onPointerMove={handleAuxRailResizePointerMove}
          onPointerUp={handleAuxRailResizePointerEnd}
          onPointerCancel={handleAuxRailResizePointerEnd}
        />
      ) : null}
      {hasAnyAuxPanel ? (
        <aside
          className={`app-claude-chat-aux-rail${hideMessages ? " is-full-width" : ""}`}
          aria-label="会话功能栏"
          style={hideMessages ? undefined : { flexBasis: auxRailWidth, width: auxRailWidth }}
        >
          {!hideMessages && auxOptions.length > 1 ? (
            <div className="app-claude-chat-aux-rail__tabs" role="tablist" aria-label="会话功能">
              {auxOptions.map((option) => (
                <button key={option.value} type="button" role="tab"
                  aria-selected={effectiveAuxView === option.value}
                  className={`app-claude-chat-aux-rail__tab${effectiveAuxView === option.value ? " is-active" : ""}`}
                  onClick={() => {
                    (centerViewControl ?? onCenterViewChange)?.(option.value);
                  }}>
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
          <div className="app-claude-chat-aux-rail__content">
      {/*
       * files pane：centerView !== "files" 时直接 unmount，强制 git diff Monaco 等
       * 重型编辑器随 Segmented 切走被卸载，杜绝 keep-alive 模式下 `is-hidden`
       * 视觉未完全遮蔽带来的"切到消息时 diff 仍可见"回归。`panelBelowMessages`
       * slot 来自 `PaneEditorHost` 常驻的 `useRepositoryFileEditor`，tabs /
       * activePath / dirty 等 hook 状态在切回时按 keep-alive 设计恢复，
       * 激活 tab 的 Monaco 通过 `everActivated` 路径重 mount，缩放计算由
       * `runWhenIdle` + `shouldDeferMonacoEditorMount` 兜底。terminal pane
       * 仍走 `is-hidden`（PTY 不能 display:none）。
       */}
      {panelBelowMessages && filesPaneVisible ? (
        <div className="app-claude-chat-center-pane">{panelBelowMessages}</div>
      ) : null}
      {panelBelowRequirements && requirementsPaneVisible ? (
        <div className="app-claude-chat-center-pane">{panelBelowRequirements}</div>
      ) : null}
      {panelBelowQuickActions && quickActionsPaneVisible ? (
        <div className="app-claude-chat-center-pane">{panelBelowQuickActions}</div>
      ) : null}
      {panelBelowTerminal ? (
        <div
          className={`app-claude-chat-center-pane${terminalPaneVisible ? "" : " is-hidden"}`}
          inert={terminalPaneVisible ? undefined : true}
          aria-hidden={terminalPaneVisible ? undefined : true}
        >
          {panelBelowTerminal}
        </div>
      ) : null}
          </div>
        </aside>
      ) : null}
      </div>

      {showPendingTaskQueue ? (
        <div
          className="app-pending-task-queue-anchor"
          style={hasAnyAuxPanel && !hideMessages ? { width: `calc(100% - ${auxRailWidth + 9}px)` } : undefined}
        >
          <PendingTaskQueuePanel
            sessionId={session.id}
            sessionStatus={session.status}
            tasks={pendingTasks}
            repositoryPath={session.repositoryPath}
            employees={employees}
            employeeMentions={employeeMentionOptions}
            teamMentions={publishedTeamMentions}
            sessionExecutionEngine={sessionExecutionEngine}
            codexAvailable={codexAvailable}
            cursorAvailable={cursorAvailable}
            geminiAvailable={geminiAvailable}
            opencodeAvailable={opencodeAvailable}
            qoderAvailable={qoderAvailable}
            deferredSendQueued={deferredSendQueued}
            taskDispatchStateById={taskDispatchStateById}
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

      <div
        className="app-claude-chat-bottom"
        style={hasAnyAuxPanel && !hideMessages ? { width: `calc(100% - ${auxRailWidth + 9}px)` } : undefined}
      >
        {!deferHeavySubtree ? (
          <ClaudeChatQuickActionsChrome
            sessionId={session.id}
            repositoryId={sessionRepository?.id ?? null}
            onCreateNewSession={onCreateNewSession}
            creatingNewSession={creatingNewSession}
            onOpenBuiltinAssistant={onOpenBuiltinAssistant}
            onActivateAssistant={onActivateAssistant}
            onOpenAssistantsHub={onOpenAssistantsHub}
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
              compactFooterChrome={filesPaneVisible || requirementsPaneVisible}
              session={session}
              gitRepositoryPath={gitRepositoryPath}
              repositoryId={sessionRepository?.id ?? null}
              employeesForDispatchRoute={employees}
              pendingExecutionTaskCount={pendingTasks.length}
              onExecute={handleComposerExecute}
              onDispatchExecutionEnvironment={onDispatchExecutionEnvironment}
              onSessionModelChange={onSessionModelChange}
              onSessionConnectionKindChange={onSessionConnectionKindChange}
              onUpdateSessionUltracode={onUpdateSessionUltracode}
              onUpdateSessionCodexReasoningEffort={onUpdateSessionCodexReasoningEffort}
              onUpdateSessionClaudeReasoningEffort={onUpdateSessionClaudeReasoningEffort}
              globalUltracodeEnabled={resolvedGlobalUltracodeEnabled}
              sessionExecutionEngine={sessionExecutionEngine}
              codexAvailable={codexAvailable}
              cursorAvailable={cursorAvailable}
              geminiAvailable={geminiAvailable}
              opencodeAvailable={opencodeAvailable}
              qoderAvailable={qoderAvailable}
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
              onEnqueueAsPendingTask={addTask}
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
          onRespondToQuestion={respondQuestionAt}
          onDismissQuestion={dismissQuestionAt}
          onRespondToPermission={onRespondToPermissionAt}
          onToggleTodo={onToggleTodoAt}
          onSendFollowup={onSendFollowupAt}
          onRestoreRevert={onRestoreRevertAt}
          onClearFollowups={onClearFollowupsAt}
          onClearRevertItems={onClearRevertItemsAt}
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
    </div>
  );
}

export const ClaudeChat = memo(ClaudeChatInner, claudeChatPropsEqual);
