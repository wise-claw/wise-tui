import {
  BellOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  CommentOutlined,
  DeleteOutlined,
  FieldTimeOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Drawer,
  Tooltip,
  message,
  Popover,
  Popconfirm,
  Empty,
  Modal,
  Spin,
  Table,
  Tag,
  Input,
  Select,
  Space,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useMemo,
  useSyncExternalStore,
  type PointerEvent,
} from "react";
import type {
  ClaudeComposerExecuteBubbleOptions,
  ClaudeSession,
  GitWorktreeEntry,
  TodoItem,
  QuestionRequest,
  PermissionRequest,
} from "../../types";
import type { ControlRequestStatus } from "../../notifications";
import { StreamingReplyHint } from "./Markdown";
import { ClaudeChatMessageRow } from "./ClaudeChatMessageRow";
import { ClaudeSessionTrajectoryDrawer } from "./ClaudeSessionTrajectoryDrawer";
import { SessionQuickActionsBar } from "./SessionQuickActionsBar";
import type { ClaudeSessionConnectionKind } from "../../constants/claudeConnection";
import { ComposerRegion, type DualPaneComposerRepositoryPickerProps } from "../ClaudeChatInput";
import { gitCommit, gitPull, gitPush, gitStage, gitStatus, gitWorktreeList, gitWorktreeRemove } from "../../services/git";
import { openInFinder } from "../../services/repository";
import { executeClaudeCodeAndWait, getClaudeConfigModel } from "../../services/claude";
import { scheduleDirectOmcBatchAfterMacrotask } from "../../services/omcDirectBatchExecution";
import { BackgroundInvocationDock } from "./BackgroundInvocationDock";
import { PendingTaskQueuePanel } from "./PendingTaskQueuePanel";
import { RepositoryScheduledTasksModal } from "../RepositoryScheduledTasksModal";
import { usePendingTaskQueue } from "../../hooks/usePendingTaskQueue";
import { useQuestionDockTabsForRepository } from "../../hooks/useQuestionDockTabs";
import { buildClaudeSessionHoverTitle } from "../../utils/claudeSessionIdTooltip";
import { requestWorkflowRunRefresh, useWorkflowRun } from "../../hooks/useWorkflowRun";
import { getWorkflowFacade } from "../../services/workflow";
import { runSplitTasksOmcBatch } from "../../services/workflow/actions";
import { resolveTrellisSubagentForStage } from "../../services/workflow/trellisDefaults";
import {
  isDirectOmcBatchTemplateId,
  TRELLIS_BATCH_TEMPLATE_ID,
  type OmcBatchTemplateId,
} from "../../constants/omcBatchTemplates";
import { loadPrdTaskSplitResult, savePrdTaskSplitResult } from "../../services/prdTaskSplitStore";
import {
  archiveTrellisTask,
  listProjectRequirementWorkspace,
  type TrellisRequirementTaskRow,
} from "../../services/trellisTaskBridge";
import { refreshSplitResultDerivedFields } from "../../services/taskSplitter";
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
  getRepositoryBaseDisplayName,
} from "../../utils/sessionRepositoryDisplay";
import {
  extractNotificationScrollKeyword,
  formatNotificationInboxDisplayLine,
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
import { extractClaudeInvocationFinalText } from "../../utils/claudeInvocationText";
import { removeSplitResultTasksByIds } from "../../utils/removeSplitResultTasksByIds";
import {
  getMessageSenderGroupKey,
  hasRenderableChatMessageBody,
  indexOfPreviousRenderableMessage,
  isToolOnlyUserMessage,
  userMessagePlainTextForDisplay,
} from "../../utils/claudeChatMessageDisplay";
import { pickSessionForRepositorySidebarSelect } from "../../utils/claudeSessionSelection";
import { useComposerSpeechPreferences } from "../../hooks/useComposerSpeechPreferences";
import {
  buildSpeechToRequirementScope,
  useSpeechToRequirementSync,
} from "../../hooks/useSpeechToRequirementSync";
import { buildOmcBatchTaskIntentOneLiner } from "../../utils/omcBatchTaskIntentOneLiner";
import {
  resolveRepositoryMainSessionId,
  resolveMainOwnerAgentNameForRepositoryPath,
} from "../../utils/repositoryMainSessionBinding";
import { getAppSetting, setAppSetting } from "../../services/appSettingsStore";
import {
  CONTEXT_AUTO_COMPACT_BEFORE_SEND_PERCENT,
  CONTEXT_WARN_PERCENT,
  getSessionContextMetrics,
} from "../../services/claudeSessionContext";
import {
  buildAiCommitSummary,
  buildTaskExecutionPrompt,
  countSessionUnreadNotifications,
  extractEmployeeNameFromBracketPreview,
  extractOmcCommandFromUserPrompt,
  formatShortQuestionTime,
  formatTaskRoleLabel,
  formatWorktreeBranchLabel,
  formatWorktreePathRelative,
  getLatestDispatchedTeamName,
  getLatestUserPlainText,
  getSessionPreview,
  notificationConversationInSessionInboxScope,
  notificationRowInSessionInboxScope,
  normalizeSplitTaskListFlowStatus,
  sessionRepoPathKey,
  splitTaskListBinaryLabel,
} from "./claudeChatHelpers";
import { getSessionUpdatedAt, groupSessionsByDay } from "./sessionGrouping";
import {
  SESSION_NOTIFICATION_UI_EVENT_OPEN_PANEL,
  WORKFLOW_UI_EVENT_FOCUS_TASK_TOOL,
  WORKFLOW_UI_EVENT_OMC_BATCH_RUNTIME_CHANGED,
  WORKFLOW_UI_EVENT_REPO_WORKTREES_MAY_HAVE_CHANGED,
  WORKFLOW_UI_EVENT_SPLIT_TODO_COUNT_UPDATED,
  type SplitTodoCountUpdatedDetail,
  type RepoWorktreesMayHaveChangedDetail,
  type WorkflowOmcBatchRuntimeDetail,
} from "../../constants/workflowUiEvents";
import { TEAM_AUTO_DRIVER_PREFIXES } from "../../constants/teamAutoDriver";
import { OMC_MONITOR_EMPLOYEE_NAME } from "../../constants/omcMonitor";
import {
  getOmcDirectBatchInvocationsSnapshot,
  subscribeOmcDirectBatchInvocations,
} from "../../stores/omcDirectBatchInvocationsStore";
import { isOmcDirectBatchInvocationRunning } from "../../utils/omcDirectBatchInvocationDisplay";
import type {
  EmployeeItem,
  PendingExecutionTask,
  ProjectItem,
  Repository,
  TaskItem,
  TaskFlowStatus,
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

interface Props {
  session: ClaudeSession;
  sessions?: ClaudeSession[];
  repositories?: Repository[];
  activeRepository?: Repository;
  onSwitchSession?: (
    sessionId: string,
    options?: { collapseSessionNotificationPanel?: boolean },
  ) => void;
  /** 由父级在「返回主会话」等场景传入，使重挂载后面板默认收起 */
  initialNotificationPanelCollapsed?: boolean;
  onCreateNewSession?: () => void;
  /** 从快捷条「更多」直达指定内置助手对话页 */
  onOpenBuiltinAssistant?: (assistantId: string) => void;
  onSend: (prompt: string) => void;
  onExecute: (
    sessionId: string,
    prompt: string,
    dispatchTarget?: Pick<PendingExecutionTask, "targetType" | "targetEmployeeName" | "targetWorkflowId" | "targetWorkflowName">,
    executeOptions?: ClaudeComposerExecuteBubbleOptions,
  ) => boolean | void | Promise<boolean | void>;
  onSessionModelChange: (model: string) => void;
  onSessionConnectionKindChange?: (kind: ClaudeSessionConnectionKind) => void;
  onCancel: (opts?: { retractLastUserTurn?: boolean }) => void;
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
  onClearTodos: () => void;
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
  /**
   * 侧栏展示的「当前仓库 Claude 槽位剩余」估算（并发上限 − 运行中会话数），仅作提示，不再限制可执行任务多选条数。
   */
  taskListConcurrentCapacity?: number;
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
  onRefreshHistorySessions?: () => void | Promise<void>;
  /** 历史会话弹窗内删除某条会话（物理删除磁盘 jsonl，不可恢复）。运行中的会话会抛错。 */
  onDeleteHistorySession?: (sessionId: string) => Promise<void>;
  /** App 侧 `omcBatchRuntime.active`：批量 OMC 调度中（含任务间隙），用于员工空闲判定 */
  omcBatchPipelineActive?: boolean;
  /** 工作树列表：将路径加入当前侧栏项目（由 App 注入） */
  onAddWorktreeRepositoryToProject?: (worktreePath: string) => void | Promise<void>;
  /** 从磁盘读取完整 jsonl 覆盖当前标签消息（`diskTranscriptPartial` 时） */
  onReloadFullDiskTranscript?: (sessionId: string) => void | Promise<void>;
  /** 手动执行 Claude Code `/compact` 压缩会话历史 */
  onCompactSessionHistory?: (sessionId: string) => void | Promise<void>;
  /** 双栏右侧主会话：输入框底栏仓库选择（由父级仅在右侧注入） */
  dualPaneRepositoryPicker?: DualPaneComposerRepositoryPickerProps;
  activeProject?: ProjectItem | null;
  missionContext?: {
    projectId?: string | null;
    rootPath?: string | null;
  };
}

interface SessionSendTraceEntry {
  id: string;
  sessionId: string;
  createdAt: number;
  composerText: string;
  outboundText: string;
  nodes: Array<{ label: string; timestamp: number; detail?: string }>;
}

function mapClaudeExecutionStatusLabel(status: ClaudeSession["status"]): string {
  if (status === "running") return "运行中";
  if (status === "connecting") return "连接中";
  if (status === "completed") return "已完成";
  if (status === "cancelled") return "已取消";
  if (status === "error") return "异常";
  return "空闲";
}

function executionStatusTagColor(
  status: ClaudeSession["status"],
): "default" | "processing" | "success" | "error" {
  if (status === "running" || status === "connecting") return "processing";
  if (status === "completed") return "success";
  if (status === "error") return "error";
  return "default";
}

function formatCompletionActivityTime(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

interface RepositorySessionExecutionRow {
  key: string;
  sessionId: string;
  ownerType: "main" | "employee" | "team";
  scopeLabel: string;
  preview: string;
  status: ClaudeSession["status"];
  statusLabel: string;
  claudeSessionId: string;
  messageCount: number;
  updatedAt: number;
}

type TaskCompletionOwnerFilter = "all" | RepositorySessionExecutionRow["ownerType"];
type TaskCompletionStatusFilter = "all" | ClaudeSession["status"];

function rowMatchesCompletionSearch(row: RepositorySessionExecutionRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    row.scopeLabel,
    row.preview,
    row.claudeSessionId,
    row.sessionId,
    row.statusLabel,
    row.ownerType === "main" ? "主会话" : row.ownerType === "employee" ? "员工" : "团队",
  ]
    .join("\n")
    .toLowerCase();
  return hay.includes(needle);
}

const RETURN_MAIN_SESSION_KEY = "wise:return-main-session-id";
/** 无并发上下文时「可执行任务」多选上限回退值 */
const TASK_LIST_MAX_SELECTED = 50;

/** 中栏「历史会话」「完成任务」：首屏条数与滚动加载步长 */
const FEATURE_SESSION_LIST_PAGE_SIZE = 50;

/** 设为 true 时显示会话特性面板「完成任务」入口与弹窗 */
const SHOW_SESSION_TASK_COMPLETION_FEATURE = false;

const TASK_COMPLETION_MODAL_HINT =
  "以下为当前仓库内各标签会话（主会话、员工独立会话、团队流程会话）的 Claude Code 运行状态与上下文概况，便于核对是否均已执行完毕。各标签上的发送节点明细请在对应标签打开「会话跟踪」查看。";

function normalizeTrellisPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/$/, "");
}

function getTrellisTaskRelativePath(task: TrellisRequirementTaskRow): string {
  const dir = normalizeTrellisPath(task.dir);
  const root = normalizeTrellisPath(task.rootPath);
  if (root && dir.startsWith(`${root}/`)) return dir.slice(root.length + 1);
  const marker = "/.trellis/tasks/";
  const markerIndex = dir.indexOf(marker);
  if (markerIndex >= 0) return dir.slice(markerIndex + 1);
  return dir || `.trellis/tasks/${task.taskId}`;
}

function trellisTaskRowKey(task: TrellisRequirementTaskRow): string {
  return `${normalizeTrellisPath(task.rootPath)}:${normalizeTrellisPath(task.dir)}`;
}

function buildTrellisTaskExecutionPrompt(task: TrellisRequirementTaskRow): string {
  const taskPath = getTrellisTaskRelativePath(task);
  const lines = [
    `Active task: ${taskPath}`,
    "",
    "请基于该 Workspace Trellis 任务继续执行。",
    "",
    `任务ID：${task.taskId}`,
    `标题：${task.title || "(未命名任务)"}`,
    `状态：${task.status || "unknown"}`,
  ];
  if (task.parent?.trim()) lines.push(`父任务：${task.parent.trim()}`);
  if (task.clusterId?.trim()) lines.push(`分片：${task.clusterId.trim()}`);
  if (task.sourceRequirementIds.length > 0) {
    lines.push(`关联需求：${task.sourceRequirementIds.join(", ")}`);
  }
  lines.push("", "请先读取任务目录中的 task.json / prd.md / design.md / implement.md（如存在），再按项目 AGENTS.md 与 .trellis/spec 继续实现、验证并更新任务状态。");
  return lines.join("\n");
}

function isRunnableTrellisRequirementTask(task: TrellisRequirementTaskRow): boolean {
  if (task.archived || !task.parent?.trim()) return false;
  const status = task.status.trim().toLowerCase();
  return status !== "completed" && status !== "rejected" && status !== "archived";
}

function getSessionTraceStorageKey(sessionId: string, repositoryPath?: string): string {
  return `wise:claude:session-send-traces:${repositoryPath ?? ""}:${sessionId}`;
}

export function ClaudeChat({
  session,
  sessions = [],
  repositories = [],
  activeRepository,
  onSwitchSession,
  initialNotificationPanelCollapsed = false,
  onCreateNewSession,
  onOpenBuiltinAssistant,
  onSend: _onSend,
  onExecute,
  onSessionModelChange,
  onSessionConnectionKindChange,
  onCancel,
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
  onClearTodos,
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
  workflowGraphsByWorkflowId = {},
  workflowGraphStatusByWorkflowId = {},
  onOpenTaskDetail,
  panelBelowMessages,
  hideMessages = false,
  hideSessionTools = false,
  taskListConcurrentCapacity,
  resolveTaskListOmcInvokeConcurrency,
  repositoryMainBindings = {},
  onAppendSystemMessage,
  onAppendUserMessage,
  onNotifyOmcEmployeeDirectBatchTaskDone,
  onPrepareFreshOmcEmployeeWorkerForDirectBatch,
  onRefreshHistorySessions,
  onDeleteHistorySession,
  omcBatchPipelineActive = false,
  onAddWorktreeRepositoryToProject,
  onReloadFullDiskTranscript,
  onCompactSessionHistory,
  dualPaneRepositoryPicker,
  missionContext,
  activeProject,
}: Props) {
  const chatRootRef = useRef<HTMLDivElement>(null);
  const composerTrayRef = useRef<HTMLDivElement>(null);
  const { prefs: speechPrefs } = useComposerSpeechPreferences();
  const speechToRequirementScope = useMemo(
    () =>
      buildSpeechToRequirementScope({
        activeProjectId: activeProject?.id ?? missionContext?.projectId ?? null,
        activeRepositoryId: activeRepository?.id ?? null,
      }),
    [activeProject?.id, activeRepository?.id, missionContext?.projectId],
  );
  useSpeechToRequirementSync(speechPrefs.speechToRequirementEnabled, speechToRequirementScope, session);

  useLayoutEffect(() => {
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
    const ro = new ResizeObserver(() => {
      syncComposerTrayHeight();
    });
    ro.observe(tray);
    return () => {
      ro.disconnect();
    };
  }, [session.id]);

  useLayoutEffect(() => {
    const root = chatRootRef.current;
    if (!root) return;
    let rafId: number | null = null;

    function syncSessionOwnerAnchor() {
      const el = chatRootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--app-session-owner-anchor-left", `${r.left}px`);
      el.style.setProperty("--app-session-owner-anchor-width", `${r.width}px`);
    }
    function scheduleSyncSessionOwnerAnchor() {
      if (rafId != null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        syncSessionOwnerAnchor();
      });
    }

    syncSessionOwnerAnchor();
    const ro = new ResizeObserver(() => {
      scheduleSyncSessionOwnerAnchor();
    });
    ro.observe(root);
    window.addEventListener("resize", scheduleSyncSessionOwnerAnchor);
    window.addEventListener("scroll", scheduleSyncSessionOwnerAnchor, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", scheduleSyncSessionOwnerAnchor);
      window.removeEventListener("scroll", scheduleSyncSessionOwnerAnchor, true);
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [session.id, hideMessages, hideSessionTools]);

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
    if (hit.closest("[data-wise-composer-root]")) return;
    if (hit.closest(".monaco-editor, .milkdown")) return;
    if (document.activeElement === root) return;
    root.focus({ preventScroll: true });
  }, []);

  /** 占用中 Esc 仅停止（不撤 transcript）：composer 用 useLayoutEffect 抢先处理「撤回刚发」 */
  useEffect(() => {
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

  const { run: workflowRun } = useWorkflowRun(session.id, session.repositoryPath);
  const sessionRepository = useMemo(
    () =>
      activeRepository ??
      repositories.find(
        (repository) => sessionRepoPathKey(repository.path) === sessionRepoPathKey(session.repositoryPath),
      ) ?? null,
    [activeRepository, repositories, session.repositoryPath],
  );
  const repositoryScopePath = sessionRepository?.path?.trim() || session.repositoryPath.trim();
  const gitRepositoryPath = sessionRepository?.path?.trim() || session.repositoryPath.trim();
  const omcBatchUserAbortRef = useRef(false);
  const omcBatchInFlightRef = useRef(false);
  const [splitTodoTasks, setSplitTodoTasks] = useState<TaskItem[]>([]);
  const [trellisTasks, setTrellisTasks] = useState<TrellisRequirementTaskRow[]>([]);
  const [trellisTasksLoading, setTrellisTasksLoading] = useState(false);
  const [trellisTaskFocus, setTrellisTaskFocus] = useState<{
    parentTaskName: string | null;
    childTaskNames: string[];
  } | null>(null);
  /** 「可执行任务」角标：仅统计未完成（todo）条数 */
  const splitIncompleteTaskCount = useMemo(
    () => splitTodoTasks.filter((task) => task.flowStatus === "todo").length,
    [splitTodoTasks],
  );
  const visibleTrellisTasks = useMemo(
    () => {
      const runnable = trellisTasks.filter(isRunnableTrellisRequirementTask);
      if (!trellisTaskFocus) return runnable;
      const parent = trellisTaskFocus.parentTaskName?.trim() ?? "";
      const children = new Set(trellisTaskFocus.childTaskNames.map((name) => name.trim()).filter(Boolean));
      const focused = runnable.filter((task) => {
        const taskId = task.taskId.trim();
        const parentName = task.parent?.trim() ?? "";
        if (children.has(taskId)) return true;
        return parent.length > 0 && parentName === parent;
      });
      return focused.length > 0 ? focused : runnable;
    },
    [trellisTaskFocus, trellisTasks],
  );
  const taskDrawerCount = splitIncompleteTaskCount + visibleTrellisTasks.length;
  const showPendingTaskQueue = pendingTasks.length > 0;

  const syncSplitTaskList = useCallback(async () => {
    const split = await loadPrdTaskSplitResult();
    if (!split) {
      setSplitTodoTasks([]);
      return;
    }
    const listedTasks = split.executableTasks
      .map((task) => {
        const fs = normalizeSplitTaskListFlowStatus(task.flowStatus);
        if (fs === undefined) return { ...task, flowStatus: undefined };
        return { ...task, flowStatus: fs };
      })
      .filter((task) => task.flowStatus === "todo" || task.flowStatus === "done");
    setSplitTodoTasks(listedTasks);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      const split = await loadPrdTaskSplitResult();
      if (cancelled) return;
      if (!split) {
        setSplitTodoTasks([]);
        return;
      }
      const listedTasks = split.executableTasks
        .map((task) => {
          const fs = normalizeSplitTaskListFlowStatus(task.flowStatus);
          if (fs === undefined) return { ...task, flowStatus: undefined };
          return { ...task, flowStatus: fs };
        })
        .filter((task) => task.flowStatus === "todo" || task.flowStatus === "done");
      setSplitTodoTasks(listedTasks);
    };
    void sync();
    const handleSplitTodoCountUpdated = () => {
      void sync();
    };
    window.addEventListener(WORKFLOW_UI_EVENT_SPLIT_TODO_COUNT_UPDATED, handleSplitTodoCountUpdated as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener(WORKFLOW_UI_EVENT_SPLIT_TODO_COUNT_UPDATED, handleSplitTodoCountUpdated as EventListener);
    };
  }, [session.id, session.repositoryPath]);

  const syncTrellisTaskList = useCallback(async () => {
    const project = activeProject;
    const rootPath = project?.rootPath?.trim();
    if (!project || !rootPath) {
      setTrellisTasks([]);
      setTrellisTasksLoading(false);
      return;
    }
    setTrellisTasksLoading(true);
    try {
      const snapshot = await listProjectRequirementWorkspace({
        project,
        projects: [project],
        repositories,
      });
      setTrellisTasks(snapshot.tasks.filter((task) => task.sourceKind === "project"));
    } catch (err) {
      console.warn("syncTrellisTaskList failed:", err);
      setTrellisTasks([]);
    } finally {
      setTrellisTasksLoading(false);
    }
  }, [activeProject, repositories]);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      if (cancelled) return;
      await syncTrellisTaskList();
    };
    void sync();
    const handleSplitTodoCountUpdated = (event: Event) => {
      const detail = (event as CustomEvent<SplitTodoCountUpdatedDetail>).detail;
      void syncTrellisTaskList().then(() => {
        if (detail?.source === "trellis" && detail.openTaskDrawer) {
          setTrellisTaskFocus({
            parentTaskName: detail.focusParentTaskName ?? detail.parentTaskName ?? null,
            childTaskNames: detail.focusChildTaskNames ?? detail.childTaskNames ?? [],
          });
          setTaskListStatusFilter("all");
          setTaskListDrawerOpen(true);
        }
      });
    };
    window.addEventListener(WORKFLOW_UI_EVENT_SPLIT_TODO_COUNT_UPDATED, handleSplitTodoCountUpdated as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener(WORKFLOW_UI_EVENT_SPLIT_TODO_COUNT_UPDATED, handleSplitTodoCountUpdated as EventListener);
    };
  }, [syncTrellisTaskList]);

  useEffect(() => {
    const valid = new Set(splitTodoTasks.map((task) => task.id));
    setTaskListSelectedIds((prev) => prev.filter((id) => valid.has(id)));
  }, [splitTodoTasks]);

  const pendingTasksRef = useRef(pendingTasks);
  pendingTasksRef.current = pendingTasks;
  /** 待办出队串行：一次只派发一条；onExecute 同步返回后释放门闸，后续项由会话占用态与 findFirstDispatchableTask 门控 */
  const pendingQueueDispatchInFlightRef = useRef(false);

  const wasRunningRef = useRef(session.status === "running");
  const deferredSendNextRef = useRef(false);
  const [deferredSendQueued, setDeferredSendQueued] = useState(false);

  const dispatchPendingTask = useCallback(
    (task: PendingExecutionTask) => {
      if (pendingQueueDispatchInFlightRef.current) {
        return;
      }
      pendingQueueDispatchInFlightRef.current = true;
      const { id, promptText, targetType, targetEmployeeName, targetWorkflowId, targetWorkflowName, executorLabel } = task;
      logWorkflowTrace("queue.dispatch.consume", {
        sessionId: session.id,
        taskId: id,
        targetType: targetType ?? "main",
        targetEmployeeName: targetEmployeeName ?? "",
        targetWorkflowId: targetWorkflowId ?? "",
        targetWorkflowName: targetWorkflowName ?? "",
      });
      void (async () => {
        try {
          const started = await Promise.resolve(
            onExecute(session.id, promptText, { targetType, targetEmployeeName, targetWorkflowId, targetWorkflowName }),
          );
          if (started === false) {
            // 并发门闸：`executeSession` 内已 `onClaudeSpawnBlocked`，此处不再重复 toast
            return;
          }
          removeTask(id);
        } catch (error) {
          console.error("Failed to dispatch pending task, requeueing:", error);
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
          pendingQueueDispatchInFlightRef.current = false;
        }
      })();
    },
    [addTask, onExecute, removeTask, session.id],
  );

  const wasClaudeCodeSessionActiveRef = useRef(
    session.status === "running" || session.status === "connecting",
  );
  const idlePendingDispatchHoldUntilRef = useRef(0);
  const idlePendingDispatchTimerRef = useRef<number | null>(null);

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
          dispatchPendingTask(queued);
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
      onExecute(sessionId, prompt, undefined, executeOptions);
    },
    [dispatchPendingTask, onExecute, removeTask],
  );

  const isMainIdle = session.status !== "running" && session.status !== "connecting";

  const directOmcInvocationsForIdle = useSyncExternalStore(
    subscribeOmcDirectBatchInvocations,
    getOmcDirectBatchInvocationsSnapshot,
    getOmcDirectBatchInvocationsSnapshot,
  );
  const omcMonitorPipelineBusy =
    omcBatchPipelineActive || directOmcInvocationsForIdle.some(isOmcDirectBatchInvocationRunning);

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
    [isMainIdle, isEmployeeIdle, isTeamIdle],
  );

  const findFirstDispatchableTask = useCallback(
    (tasks: PendingExecutionTask[]): { task: PendingExecutionTask; index: number } | null => {
      for (let i = 0; i < tasks.length; i += 1) {
        const task = tasks[i];
        if (canDispatchHead(task)) {
          return { task, index: i };
        }
      }
      return null;
    },
    [canDispatchHead],
  );

  /** 须在 findFirstDispatchableTask 之后定义：延迟窗口内可重算队首，避免 latch 吞调度或闭包仍指向已删任务 */
  const scheduleIdleAwarePendingDispatch = useCallback(
    (task: PendingExecutionTask) => {
      const holdUntil = idlePendingDispatchHoldUntilRef.current;
      const delay = Math.max(0, holdUntil - Date.now());
      if (delay <= 0) {
        clearIdlePendingDispatchTimer();
        dispatchPendingTask(task);
        return;
      }
      // 始终用最新入参替换尚未触发的定时器，避免旧闭包仍指向已删项或吞掉重调度
      clearIdlePendingDispatchTimer();
      const scheduledId = task.id;
      idlePendingDispatchTimerRef.current = window.setTimeout(() => {
        idlePendingDispatchTimerRef.current = null;
        if (pendingQueueDispatchInFlightRef.current) {
          return;
        }
        const next = findFirstDispatchableTask(pendingTasksRef.current);
        if (!next) return;
        if (next.task.id !== scheduledId) {
          queueMicrotask(() => {
            scheduleIdleAwarePendingDispatch(next.task);
          });
          return;
        }
        dispatchPendingTask(next.task);
      }, delay);
    },
    [clearIdlePendingDispatchTimer, dispatchPendingTask, findFirstDispatchableTask],
  );

  const getPendingTaskDispatchState = useCallback(
    (task: PendingExecutionTask): { label: string; tone: "ready" | "waiting" } => {
      const targetType = task.targetType ?? "main";
      if (targetType === "main" && !isMainIdle) {
        return { label: "等待主会话空闲", tone: "waiting" };
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
      return { label: "主会话可执行", tone: "ready" };
    },
    [isMainIdle, isEmployeeIdle, isTeamIdle, workflowGraphStatusByWorkflowId],
  );

  const handleSendNextFromQueue = useCallback(() => {
    const first = pendingTasks[0];
    if (!first) {
      message.warning("队列为空");
      return;
    }
    const targetType = first.targetType ?? "main";
    if (session.status === "running" && targetType === "main") {
      deferredSendNextRef.current = true;
      setDeferredSendQueued(true);
      void writeDeferredSendNext(session.id, session.repositoryPath, true);
      message.info("当前有任务在执行，队首将在本轮结束后自动发送。");
      return;
    }
    if (targetType === "team") {
      const workflowId = first.targetWorkflowId?.trim();
      const status = workflowId ? (workflowGraphStatusByWorkflowId[workflowId] ?? "").toLowerCase() : "";
      if (status !== "published") {
        const teamName = first.targetWorkflowName?.trim() || first.executorLabel;
        logWorkflowTrace("queue.dispatch.blocked_unpublished", {
          sessionId: session.id,
          queueTaskId: first.id,
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
    const dispatchable = findFirstDispatchableTask(pendingTasks);
    if (!dispatchable) {
      const dispatchState = getPendingTaskDispatchState(first);
      message.info(dispatchState.label);
      return;
    }
    if (dispatchable.index > 0) {
      message.info(`队首暂不可执行，已调度第 ${dispatchable.index + 1} 项任务。`);
    }
    dispatchPendingTask(dispatchable.task);
  }, [
    session.status,
    session.repositoryPath,
    pendingTasks,
    findFirstDispatchableTask,
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
    const running = session.status === "running";
    const prevWasRunning = wasRunningRef.current;
    wasRunningRef.current = running;
    if (!prevWasRunning || running) return;

    if (!deferredSendNextRef.current) return;
    deferredSendNextRef.current = false;
    setDeferredSendQueued(false);
    void writeDeferredSendNext(session.id, session.repositoryPath, false);

    if (session.status === "error" || session.status === "cancelled") {
      message.warning(
        session.status === "cancelled" ? "执行已取消，未自动发送队首任务。" : "执行出错，未自动发送队首任务。",
      );
      return;
    }

    const dispatchable = findFirstDispatchableTask(pendingTasksRef.current);
    if (!dispatchable) return;
    scheduleIdleAwarePendingDispatch(dispatchable.task);
  }, [
    session.status,
    session.id,
    session.repositoryPath,
    scheduleIdleAwarePendingDispatch,
    findFirstDispatchableTask,
  ]);

  useEffect(() => {
    if (pendingTasks.length === 0 && deferredSendQueued) {
      deferredSendNextRef.current = false;
      setDeferredSendQueued(false);
      void writeDeferredSendNext(session.id, session.repositoryPath, false);
    }
  }, [pendingTasks.length, deferredSendQueued, session.id, session.repositoryPath]);

  useEffect(() => {
    if (pendingQueueDispatchInFlightRef.current) return;
    if (deferredSendNextRef.current) return;
    const dispatchable = findFirstDispatchableTask(pendingTasks);
    if (!dispatchable) return;
    scheduleIdleAwarePendingDispatch(dispatchable.task);
  }, [pendingTasks, findFirstDispatchableTask, session.id, scheduleIdleAwarePendingDispatch]);

  useEffect(() => {
    const sid = session.id;
    const rp = session.repositoryPath;
    let cancelled = false;
    void (async () => {
      let stored = await readDeferredSendNext(sid, rp);
      if (stored && pendingTasks.length === 0) {
        await writeDeferredSendNext(sid, rp, false);
        stored = false;
      }
      if (cancelled) return;
      deferredSendNextRef.current = stored;
      setDeferredSendQueued(stored);
      wasRunningRef.current = session.status === "running";

      if (
        stored &&
        pendingTasks.length > 0 &&
        session.status !== "running" &&
        session.status !== "connecting"
      ) {
        if (session.status === "error" || session.status === "cancelled") {
          await writeDeferredSendNext(sid, rp, false);
          if (cancelled) return;
          deferredSendNextRef.current = false;
          setDeferredSendQueued(false);
          message.warning("检测到上次「本轮结束后发送」预约，但会话未成功结束，已取消自动发送。");
          return;
        }
        const dispatchable = findFirstDispatchableTask(pendingTasks);
        if (dispatchable) {
          await writeDeferredSendNext(sid, rp, false);
          if (cancelled) return;
          deferredSendNextRef.current = false;
          setDeferredSendQueued(false);
          queueMicrotask(() => scheduleIdleAwarePendingDispatch(dispatchable.task));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    session.id,
    session.repositoryPath,
    session.status,
    pendingTasks,
    scheduleIdleAwarePendingDispatch,
    findFirstDispatchableTask,
  ]);

  // Auto-scroll messages：默认贴底跟随；用户手动滚动后暂停，失焦仅重新武装跟随，有新内容再贴底
  /** 流式贴底：每帧最多移动的像素（越大越跟手，越小越丝滑） */
  const SCROLL_FOLLOW_MAX_STEP_PX = 96;

  /** 消息列表滚动容器：用 scrollTop 贴底，避免 scrollIntoView 触发布局与祖先滚动链，减轻手动滚动时卡顿 */
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  /** 是否允许自动贴底（用户手动翻历史并仍聚焦消息区时为 false） */
  const pinToBottomRef = useRef(true);
  /** 记录上一次的 scrollTop，用于判断用户滚动方向 */
  const lastScrollTopRef = useRef(0);
  /** 程序触发的滚动，避免 scroll 监听误判为用户操作 */
  const programmaticScrollRef = useRef(false);
  /** 用户手动滚动后暂停跟随，直至消息历史区失焦 */
  const userPausedFollowRef = useRef(false);
  /** 失焦后已允许跟随，但等到消息指纹变化（新增/流式增高）再滚动 */
  const awaitNewMessageBeforeFollowRef = useRef(false);
  const followFingerprintAtBlurRef = useRef("");
  /** 流式贴底跟随循环 */
  const scrollFollowLoopRafRef = useRef<number | null>(null);
  const sessionStatusRef = useRef(session.status);
  sessionStatusRef.current = session.status;
  const lastUserMessagePinIdRef = useRef<number | null>(null);

  const buildMessagesFollowFingerprint = useCallback((messages: ClaudeSession["messages"]) => {
    if (messages.length === 0) return "empty";
    const last = messages[messages.length - 1]!;
    const partsTextLen =
      last.parts?.reduce((sum, part) => {
        if (part.type === "text") return sum + part.text.length;
        if (part.type === "reasoning") return sum + part.text.length;
        return sum;
      }, 0) ?? 0;
    return `${messages.length}:${last.id}:${last.content.length}:${partsTextLen}`;
  }, []);

  const shouldAutoFollow = useCallback(() => {
    if (hideMessages) return false;
    return pinToBottomRef.current;
  }, [hideMessages]);

  const canScrollForNewContent = useCallback(() => {
    if (!awaitNewMessageBeforeFollowRef.current) return true;
    const fp = buildMessagesFollowFingerprint(session.messages);
    if (fp === followFingerprintAtBlurRef.current) return false;
    awaitNewMessageBeforeFollowRef.current = false;
    return true;
  }, [session.messages, buildMessagesFollowFingerprint]);

  const isSessionStreaming = useCallback(() => {
    const status = sessionStatusRef.current;
    return status === "running" || status === "connecting";
  }, []);

  const getMessagesScrollTarget = useCallback((sc: HTMLDivElement) => {
    return Math.max(0, sc.scrollHeight - sc.clientHeight);
  }, []);

  const applyScrollTowardBottom = useCallback(
    (sc: HTMLDivElement, opts?: { smooth?: boolean }) => {
      const target = getMessagesScrollTarget(sc);
      const current = sc.scrollTop;
      const gap = target - current;
      if (gap <= 0.5) return;

      programmaticScrollRef.current = true;
      if (!opts?.smooth || gap <= SCROLL_FOLLOW_MAX_STEP_PX) {
        sc.scrollTop = target;
      } else {
        sc.scrollTop = current + Math.min(gap, SCROLL_FOLLOW_MAX_STEP_PX);
      }
      lastScrollTopRef.current = sc.scrollTop;
      // 延后清除，避免 follow 循环写入 scrollTop 触发的 scroll 被误判为用户操作
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          programmaticScrollRef.current = false;
        });
      });
    },
    [getMessagesScrollTarget],
  );

  const snapScrollToBottom = useCallback(() => {
    const sc = messagesScrollRef.current;
    if (!sc) return;
    applyScrollTowardBottom(sc);
  }, [applyScrollTowardBottom]);

  const cancelScrollFollowLoop = useCallback(() => {
    if (scrollFollowLoopRafRef.current != null) {
      window.cancelAnimationFrame(scrollFollowLoopRafRef.current);
      scrollFollowLoopRafRef.current = null;
    }
  }, []);

  const tickScrollFollowLoopRef = useRef<() => void>(() => undefined);

  const ensureScrollFollowLoop = useCallback(() => {
    if (!shouldAutoFollow() || !isSessionStreaming()) return;
    if (scrollFollowLoopRafRef.current != null) return;
    scrollFollowLoopRafRef.current = window.requestAnimationFrame(() => tickScrollFollowLoopRef.current());
  }, [shouldAutoFollow, isSessionStreaming]);

  const armAutoFollowOnMessagesBlur = useCallback(() => {
    if (!userPausedFollowRef.current) return;
    userPausedFollowRef.current = false;
    pinToBottomRef.current = true;
    awaitNewMessageBeforeFollowRef.current = true;
    followFingerprintAtBlurRef.current = buildMessagesFollowFingerprint(session.messages);
    // 失焦不立刻滚动；等 session.messages 有新增/流式更新后再 scheduleScrollToBottom
  }, [buildMessagesFollowFingerprint, session.messages]);

  const pauseAutoFollowForUserScroll = useCallback(() => {
    if (userPausedFollowRef.current) return;
    userPausedFollowRef.current = true;
    pinToBottomRef.current = false;
    awaitNewMessageBeforeFollowRef.current = false;
    cancelScrollFollowLoop();
  }, [cancelScrollFollowLoop]);

  const handleMessagesBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const sc = messagesScrollRef.current;
      if (!sc) return;
      const next = event.relatedTarget;
      if (next instanceof Node && sc.contains(next)) return;
      armAutoFollowOnMessagesBlur();
    },
    [armAutoFollowOnMessagesBlur],
  );

  const tickScrollFollowLoop = useCallback(() => {
    scrollFollowLoopRafRef.current = null;
    if (!shouldAutoFollow()) return;
    if (!canScrollForNewContent()) return;

    const sc = messagesScrollRef.current;
    if (!sc) return;

    const streaming = isSessionStreaming();
    applyScrollTowardBottom(sc, { smooth: streaming });

    if (streaming && shouldAutoFollow()) {
      scrollFollowLoopRafRef.current = window.requestAnimationFrame(() => tickScrollFollowLoopRef.current());
    }
  }, [shouldAutoFollow, canScrollForNewContent, isSessionStreaming, applyScrollTowardBottom]);

  tickScrollFollowLoopRef.current = tickScrollFollowLoop;

  const scheduleScrollToBottom = useCallback(() => {
    if (!shouldAutoFollow()) return;
    if (!canScrollForNewContent()) return;
    const sc = messagesScrollRef.current;
    if (!sc) return;

    applyScrollTowardBottom(sc, { smooth: isSessionStreaming() });

    if (isSessionStreaming()) {
      ensureScrollFollowLoop();
      return;
    }

    // 非流式：Markdown 在子组件 rAF 中增高，下一帧再贴一次
    window.requestAnimationFrame(() => {
      if (!shouldAutoFollow()) return;
      if (!canScrollForNewContent()) return;
      const scNow = messagesScrollRef.current;
      if (!scNow) return;
      applyScrollTowardBottom(scNow);
    });
  }, [
    shouldAutoFollow,
    canScrollForNewContent,
    isSessionStreaming,
    applyScrollTowardBottom,
    ensureScrollFollowLoop,
  ]);

  const [fullTranscriptLoading, setFullTranscriptLoading] = useState(false);

  const scrollMessageTargetIntoView = useCallback((target: Element | null, behavior: ScrollBehavior = "smooth") => {
    const sc = messagesScrollRef.current;
    if (!sc || !(target instanceof HTMLElement) || !sc.contains(target)) {
      return false;
    }
    const scRect = sc.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const targetTop =
      sc.scrollTop + targetRect.top - scRect.top - Math.max(0, (sc.clientHeight - targetRect.height) / 2);
    const maxTop = Math.max(0, sc.scrollHeight - sc.clientHeight);
    const nextTop = Math.max(0, Math.min(maxTop, targetTop));
    userPausedFollowRef.current = true;
    pinToBottomRef.current = false;
    awaitNewMessageBeforeFollowRef.current = false;
    cancelScrollFollowLoop();
    sc.scrollTo({ top: nextTop, behavior });
    lastScrollTopRef.current = nextTop;
    return true;
  }, [cancelScrollFollowLoop]);

  const tailMessageForThinkingHint = useMemo(
    () => (session.messages.length > 0 ? session.messages[session.messages.length - 1]! : null),
    [session.messages],
  );
  const showListEndThinkingHint = useMemo(
    () =>
      session.status === "running" &&
      tailMessageForThinkingHint !== null &&
      (tailMessageForThinkingHint.role === "user" || tailMessageForThinkingHint.role === "assistant"),
    [session.status, tailMessageForThinkingHint],
  );

  useEffect(() => {
    cancelScrollFollowLoop();
    pinToBottomRef.current = true;
    userPausedFollowRef.current = false;
    awaitNewMessageBeforeFollowRef.current = false;
    followFingerprintAtBlurRef.current = "";
    lastUserMessagePinIdRef.current = null;
  }, [session.id, cancelScrollFollowLoop]);

  /** 用户新发出一条 user 消息时恢复贴底，便于立刻看到自己发送的内容 */
  useEffect(() => {
    if (session.messages.length === 0) return;
    const last = session.messages[session.messages.length - 1]!;
    if (last.role !== "user") return;
    if (lastUserMessagePinIdRef.current === last.id) return;
    lastUserMessagePinIdRef.current = last.id;
    pinToBottomRef.current = true;
    userPausedFollowRef.current = false;
    awaitNewMessageBeforeFollowRef.current = false;
    cancelScrollFollowLoop();
    snapScrollToBottom();
    ensureScrollFollowLoop();
  }, [session.messages, cancelScrollFollowLoop, snapScrollToBottom, ensureScrollFollowLoop]);

  useLayoutEffect(() => {
    if (hideMessages) return;
    const sc = messagesScrollRef.current;
    if (!sc) return;
    let pinRaf = 0;

    // 初始化：记录当前 scrollTop
    lastScrollTopRef.current = sc.scrollTop;

    const composerEditorHasFocus = () => {
      const ae = document.activeElement;
      return ae instanceof Element && ae.closest("[data-wise-composer-root] .ProseMirror") != null;
    };

    const onWheel = (event: WheelEvent) => {
      if (programmaticScrollRef.current) return;
      if (Math.abs(event.deltaY) <= 2) return;
      if (composerEditorHasFocus()) return;
      sc.focus({ preventScroll: true });
      pauseAutoFollowForUserScroll();
    };

    const onScroll = () => {
      if (programmaticScrollRef.current) return;
      if (pinRaf !== 0) return;
      pinRaf = window.requestAnimationFrame(() => {
        pinRaf = 0;
        if (programmaticScrollRef.current) return;
        const currentScrollTop = sc.scrollTop;
        const prevScrollTop = lastScrollTopRef.current;
        if (Math.abs(currentScrollTop - prevScrollTop) > 1) {
          if (!composerEditorHasFocus()) {
            sc.focus({ preventScroll: true });
          }
          pauseAutoFollowForUserScroll();
        }
        lastScrollTopRef.current = currentScrollTop;
      });
    };
    sc.addEventListener("wheel", onWheel, { passive: true, capture: true });
    sc.addEventListener("scroll", onScroll, { passive: true });
    // 初始时默认贴底
    pinToBottomRef.current = true;
    return () => {
      sc.removeEventListener("wheel", onWheel, { capture: true });
      sc.removeEventListener("scroll", onScroll);
      if (pinRaf !== 0) window.cancelAnimationFrame(pinRaf);
    };
  }, [session.id, hideMessages, getMessagesScrollTarget, pauseAutoFollowForUserScroll]);

  /** 消息/状态更新时贴底；流式时启动持续跟随循环 */
  useLayoutEffect(() => {
    if (hideMessages) return;
    scheduleScrollToBottom();
  }, [session.messages, session.status, hideMessages, scheduleScrollToBottom]);

  /** session.status 进入/离开流式时启停跟随循环 */
  useEffect(() => {
    if (hideMessages) return;
    if (shouldAutoFollow() && isSessionStreaming()) {
      ensureScrollFollowLoop();
      return;
    }
    cancelScrollFollowLoop();
  }, [
    session.status,
    hideMessages,
    shouldAutoFollow,
    isSessionStreaming,
    ensureScrollFollowLoop,
    cancelScrollFollowLoop,
  ]);

  /** 尾部内容增高（Markdown/代码块）时贴底 */
  useLayoutEffect(() => {
    if (hideMessages) return;
    const sc = messagesScrollRef.current;
    if (!sc) return;

    const ro = new ResizeObserver(() => {
      scheduleScrollToBottom();
    });

    const observeChildren = () => {
      ro.disconnect();
      for (const child of sc.children) {
        ro.observe(child);
      }
    };
    observeChildren();

    const mo = new MutationObserver(() => {
      observeChildren();
      if (shouldAutoFollow()) scheduleScrollToBottom();
    });
    mo.observe(sc, { childList: true });

    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [session.id, hideMessages, scheduleScrollToBottom]);

  useEffect(() => () => cancelScrollFollowLoop(), [cancelScrollFollowLoop]);
  const [stats, setStats] = useState({ additions: 0, deletions: 0 });

  useEffect(() => {
    let cancelled = false;
    const VISIBLE_POLL_INTERVAL_MS = 5000;
    const HIDDEN_POLL_INTERVAL_MS = 15000;

    async function refreshStats() {
      try {
        if (!gitRepositoryPath) throw new Error("missing_git_repository_path");
        const status = await gitStatus(gitRepositoryPath);
        if (cancelled) return;
        setStats({
          additions: Math.max(0, status.additions || 0),
          deletions: Math.max(0, status.deletions || 0),
        });
      } catch {
        if (cancelled) return;
        setStats({ additions: 0, deletions: 0 });
      }
    }

    const tick = () => {
      if (document.visibilityState === "visible") {
        void refreshStats();
      }
    };

    void refreshStats();
    const timer = window.setInterval(() => {
      tick();
    }, document.visibilityState === "visible" ? VISIBLE_POLL_INTERVAL_MS : HIDDEN_POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshStats();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [gitRepositoryPath]);

  const [taskListDrawerOpen, setTaskListDrawerOpen] = useState(false);
  const [taskListSelectedIds, setTaskListSelectedIds] = useState<string[]>([]);
  const [trellisTaskSelectedKeys, setTrellisTaskSelectedKeys] = useState<string[]>([]);
  const [trellisTaskEmployeeByKey, setTrellisTaskEmployeeByKey] = useState<Record<string, string>>({});
  const [trellisBatchEmployeeName, setTrellisBatchEmployeeName] = useState("");
  const [taskListStatusFilter, setTaskListStatusFilter] = useState<"all" | "todo" | "done">("todo");
  const [omcBatchPopoverOpen, setOmcBatchPopoverOpen] = useState(false);
  const [omcBatchTemplateId, setOmcBatchTemplateId] = useState<OmcBatchTemplateId>("autopilot");
  const [historyPopoverOpen, setHistoryPopoverOpen] = useState(false);
  const [userQuestionsPopoverOpen, setUserQuestionsPopoverOpen] = useState(false);
  const [historySearchText, setHistorySearchText] = useState("");
  const [historyVisibleCount, setHistoryVisibleCount] = useState(FEATURE_SESSION_LIST_PAGE_SIZE);
  const [historySessionsRefreshing, setHistorySessionsRefreshing] = useState(false);
  const historyPopoverScrollRef = useRef<HTMLDivElement>(null);
  /** 历史会话删除二次确认 Modal 打开期间，忽略 Popover 的外部点击关闭 */
  const historyPopoverCloseGuardRef = useRef(false);
  const [sessionTraceDrawerOpen, setSessionTraceDrawerOpen] = useState(false);
  const [sessionSendTraces, setSessionSendTraces] = useState<SessionSendTraceEntry[]>([]);
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
  const [reviewGitStatsPulse, setReviewGitStatsPulse] = useState(false);
  const [pushPopoverOpen, setPushPopoverOpen] = useState(false);
  const [pushSummaryDraft, setPushSummaryDraft] = useState("");
  const [pushSummaryLoading, setPushSummaryLoading] = useState(false);
  const [pushSummaryPhase, setPushSummaryPhase] = useState<string>("");
  const [pushSubmitting, setPushSubmitting] = useState(false);
  const [gitWorktreePopoverOpen, setGitWorktreePopoverOpen] = useState(false);
  const [workTrajectoryDrawerOpen, setWorkTrajectoryDrawerOpen] = useState(false);
  const [linkedWorktrees, setLinkedWorktrees] = useState<GitWorktreeEntry[]>([]);
  const [gitWorktreeLoading, setGitWorktreeLoading] = useState(false);
  const [gitWorktreeRemovingPath, setGitWorktreeRemovingPath] = useState<string | null>(null);
  const [gitWorktreeAddingToProjectPath, setGitWorktreeAddingToProjectPath] = useState<string | null>(null);
  const prevSessionUnreadCountRef = useRef(0);
  const prevGitStatsForPulseRef = useRef({ additions: 0, deletions: 0 });
  const [returnMainSessionId, setReturnMainSessionId] = useState<string | null>(null);
  const [sessionOwnerHints, setSessionOwnerHints] = useState<Record<string, SessionOwnerHint>>(() => loadSessionOwnerHints());
  const sessionForNotificationPanelRef = useRef(session);
  sessionForNotificationPanelRef.current = session;
  const sessionsForNotificationMatchRef = useRef(sessions);
  sessionsForNotificationMatchRef.current = sessions;

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

  const sessionUserQuestionsForPopover = useMemo(() => {
    const rows: { id: number; text: string; timestamp: number }[] = [];
    for (const m of session.messages) {
      if (m.role !== "user" || isToolOnlyUserMessage(m)) continue;
      const text = userMessagePlainTextForDisplay(m).trim();
      if (!text) continue;
      rows.push({ id: m.id, text, timestamp: m.timestamp });
    }
    rows.sort((a, b) => b.timestamp - a.timestamp);
    return rows;
  }, [session.messages]);

  const scrollToSessionMessageId = useCallback((messageId: number) => {
    window.setTimeout(() => {
      const row = document.querySelector(`[data-message-id="${CSS.escape(String(messageId))}"]`);
      scrollMessageTargetIntoView(row);
    }, 50);
  }, [scrollMessageTargetIntoView]);

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
      .filter((item) => item.id !== session.id && item.repositoryPath === session.repositoryPath)
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

  const [taskCompletionModalOpen, setTaskCompletionModalOpen] = useState(false);
  const [scheduledTasksModalOpen, setScheduledTasksModalOpen] = useState(false);
  const [completionSearchText, setCompletionSearchText] = useState("");
  const [completionOwnerFilter, setCompletionOwnerFilter] = useState<TaskCompletionOwnerFilter>("all");
  const [completionStatusFilter, setCompletionStatusFilter] = useState<TaskCompletionStatusFilter>("all");
  const [completionVisibleCount, setCompletionVisibleCount] = useState(FEATURE_SESSION_LIST_PAGE_SIZE);
  const completionTableWrapRef = useRef<HTMLDivElement>(null);
  const completionFilteredLengthRef = useRef(0);

  const repositorySessionExecutionRows = useMemo((): RepositorySessionExecutionRow[] => {
    const path = session.repositoryPath;
    const sameRepo = sessions.filter((s) => s.repositoryPath === path);
    const rows: RepositorySessionExecutionRow[] = sameRepo.map((s) => {
      const owner = resolveSessionOwnerInfo({
        session: s,
        workflowTasks,
        workflowTemplates,
        taskPendingEmployeesByTaskId,
        ownerHint: resolveOwnerHintForSession(sessionOwnerHints, s),
      });
      const scopeLabel = owner.name ? `${owner.typeLabel} · ${owner.name}` : owner.typeLabel;
      return {
        key: s.id,
        sessionId: s.id,
        ownerType: owner.type,
        scopeLabel,
        preview: getSessionPreview(s),
        status: s.status,
        statusLabel: mapClaudeExecutionStatusLabel(s.status),
        claudeSessionId: s.claudeSessionId?.trim() || "—",
        messageCount: s.messages.length,
        updatedAt: getSessionUpdatedAt(s),
      };
    });
    const ownerRank = (t: RepositorySessionExecutionRow["ownerType"]) => (t === "main" ? 0 : t === "employee" ? 1 : 2);
    rows.sort((a, b) => {
      const r = ownerRank(a.ownerType) - ownerRank(b.ownerType);
      if (r !== 0) return r;
      return b.updatedAt - a.updatedAt;
    });
    return rows;
  }, [
    sessions,
    session.repositoryPath,
    workflowTasks,
    workflowTemplates,
    taskPendingEmployeesByTaskId,
    sessionOwnerHints,
  ]);

  const taskCompletionTableColumns: ColumnsType<RepositorySessionExecutionRow> = useMemo(
    () => [
      {
        title: "范围",
        dataIndex: "scopeLabel",
        width: "12%",
        ellipsis: true,
      },
      {
        title: "摘要",
        dataIndex: "preview",
        width: "26%",
        ellipsis: { showTitle: false },
        render: (preview: string) => {
          const text = preview?.trim() ? preview : "—";
          const tip = text === "—" ? undefined : text;
          return (
            <Tooltip title={tip} placement="topLeft" mouseEnterDelay={0.35}>
              <span className="app-task-completion-modal__ellipsis-cell">{text}</span>
            </Tooltip>
          );
        },
      },
      {
        title: "状态",
        dataIndex: "status",
        width: "8%",
        ellipsis: true,
        render: (_: ClaudeSession["status"], record) => (
          <Tag color={executionStatusTagColor(record.status)} className="app-task-completion-modal__tag-compact">
            {record.statusLabel}
          </Tag>
        ),
      },
      {
        title: "会话 ID",
        dataIndex: "sessionId",
        width: "24%",
        ellipsis: { showTitle: false },
        render: (id: string) => (
          <Tooltip title={id} placement="topLeft" mouseEnterDelay={0.35}>
            <span className="app-task-completion-modal__ellipsis-cell app-task-completion-modal__mono">{id}</span>
          </Tooltip>
        ),
      },
      {
        title: "条",
        dataIndex: "messageCount",
        width: "6%",
        align: "right",
      },
      {
        title: "活动时间",
        dataIndex: "updatedAt",
        width: "16%",
        ellipsis: true,
        render: (t: number) => formatCompletionActivityTime(t),
      },
      {
        title: "操作",
        key: "actions",
        width: "8%",
        align: "center",
        render: (_: unknown, record) => (
          <Button
            type="link"
            size="small"
            className="app-task-completion-modal__enter-btn"
            disabled={!onSwitchSession}
            onClick={() => {
              onSwitchSession?.(record.sessionId);
              setTaskCompletionModalOpen(false);
            }}
          >
            进入
          </Button>
        ),
      },
    ],
    [onSwitchSession, setTaskCompletionModalOpen],
  );

  const completionFilteredRows = useMemo(() => {
    return repositorySessionExecutionRows.filter((row) => {
      if (completionOwnerFilter !== "all" && row.ownerType !== completionOwnerFilter) {
        return false;
      }
      if (completionStatusFilter !== "all" && row.status !== completionStatusFilter) {
        return false;
      }
      if (!rowMatchesCompletionSearch(row, completionSearchText)) {
        return false;
      }
      return true;
    });
  }, [
    repositorySessionExecutionRows,
    completionOwnerFilter,
    completionStatusFilter,
    completionSearchText,
  ]);

  completionFilteredLengthRef.current = completionFilteredRows.length;

  const completionDisplayedRows = useMemo(
    () => completionFilteredRows.slice(0, completionVisibleCount),
    [completionFilteredRows, completionVisibleCount],
  );

  const completionHasMore = completionVisibleCount < completionFilteredRows.length;

  useEffect(() => {
    if (!taskCompletionModalOpen) return;
    setCompletionSearchText("");
    setCompletionOwnerFilter("all");
    setCompletionStatusFilter("all");
    setCompletionVisibleCount(FEATURE_SESSION_LIST_PAGE_SIZE);
  }, [taskCompletionModalOpen]);

  useEffect(() => {
    setCompletionVisibleCount(FEATURE_SESSION_LIST_PAGE_SIZE);
  }, [completionSearchText, completionOwnerFilter, completionStatusFilter]);

  useEffect(() => {
    if (!taskCompletionModalOpen) return;
    let bodyEl: HTMLDivElement | null = null;
    const handler = () => {
      if (!bodyEl) return;
      const max = completionFilteredLengthRef.current;
      if (bodyEl.scrollTop + bodyEl.clientHeight >= bodyEl.scrollHeight - 48) {
        setCompletionVisibleCount((n) => Math.min(n + FEATURE_SESSION_LIST_PAGE_SIZE, max));
      }
    };
    const timer = window.setTimeout(() => {
      bodyEl = completionTableWrapRef.current?.querySelector<HTMLDivElement>(".ant-table-body") ?? null;
      bodyEl?.addEventListener("scroll", handler);
    }, 50);
    return () => {
      window.clearTimeout(timer);
      bodyEl?.removeEventListener("scroll", handler);
    };
  }, [taskCompletionModalOpen, completionDisplayedRows.length, completionFilteredRows.length]);

  /** 当前仓库范围内未读通知（含员工/团队子会话），用于会话内消息通知面板列表与显隐 */
  const sessionUnreadNotificationRows = useMemo(
    () => notificationRows.filter((row) => notificationRowInSessionInboxScope(row, session, sessions)),
    [notificationRows, session, sessions],
  );

  const sessionUnreadCount = sessionUnreadNotificationRows.length;

  useEffect(() => {
    sessionNotificationSeenIdsRef.current.clear();
    setNotificationBubbleEnterIds(new Set());
    prevSessionUnreadCountRef.current = 0;
    setNotificationBadgePulse(false);
    setNotificationTitleCountPulse(false);
    prevGitStatsForPulseRef.current = { additions: 0, deletions: 0 };
    setReviewGitStatsPulse(false);
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

  useEffect(() => {
    const prev = prevGitStatsForPulseRef.current;
    const additionsIncreased = stats.additions > prev.additions && prev.additions > 0;
    const deletionsIncreased = stats.deletions > prev.deletions && prev.deletions > 0;
    prevGitStatsForPulseRef.current = { additions: stats.additions, deletions: stats.deletions };
    if (!additionsIncreased && !deletionsIncreased) {
      return;
    }
    setReviewGitStatsPulse(true);
    const t = window.setTimeout(() => setReviewGitStatsPulse(false), 480);
    return () => window.clearTimeout(t);
  }, [stats.additions, stats.deletions]);

  const loadPushSummaryDraft = useCallback(async () => {
    if (!gitRepositoryPath) return;
    setPushSummaryLoading(true);
    setPushSummaryPhase("读取 Git 变更中...");
    try {
      const status = await gitStatus(gitRepositoryPath);
      const fallback = buildAiCommitSummary(status);
      const changedFiles = [...status.staged, ...status.unstaged]
        .map((item) => `- ${item.path} (${item.status}, +${item.additions}, -${item.deletions})`)
        .join("\n");
      setPushSummaryPhase("调用 Claude Code 生成总结...");
      const prompt = [
        "你是资深工程师，请基于以下 git 改动生成一段简洁的中文提交总结草稿。",
        "要求：",
        "1) 2-4 行；",
        "2) 第一行说明本次改动目标；",
        "3) 后续行按要点概述影响范围；",
        "4) 不要使用 markdown 标题，不要输出解释。",
        "",
        `仓库路径: ${gitRepositoryPath}`,
        `分支: ${status.branch ?? "(unknown)"}`,
        `总计: +${Math.max(0, status.additions || 0)} / -${Math.max(0, status.deletions || 0)}`,
        `暂存文件数: ${status.staged.length}, 未暂存文件数: ${status.unstaged.length}`,
        "文件清单：",
        changedFiles || "- 无",
        "",
        "请仅输出最终提交总结正文。",
      ].join("\n");
      const configuredModel = await getClaudeConfigModel(gitRepositoryPath);
      const result = await executeClaudeCodeAndWait({
        repositoryPath: gitRepositoryPath,
        prompt,
        model: configuredModel ?? undefined,
        timeoutMs: 45_000,
        connectionMode: "oneshot",
      });
      setPushSummaryPhase("整理生成结果...");
      if (!result.success) {
        setPushSummaryDraft(fallback);
        return;
      }
      const cleaned = extractClaudeInvocationFinalText(result.outputLines);
      setPushSummaryDraft(cleaned || fallback);
    } catch {
      setPushSummaryPhase("生成失败，使用默认模板...");
      const status = await gitStatus(gitRepositoryPath).catch(() => null);
      setPushSummaryDraft(status ? buildAiCommitSummary(status) : "");
    } finally {
      setPushSummaryLoading(false);
      setPushSummaryPhase("");
    }
  }, [gitRepositoryPath]);

  useEffect(() => {
    if (!pushPopoverOpen) return;
    void loadPushSummaryDraft();
  }, [pushPopoverOpen, loadPushSummaryDraft]);

  const handlePushSubmit = useCallback(async () => {
    const repoPath = gitRepositoryPath;
    const commitMessage = pushSummaryDraft.trim();
    if (!repoPath) {
      message.error("当前会话未绑定仓库，无法推送");
      return;
    }
    if (!commitMessage) {
      message.warning("请先填写提交总结");
      return;
    }
    setPushSubmitting(true);
    try {
      const latestStatus = await gitStatus(repoPath);
      if (latestStatus.staged.length === 0 && latestStatus.unstaged.length === 0) {
        message.info("当前没有可提交的改动");
        setPushPopoverOpen(false);
        return;
      }
      for (const file of latestStatus.unstaged) {
        await gitStage(repoPath, file.path);
      }
      await gitCommit(repoPath, commitMessage);
      await gitPull(repoPath);
      await gitPush(repoPath);
      message.success("提交并推送成功");
      setPushPopoverOpen(false);
      const refreshed = await gitStatus(repoPath);
      setStats({
        additions: Math.max(0, refreshed.additions || 0),
        deletions: Math.max(0, refreshed.deletions || 0),
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      message.error(`推送失败: ${errMsg}`);
      try {
        const latest = await gitStatus(repoPath).catch(() => null);
        const stagedFiles = latest?.staged.map((f) => `${f.path}(${f.status}, +${f.additions}, -${f.deletions})`) ?? [];
        const unstagedFiles = latest?.unstaged.map((f) => `${f.path}(${f.status}, +${f.additions}, -${f.deletions})`) ?? [];
        const autoFixPrompt = [
          "下面是一次 git 提交/同步/推送流程失败日志，请直接定位问题并修改代码后再次验证。",
          "优先处理 pre-commit、husky、lint、typecheck 或测试失败。",
          "",
          `仓库路径：${repoPath}`,
          `分支：${latest?.branch ?? "unknown"}`,
          `提交信息：${commitMessage}`,
          `变更统计：+${Math.max(0, latest?.additions || 0)} / -${Math.max(0, latest?.deletions || 0)}`,
          `暂存文件：${stagedFiles.length > 0 ? stagedFiles.join("、") : "(无)"}`,
          `未暂存文件：${unstagedFiles.length > 0 ? unstagedFiles.join("、") : "(无)"}`,
          "",
          "失败日志：",
          "```text",
          errMsg,
          "```",
          "",
          "请输出并执行修复步骤，完成后给出简短结果说明。",
        ].join("\n");
        _onSend(autoFixPrompt);
        message.info("已将失败日志交给 Claude Code 自动修复。");
      } catch {
        // ignore auto-fix dispatch failure
      }
    } finally {
      setPushSubmitting(false);
    }
  }, [_onSend, pushSummaryDraft, gitRepositoryPath]);

  const loadLinkedWorktrees = useCallback(async () => {
    const p = gitRepositoryPath;
    if (!p) {
      setLinkedWorktrees([]);
      return;
    }
    setGitWorktreeLoading(true);
    try {
      const list = await gitWorktreeList(p);
      const extras = list.filter((w) => !w.isPrimary);
      const seen = new Set<string>();
      const deduped: GitWorktreeEntry[] = [];
      for (const w of extras) {
        const key = sessionRepoPathKey(w.path);
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(w);
      }
      setLinkedWorktrees(deduped);
    } finally {
      setGitWorktreeLoading(false);
    }
  }, [gitRepositoryPath]);

  useEffect(() => {
    void loadLinkedWorktrees();
  }, [loadLinkedWorktrees]);

  useEffect(() => {
    const onRepoWorktreesMayHaveChanged = (ev: Event): void => {
      const detail = (ev as CustomEvent<RepoWorktreesMayHaveChangedDetail>).detail;
      const anchor = gitRepositoryPath;
      const changed = detail?.repositoryPath?.trim();
      if (!anchor || !changed) return;
      if (sessionRepoPathKey(anchor) !== sessionRepoPathKey(changed)) return;
      void loadLinkedWorktrees();
    };
    window.addEventListener(WORKFLOW_UI_EVENT_REPO_WORKTREES_MAY_HAVE_CHANGED, onRepoWorktreesMayHaveChanged);
    return () => {
      window.removeEventListener(WORKFLOW_UI_EVENT_REPO_WORKTREES_MAY_HAVE_CHANGED, onRepoWorktreesMayHaveChanged);
    };
  }, [gitRepositoryPath, loadLinkedWorktrees]);

  const handleGitWorktreeRemove = useCallback(
    async (worktreePath: string) => {
      const p = gitRepositoryPath;
      if (!p) return;
      setGitWorktreeRemovingPath(worktreePath);
      try {
        await gitWorktreeRemove(p, worktreePath);
        message.success("已移除 worktree");
        await loadLinkedWorktrees();
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        message.error(errMsg);
      } finally {
        setGitWorktreeRemovingPath(null);
      }
    },
    [gitRepositoryPath, loadLinkedWorktrees],
  );

  const handleOpenWorktreeInFinder = useCallback((worktreePath: string) => {
    void openInFinder(worktreePath).catch((err) => {
      console.error("openInFinder:", err);
      message.error(err instanceof Error ? err.message : String(err));
    });
  }, []);

  const handleAddWorktreeToProject = useCallback(
    async (worktreePath: string) => {
      if (!onAddWorktreeRepositoryToProject) return;
      setGitWorktreeAddingToProjectPath(worktreePath);
      try {
        await onAddWorktreeRepositoryToProject(worktreePath);
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
      } finally {
        setGitWorktreeAddingToProjectPath(null);
      }
    },
    [onAddWorktreeRepositoryToProject],
  );

  const loadNotificationRows = useCallback(async (options?: { quiet?: boolean }) => {
    const quiet = options?.quiet === true;
    if (!quiet) {
      setNotificationLoading(true);
    }
    try {
      const rows = await wiseNotificationListRecent(50);
      setNotificationRows(rows);
    } catch {
      if (!quiet) {
        setNotificationRows([]);
      }
    } finally {
      if (!quiet) {
        setNotificationLoading(false);
      }
    }
  }, []);

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
    if (!hideSessionTools) {
      return;
    }
    setHistoryPopoverOpen(false);
    setHistorySearchText("");
  }, [hideSessionTools]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    void loadNotificationRows();
    void (async () => {
      unlisten = await listen("wise-unread-changed", () => {
        void loadNotificationRows({ quiet: true });
      });
    })();
    return () => {
      safeUnlisten(unlisten);
    };
  }, [loadNotificationRows]);

  useEffect(() => {
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
      window.removeEventListener(SESSION_NOTIFICATION_UI_EVENT_OPEN_PANEL, handleOpenSessionNotificationPanel);
    };
  }, [loadNotificationRows]);

  useEffect(() => {
    if (sessionUnreadNotificationRows.length === 0) {
      setNotificationPanelCollapsed(true);
    }
  }, [sessionUnreadNotificationRows.length]);

  const repositoryHistorySessions = useMemo(
    () =>
      sessions
        .filter((item) => {
          const path = item.repositoryPath?.trim() ?? "";
          return path === repositoryScopePath;
        })
        .sort((a, b) => getSessionUpdatedAt(b) - getSessionUpdatedAt(a)),
    [sessions, repositoryScopePath],
  );

  const filteredHistorySessions = useMemo(() => {
    const keyword = historySearchText.trim().toLocaleLowerCase("zh-CN");
    if (!keyword) {
      return repositoryHistorySessions;
    }
    return repositoryHistorySessions.filter((item) => {
      const preview = getSessionPreview(item).toLocaleLowerCase("zh-CN");
      const repositoryName = item.repositoryName.toLocaleLowerCase("zh-CN");
      return preview.includes(keyword) || repositoryName.includes(keyword);
    });
  }, [repositoryHistorySessions, historySearchText]);

  const filteredHistoryLengthRef = useRef(0);
  filteredHistoryLengthRef.current = filteredHistorySessions.length;

  const groupedHistorySessions = useMemo(
    () => groupSessionsByDay(filteredHistorySessions.slice(0, historyVisibleCount)),
    [filteredHistorySessions, historyVisibleCount],
  );

  const historyRefreshInFlightRef = useRef(false);
  const handleHistorySessionsRefresh = useCallback(() => {
    if (!onRefreshHistorySessions || historyRefreshInFlightRef.current) return;
    historyRefreshInFlightRef.current = true;
    setHistorySessionsRefreshing(true);
    void Promise.resolve(onRefreshHistorySessions())
      .catch(() => {
        message.error("刷新历史会话失败");
      })
      .finally(() => {
        historyRefreshInFlightRef.current = false;
        setHistorySessionsRefreshing(false);
      });
  }, [onRefreshHistorySessions]);

  /**
   * 历史会话弹窗内删除一条会话：先 `Modal.confirm` 二次确认，再调 hook 的 `deleteSession`。
   *
   * 注意：物理删除 jsonl 不可恢复；后端 IPC 抛错（如运行中拒绝）时仅 toast 提示，
   * 不抹掉本地 tab，让用户先取消运行再重试。
   */
  const releaseHistoryPopoverCloseGuard = useCallback(() => {
    // 延后解除，避免蒙层/按钮点击在同一事件循环里误关历史 Popover
    window.setTimeout(() => {
      historyPopoverCloseGuardRef.current = false;
    }, 0);
  }, []);

  const handleDeleteHistorySession = useCallback(
    (sessionId: string, previewText: string) => {
      if (!onDeleteHistorySession) return;
      const preview = (previewText || "").trim() || "(无预览)";
      historyPopoverCloseGuardRef.current = true;
      Modal.confirm({
        title: "删除该历史会话？",
        content: (
          <div>
            <div style={{ marginBottom: 8 }}>
              <span style={{ color: "var(--ant-color-text-tertiary)" }}>预览：</span>
              <span>{preview.length > 80 ? `${preview.slice(0, 80)}…` : preview}</span>
            </div>
            <div style={{ color: "var(--ant-color-error)" }}>
              将删除磁盘上的 Claude Code 会话记录（jsonl），不可恢复。
              请确保该会话未在其他终端或 Claude CLI 中打开。
            </div>
          </div>
        ),
        okText: "删除",
        okType: "danger",
        cancelText: "取消",
        autoFocusButton: "cancel",
        mask: { closable: true },
        onCancel: releaseHistoryPopoverCloseGuard,
        afterClose: releaseHistoryPopoverCloseGuard,
        onOk: async () => {
          try {
            await onDeleteHistorySession(sessionId);
            message.success("已删除该历史会话");
          } catch (err) {
            const text = err instanceof Error ? err.message : String(err ?? "");
            message.error(text || "删除历史会话失败");
            throw err;
          }
        },
      });
    },
    [onDeleteHistorySession, releaseHistoryPopoverCloseGuard],
  );

  useEffect(() => {
    if (!taskCompletionModalOpen) return;
    handleHistorySessionsRefresh();
  }, [taskCompletionModalOpen, handleHistorySessionsRefresh]);

  useEffect(() => {
    setHistoryVisibleCount(FEATURE_SESSION_LIST_PAGE_SIZE);
  }, [historySearchText]);

  useEffect(() => {
    if (!historyPopoverOpen) return;
    let el: HTMLDivElement | null = null;
    const handler = () => {
      if (!el) return;
      const max = filteredHistoryLengthRef.current;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
        setHistoryVisibleCount((n) => Math.min(n + FEATURE_SESSION_LIST_PAGE_SIZE, max));
      }
    };
    const timer = window.setTimeout(() => {
      el = historyPopoverScrollRef.current;
      el?.addEventListener("scroll", handler);
    }, 50);
    return () => {
      window.clearTimeout(timer);
      el?.removeEventListener("scroll", handler);
    };
  }, [historyPopoverOpen, groupedHistorySessions.length, historyVisibleCount, filteredHistorySessions.length]);

  const publishedTeamMentions = useMemo(
    () =>
      workflowTemplates
        .filter((item) => (workflowGraphStatusByWorkflowId[item.id] ?? "").toLowerCase() === "published")
        .map((item) => ({ id: item.id, name: item.name })),
    [workflowTemplates, workflowGraphStatusByWorkflowId],
  );
  const taskListEmployeeOptions = useMemo(
    () => mentionEmployees.filter((item) => item.name.trim().length > 0),
    [mentionEmployees],
  );
  const taskListTeamOptions = publishedTeamMentions;
  /** 与侧栏「剩余槽位」解耦：可一次勾选多条，由后台按仓库并发上限排队执行 */
  const taskListMultiSelectCap = TASK_LIST_MAX_SELECTED;
  const monitorClaudeSlotsRemaining =
    typeof taskListConcurrentCapacity === "number" ? Math.max(0, Math.floor(taskListConcurrentCapacity)) : null;
  const filteredTaskList = useMemo(() => {
    if (taskListStatusFilter === "todo") return splitTodoTasks.filter((task) => task.flowStatus === "todo");
    if (taskListStatusFilter === "done") return splitTodoTasks.filter((task) => task.flowStatus === "done");
    const todos = splitTodoTasks.filter((task) => task.flowStatus === "todo");
    const dones = splitTodoTasks.filter((task) => task.flowStatus === "done");
    return [...todos, ...dones];
  }, [splitTodoTasks, taskListStatusFilter]);
  const taskListSelectableSliceIds = useMemo(
    () => filteredTaskList.slice(0, taskListMultiSelectCap).map((task) => task.id),
    [filteredTaskList, taskListMultiSelectCap],
  );
  const taskListSelectedSet = useMemo(() => new Set(taskListSelectedIds), [taskListSelectedIds]);
  const taskListAllFilteredSelected = useMemo(() => {
    if (taskListSelectableSliceIds.length === 0) return false;
    if (taskListSelectedIds.length !== taskListSelectableSliceIds.length) return false;
    return taskListSelectableSliceIds.every((id) => taskListSelectedSet.has(id));
  }, [taskListSelectableSliceIds, taskListSelectedIds, taskListSelectedSet]);
  const trellisTaskSelectableKeys = useMemo(
    () => visibleTrellisTasks.slice(0, taskListMultiSelectCap).map((task) => trellisTaskRowKey(task)),
    [visibleTrellisTasks, taskListMultiSelectCap],
  );
  const trellisTaskSelectedSet = useMemo(() => new Set(trellisTaskSelectedKeys), [trellisTaskSelectedKeys]);
  const trellisTaskAllSelected = useMemo(() => {
    if (trellisTaskSelectableKeys.length === 0) return false;
    if (trellisTaskSelectedKeys.length !== trellisTaskSelectableKeys.length) return false;
    return trellisTaskSelectableKeys.every((key) => trellisTaskSelectedSet.has(key));
  }, [trellisTaskSelectableKeys, trellisTaskSelectedKeys, trellisTaskSelectedSet]);
  const selectedTrellisTasks = useMemo(
    () => visibleTrellisTasks.filter((task) => trellisTaskSelectedSet.has(trellisTaskRowKey(task))),
    [trellisTaskSelectedSet, visibleTrellisTasks],
  );
  const trellisEmployeeDispatchAvailable = taskListEmployeeOptions.length > 0;

  useEffect(() => {
    setTaskListSelectedIds((prev) => {
      if (prev.length <= taskListMultiSelectCap) return prev;
      return prev.slice(0, taskListMultiSelectCap);
    });
  }, [taskListMultiSelectCap]);

  useEffect(() => {
    const valid = new Set(visibleTrellisTasks.map((task) => trellisTaskRowKey(task)));
    setTrellisTaskSelectedKeys((prev) => prev.filter((key) => valid.has(key)));
  }, [visibleTrellisTasks]);

  useEffect(() => {
    setTrellisTaskSelectedKeys((prev) => {
      if (prev.length <= taskListMultiSelectCap) return prev;
      return prev.slice(0, taskListMultiSelectCap);
    });
  }, [taskListMultiSelectCap]);

  /** 将「可执行任务」中的 flowStatus（仅 todo/done）写入 SQLite 拆分结果并刷新派生字段。 */
  const persistSplitTaskFlowStatus = useCallback(async (taskId: string, nextStatus: TaskFlowStatus): Promise<boolean> => {
    const normalized: "todo" | "done" = nextStatus === "done" ? "done" : "todo";
    const split = await loadPrdTaskSplitResult();
    if (!split) {
      void message.warning("未找到可执行任务数据，无法保存状态。");
      return false;
    }
    if (!split.executableTasks.some((item) => item.id === taskId)) {
      void message.warning("可执行任务列表中找不到该任务，无法保存状态。");
      return false;
    }
    const nextTasks = split.executableTasks.map((item) => (item.id === taskId ? { ...item, flowStatus: normalized } : item));
    try {
      await savePrdTaskSplitResult(refreshSplitResultDerivedFields({ ...split, executableTasks: nextTasks }));
      await syncSplitTaskList();
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void message.error(`保存任务状态失败：${msg}`);
      return false;
    }
  }, [syncSplitTaskList]);

  const persistSplitTaskDispatchField = useCallback(
    async (taskId: string, field: "splitListEmployeeName" | "splitListWorkflowId", rawValue: string) => {
      const trimmed = rawValue.trim();
      const split = await loadPrdTaskSplitResult();
      if (!split) {
        void message.warning("未找到可执行任务数据，无法保存选择。");
        return;
      }
      const nextTasks = split.executableTasks.map((item) => {
        if (item.id !== taskId) return item;
        const next = { ...item };
        if (!trimmed) {
          delete next[field];
        } else {
          next[field] = trimmed;
        }
        return next;
      });
      try {
        await savePrdTaskSplitResult(refreshSplitResultDerivedFields({ ...split, executableTasks: nextTasks }));
        await syncSplitTaskList();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void message.error(`保存失败：${msg}`);
      }
    },
    [syncSplitTaskList],
  );

  useEffect(() => {
    if (!workflowRun?.tasks?.length) return;
    let cancelled = false;
    const syncFlowRunStatusToSplitStore = async () => {
      const split = await loadPrdTaskSplitResult();
      if (!split || cancelled) return;
      const flowStatusByTaskId = new Map(workflowRun.tasks.map((item) => [item.taskId, item.flowStatus] as const));
      let changed = false;
      const nextTasks = split.executableTasks.map((task) => {
        const wf = flowStatusByTaskId.get(task.id);
        if (wf === undefined) return task;
        const fromWf: TaskFlowStatus = wf === "done" ? "done" : "todo";
        /** 工作流快照为 todo 而拆分结果为 done 时，须跟随为未完成，不得保留「已完成」 */
        if (wf === "todo" && task.flowStatus === "done") {
          changed = true;
          return { ...task, flowStatus: "todo" as TaskFlowStatus };
        }
        // 用户在列表中已标为已完成时，不因工作流仍为待审等而回写为未完成
        if (task.flowStatus === "done" && fromWf !== "done") return task;
        if (task.flowStatus === fromWf) return task;
        changed = true;
        return { ...task, flowStatus: fromWf };
      });
      if (!changed || cancelled) return;
      try {
        await savePrdTaskSplitResult(refreshSplitResultDerivedFields({ ...split, executableTasks: nextTasks }));
        if (cancelled) return;
        await syncSplitTaskList();
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        void message.error(`同步工作流状态到拆分结果失败：${msg}`);
      }
    };
    void syncFlowRunStatusToSplitStore();
    return () => {
      cancelled = true;
    };
  }, [workflowRun, syncSplitTaskList]);

  const handleOmcBatchConfirmFromPopover = useCallback(() => {
    const repoPath = session.repositoryPath?.trim() ?? "";
    if (!repoPath) {
      void message.warning("当前会话未关联仓库路径，无法批量 OMC。");
      return;
    }
    const selectedSet = new Set(taskListSelectedIds);
    const selectedInOrder = filteredTaskList.filter((t) => selectedSet.has(t.id));
    const tasksToRun = selectedInOrder.filter((t) => t.flowStatus === "todo");
    if (tasksToRun.length === 0) {
      if (selectedInOrder.length === 0) {
        void message.info("请先勾选要批量执行的未完成任务。");
      } else {
        void message.warning("所选任务均为已完成，未启动批量 OMC。");
      }
      return;
    }
    if (omcBatchInFlightRef.current) {
      void message.warning("上一批批量 OMC 仍在后台执行中，请稍候。");
      return;
    }

    const skippedDone = selectedInOrder.length - tasksToRun.length;
    if (skippedDone > 0) {
      void message.info(`已跳过 ${skippedDone} 条已完成任务，将在后台对 ${tasksToRun.length} 条未完成任务启动 OMC。`);
    }

    const conc = resolveTaskListOmcInvokeConcurrency?.(session);
    const repoDisplayRaw = (session.repositoryName ?? "").trim();
    const repoDisplay =
      getRepositoryBaseDisplayName(repoDisplayRaw).trim() ||
      session.repositoryPath?.replace(/\\/g, "/").split("/").filter(Boolean).pop()?.trim() ||
      repoPath;
    const repositoryMemberMetadata = sessionRepository
      ? {
          ownerKind: "repository" as const,
          ownerRepositoryId: sessionRepository.id,
          ownerRepositoryName: repoDisplay,
          ownerRepositoryPath: sessionRepository.path,
          repositoryType: sessionRepository.repositoryType,
        }
      : undefined;
    if (omcBatchTemplateId === TRELLIS_BATCH_TEMPLATE_ID) {
      const trellisImplementSubagent = resolveTrellisSubagentForStage("implement") ?? "trellis-implement";
      if (sessionRepository?.sddMode === "off") {
        void message.warning("当前仓库已关闭 SDD，未启动 Trellis 批量执行。");
        return;
      }
      omcBatchInFlightRef.current = true;
      omcBatchUserAbortRef.current = false;
      requestAnimationFrame(() => {
        setOmcBatchPopoverOpen(false);
        setTaskListDrawerOpen(false);
        requestAnimationFrame(() => {
          window.dispatchEvent(
            new CustomEvent(WORKFLOW_UI_EVENT_OMC_BATCH_RUNTIME_CHANGED, {
              detail: {
                active: true,
                sessionId: omcBatchAnchorSessionId,
                runningCount: tasksToRun.length,
                updatedAt: Date.now(),
              } satisfies WorkflowOmcBatchRuntimeDetail,
            }),
          );
          void (async () => {
            try {
              const result = await runSplitTasksOmcBatch({
                facade: getWorkflowFacade(),
                sessionId: omcBatchAnchorSessionId,
                repositoryPath: repoPath,
                tasks: tasksToRun,
                templateId: TRELLIS_BATCH_TEMPLATE_ID,
                subagentType: trellisImplementSubagent,
                executionMetadata: repositoryMemberMetadata,
                concurrency: 1,
                boundWorkflowRunId:
                  omcBatchAnchorSessionId === session.id ? (workflowRun?.workflowRunId ?? null) : null,
              });
              onAppendSystemMessage?.(
                omcBatchAnchorSessionId,
                `[系统] Trellis 批量执行结束：任务 ${result.taskCount} 条，成功 ${result.doneCount}，失败 ${result.failedCount}。${result.workflowRunId ? `\n工作流：${result.workflowRunId}` : ""}`,
              );
              requestWorkflowRunRefresh(omcBatchAnchorSessionId, repoPath);
              requestWorkflowRunRefresh(session.id, repoPath);
              await syncSplitTaskList();
            } catch (err) {
              console.error("trellis batch job failed:", err);
              const msg = err instanceof Error ? err.message : String(err);
              onAppendSystemMessage?.(omcBatchAnchorSessionId, `[系统] Trellis 批量执行失败：${msg}`);
              void message.error("Trellis 批量执行失败");
            } finally {
              window.dispatchEvent(
                new CustomEvent(WORKFLOW_UI_EVENT_OMC_BATCH_RUNTIME_CHANGED, {
                  detail: {
                    active: false,
                    sessionId: omcBatchAnchorSessionId,
                    runningCount: 0,
                    updatedAt: Date.now(),
                  } satisfies WorkflowOmcBatchRuntimeDetail,
                }),
              );
              omcBatchInFlightRef.current = false;
              omcBatchUserAbortRef.current = false;
            }
          })();
        });
      });
      return;
    }

    if (!isDirectOmcBatchTemplateId(omcBatchTemplateId)) {
      void message.error("未知批量执行模板。");
      return;
    }

    const batchParams = {
      anchorSessionId: omcBatchAnchorSessionId,
      repositoryPath: repoPath,
      repositoryDisplayName: repoDisplay,
      tasks: tasksToRun,
      templateId: omcBatchTemplateId,
      subagentType: "executor",
      concurrencyScopeKey: conc?.concurrencyScopeKey,
      concurrencyLimit: conc?.concurrencyLimit,
      userAbortRef: omcBatchUserAbortRef,
      inFlightRef: omcBatchInFlightRef,
      buildTaskAppendix: buildOmcBatchTaskIntentOneLiner,
      syncSplitTaskList,
      onExecutableTaskDoneAfterOmcSuccess: async (taskId: string) => {
        const ok = await persistSplitTaskFlowStatus(taskId, "done");
        if (ok) {
          window.dispatchEvent(new CustomEvent(WORKFLOW_UI_EVENT_SPLIT_TODO_COUNT_UPDATED, { detail: {} }));
        }
        return ok;
      },
      onAppendSystemMessage,
      onAppendDispatchUserMessage: onAppendUserMessage,
      onNotifyOmcEmployeeDirectBatchTaskDone,
    };

    omcBatchInFlightRef.current = true;
    omcBatchUserAbortRef.current = false;
    void (async () => {
      try {
        await onPrepareFreshOmcEmployeeWorkerForDirectBatch?.({
          repositoryPath: repoPath,
          repositoryDisplayName: repoDisplay,
        });
      } catch (err) {
        console.error("prepareFreshOmcEmployeeWorkerForDirectBatch failed:", err);
        omcBatchInFlightRef.current = false;
        void message.error("准备 OMC 员工新会话失败，已取消本次批量执行。");
        return;
      }
      /** 分帧：避免「巨型 Drawer 卸载 + 批任务全局事件」挤在同一帧拖死主线程 */
      requestAnimationFrame(() => {
        setOmcBatchPopoverOpen(false);
        setTaskListDrawerOpen(false);
        requestAnimationFrame(() => {
          scheduleDirectOmcBatchAfterMacrotask(batchParams);
        });
      });
    })();
  }, [
    filteredTaskList,
    omcBatchAnchorSessionId,
    omcBatchTemplateId,
    onAppendSystemMessage,
    onAppendUserMessage,
    onNotifyOmcEmployeeDirectBatchTaskDone,
    onPrepareFreshOmcEmployeeWorkerForDirectBatch,
    persistSplitTaskFlowStatus,
    resolveTaskListOmcInvokeConcurrency,
    session,
    sessionRepository?.sddMode,
    syncSplitTaskList,
    taskListSelectedIds,
    workflowRun?.workflowRunId,
  ]);

  const handleRunTaskInMainSession = useCallback(async (task: TaskItem) => {
    onExecute(session.id, buildTaskExecutionPrompt(task));
    void message.success(`任务 ${task.id} 已在主会话开始执行（仍为未完成，完成后请标记已完成）。`);
  }, [onExecute, session.id]);

  const handleRunTrellisTaskInMainSession = useCallback(async (task: TrellisRequirementTaskRow) => {
    onExecute(session.id, buildTrellisTaskExecutionPrompt(task));
    void message.success(`Trellis 任务 ${task.taskId} 已发送到主会话。`);
  }, [onExecute, session.id]);

  const handleRunTrellisTaskByEmployee = useCallback(
    async (task: TrellisRequirementTaskRow, employeeNameOverride?: string) => {
      const employeeName = (employeeNameOverride ?? trellisTaskEmployeeByKey[trellisTaskRowKey(task)] ?? "").trim();
      if (!employeeName) {
        void message.info("请先选择员工。");
        return;
      }
      onExecute(session.id, buildTrellisTaskExecutionPrompt(task), {
        targetType: "employee",
        targetEmployeeName: employeeName,
      });
      void message.success(`Trellis 任务 ${task.taskId} 已派发给员工 ${employeeName}。`);
    },
    [onExecute, session.id, trellisTaskEmployeeByKey],
  );

  const handleRunTaskByEmployee = useCallback(async (task: TaskItem) => {
    const employeeName = task.splitListEmployeeName?.trim();
    if (!employeeName) {
      void message.info("请先选择员工（选择会立即保存到拆分结果）。");
      return;
    }
    onExecute(session.id, buildTaskExecutionPrompt(task), {
      targetType: "employee",
      targetEmployeeName: employeeName,
    });
    void message.success(`任务 ${task.id} 已派发给员工 ${employeeName}（仍为未完成，完成后请标记已完成）。`);
  }, [onExecute, session.id]);

  const handleRunTaskByTeam = useCallback(async (task: TaskItem) => {
    const workflowId = task.splitListWorkflowId?.trim();
    const workflowName = taskListTeamOptions.find((item) => item.id === workflowId)?.name;
    if (!workflowId || !workflowName) {
      void message.info("请先选择团队流程（选择会立即保存到拆分结果）。");
      return;
    }
    onExecute(session.id, buildTaskExecutionPrompt(task), {
      targetType: "team",
      targetWorkflowId: workflowId,
      targetWorkflowName: workflowName,
    });
    void message.success(`任务 ${task.id} 已派发到团队 ${workflowName}（仍为未完成，完成后请标记已完成）。`);
  }, [onExecute, session.id, taskListTeamOptions]);

  const handleCompleteTaskManually = useCallback(async (task: TaskItem) => {
    const ok = await persistSplitTaskFlowStatus(task.id, "done");
    if (ok) void message.success(`任务 ${task.id} 已手动标记为完成并已写入可执行任务表。`);
  }, [persistSplitTaskFlowStatus]);

  const handleAdjustTaskStatus = useCallback(async (task: TaskItem, status: TaskFlowStatus) => {
    const ok = await persistSplitTaskFlowStatus(task.id, status);
    if (ok) void message.success(`任务 ${task.id} 已保存为${splitTaskListBinaryLabel(status)}（可执行任务）`);
  }, [persistSplitTaskFlowStatus]);

  const persistSplitAfterRemovingTasks = useCallback(
    async (ids: string[]): Promise<boolean> => {
      const unique = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
      if (unique.length === 0) return false;
      const split = await loadPrdTaskSplitResult();
      if (!split) {
        void message.error("未找到可执行任务数据，无法删除。");
        return false;
      }
      const next = removeSplitResultTasksByIds(split, unique);
      try {
        await savePrdTaskSplitResult(next);
        setTaskListSelectedIds((prev) => prev.filter((id) => !unique.includes(id)));
        await syncSplitTaskList();
        window.dispatchEvent(new CustomEvent(WORKFLOW_UI_EVENT_SPLIT_TODO_COUNT_UPDATED, { detail: {} }));
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void message.error(`删除保存失败：${msg}`);
        return false;
      }
    },
    [syncSplitTaskList],
  );

  const handleConfirmDeleteSplitTask = useCallback(
    async (task: TaskItem) => {
      const ok = await persistSplitAfterRemovingTasks([task.id]);
      if (ok) void message.success(`已删除任务 ${task.id}`);
    },
    [persistSplitAfterRemovingTasks],
  );

  const clearTrellisTaskFocusIfNeeded = useCallback((removedTasks: TrellisRequirementTaskRow[]) => {
    if (removedTasks.length === 0) return;
    setTrellisTaskFocus((prev) => {
      if (!prev) return prev;
      const removedIds = new Set(removedTasks.map((task) => task.taskId.trim()));
      const removedParents = new Set(
        removedTasks.map((task) => task.parent?.trim() ?? "").filter((name) => name.length > 0),
      );
      const parentFocus = prev.parentTaskName?.trim() ?? "";
      const childNames = prev.childTaskNames.map((name) => name.trim());
      const touchesFocus =
        removedIds.has(parentFocus) ||
        childNames.some((name) => removedIds.has(name)) ||
        (parentFocus.length > 0 && removedParents.has(parentFocus)) ||
        removedTasks.some((task) => {
          const taskId = task.taskId.trim();
          const parentName = task.parent?.trim() ?? "";
          return parentFocus === taskId || parentFocus === parentName;
        });
      return touchesFocus ? null : prev;
    });
  }, []);

  const archiveTrellisTasks = useCallback(
    async (tasks: TrellisRequirementTaskRow[]): Promise<{ ok: number; fail: number; lastError?: string }> => {
      let ok = 0;
      let fail = 0;
      let lastError: string | undefined;
      const removedKeys: string[] = [];
      for (const task of tasks) {
        const rootPath = task.rootPath?.trim();
        const taskDir = task.dir?.trim();
        const rowKey = trellisTaskRowKey(task);
        if (!rootPath || !taskDir) {
          fail += 1;
          lastError = "任务缺少 rootPath 或目录路径";
          continue;
        }
        try {
          await archiveTrellisTask(rootPath, taskDir);
          ok += 1;
          removedKeys.push(rowKey);
        } catch (err: unknown) {
          fail += 1;
          lastError = err instanceof Error ? err.message : String(err);
        }
      }
      if (removedKeys.length > 0) {
        setTrellisTaskSelectedKeys((prev) => prev.filter((key) => !removedKeys.includes(key)));
        setTrellisTaskEmployeeByKey((prev) => {
          const next = { ...prev };
          for (const key of removedKeys) delete next[key];
          return next;
        });
        clearTrellisTaskFocusIfNeeded(tasks.filter((task) => removedKeys.includes(trellisTaskRowKey(task))));
        await syncTrellisTaskList();
        window.dispatchEvent(new CustomEvent(WORKFLOW_UI_EVENT_SPLIT_TODO_COUNT_UPDATED, { detail: {} }));
      }
      return { ok, fail, lastError };
    },
    [clearTrellisTaskFocusIfNeeded, syncTrellisTaskList],
  );

  const handleArchiveTrellisTask = useCallback(
    async (task: TrellisRequirementTaskRow) => {
      const { ok, fail, lastError } = await archiveTrellisTasks([task]);
      if (ok > 0) void message.success(`已删除任务 ${task.taskId}`);
      else if (fail > 0) {
        void message.error(lastError ? `删除 Trellis 任务失败：${lastError}` : "删除 Trellis 任务失败");
      }
    },
    [archiveTrellisTasks],
  );

  const handleBatchArchiveTrellisTasks = useCallback(() => {
    if (selectedTrellisTasks.length === 0) {
      void message.info("请先勾选 Trellis 任务。");
      return;
    }
    const n = selectedTrellisTasks.length;
    Modal.confirm({
      title: "批量删除 Trellis 任务",
      content: `将归档 ${n} 条任务到 .trellis/tasks/archive/，并从当前列表移除。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        const { ok, fail, lastError } = await archiveTrellisTasks(selectedTrellisTasks);
        if (ok > 0 && fail === 0) void message.success(`已删除 ${ok} 条 Trellis 任务`);
        else if (ok > 0) {
          void message.warning(
            lastError ? `已删除 ${ok} 条，${fail} 条失败：${lastError}` : `已删除 ${ok} 条，${fail} 条失败`,
          );
        } else {
          void message.error(lastError ? `批量删除失败：${lastError}` : "批量删除失败");
        }
      },
    });
  }, [archiveTrellisTasks, selectedTrellisTasks]);

  const handleBatchRunTrellisByEmployee = useCallback(() => {
    if (selectedTrellisTasks.length === 0) {
      void message.info("请先勾选 Trellis 任务。");
      return;
    }
    const employeeName = trellisBatchEmployeeName.trim();
    if (!employeeName) {
      void message.info("请先选择批量执行员工。");
      return;
    }
    for (const task of selectedTrellisTasks) {
      onExecute(session.id, buildTrellisTaskExecutionPrompt(task), {
        targetType: "employee",
        targetEmployeeName: employeeName,
      });
    }
    void message.success(`已将 ${selectedTrellisTasks.length} 条 Trellis 任务派发给员工 ${employeeName}。`);
  }, [onExecute, selectedTrellisTasks, session.id, trellisBatchEmployeeName]);

  const handleDeleteAllSplitTasks = useCallback(() => {
    const ids = splitTodoTasks.map((task) => task.id.trim()).filter(Boolean);
    if (ids.length === 0) {
      void message.info("暂无可删除任务。");
      return;
    }
    const n = ids.length;
    Modal.confirm({
      title: "全部删除可执行任务",
      content: `将删除当前仓库下共 ${n} 条可执行任务（未完成与已完成均包含）。任务依赖中会移除对这些 id 的引用。此操作不可撤销。`,
      okText: "继续",
      cancelText: "取消",
      onOk: () => {
        Modal.confirm({
          title: "再次确认删除",
          content: `请再次确认：将永久删除全部 ${n} 条可执行任务。`,
          okText: "确认删除",
          okType: "danger",
          cancelText: "取消",
          onOk: async () => {
            const ok = await persistSplitAfterRemovingTasks(ids);
            if (ok) void message.success(`已删除全部 ${n} 条任务`);
          },
        });
      },
    });
  }, [persistSplitAfterRemovingTasks, splitTodoTasks]);

  useEffect(() => {
    function handleFocusTaskTool(event: Event) {
      const custom = event as CustomEvent<{ taskId?: string }>;
      const taskId = custom.detail?.taskId?.trim();
      if (!taskId) return;
      const id = taskId;

      function tryScroll(): boolean {
        const target = document.querySelector(`[data-task-id="${CSS.escape(id)}"]`);
        if (target instanceof HTMLElement) {
          const localScroll = target.closest(".ant-drawer-body, .ant-modal-body, [data-scroll-container]");
          if (localScroll instanceof HTMLElement) {
            const containerRect = localScroll.getBoundingClientRect();
            const targetRect = target.getBoundingClientRect();
            const top =
              localScroll.scrollTop +
              targetRect.top -
              containerRect.top -
              Math.max(0, (localScroll.clientHeight - targetRect.height) / 2);
            localScroll.scrollTo({
              top: Math.max(0, Math.min(localScroll.scrollHeight - localScroll.clientHeight, top)),
              behavior: "smooth",
            });
          } else {
            scrollMessageTargetIntoView(target);
          }
          return true;
        }
        return false;
      }

      if (tryScroll()) return;

      setTaskListStatusFilter("all");
      setTaskListDrawerOpen(true);
      window.setTimeout(() => {
        tryScroll();
      }, 280);
    }
    window.addEventListener(WORKFLOW_UI_EVENT_FOCUS_TASK_TOOL, handleFocusTaskTool as EventListener);
    return () => {
      window.removeEventListener(WORKFLOW_UI_EVENT_FOCUS_TASK_TOOL, handleFocusTaskTool as EventListener);
    };
  }, [scrollMessageTargetIntoView]);

  const traceDrawerWidth = Math.min(620, typeof window !== "undefined" ? window.innerWidth - 24 : 620);
  const sessionTraceStorageKey = getSessionTraceStorageKey(session.id, session.repositoryPath);
  const tracePersistTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const raw = await getAppSetting(sessionTraceStorageKey);
      if (cancelled) return;
      if (!raw) {
        setSessionSendTraces([]);
        return;
      }
      try {
        const parsed = JSON.parse(raw) as SessionSendTraceEntry[];
        if (!Array.isArray(parsed)) {
          setSessionSendTraces([]);
          return;
        }
        setSessionSendTraces(parsed.slice(0, 50));
      } catch {
        setSessionSendTraces([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionTraceStorageKey]);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(RETURN_MAIN_SESSION_KEY);
      setReturnMainSessionId(stored && stored.trim() ? stored : null);
    } catch {
      setReturnMainSessionId(null);
    }
  }, [session.id]);

  useEffect(() => {
    let pending: { conversationId?: string; messageId?: string; body?: string; taskId?: string } | null = null;
    try {
      const raw = sessionStorage.getItem(WISE_PENDING_NOTIFICATION_SCROLL_STORAGE_KEY);
      if (raw) {
        pending = JSON.parse(raw) as {
          conversationId?: string;
          messageId?: string;
          body?: string;
          taskId?: string;
        };
      }
    } catch {
      pending = null;
    }
    if (!pending?.conversationId) {
      return;
    }
    const matchesSession =
      pending.conversationId === session.id || pending.conversationId === (session.claudeSessionId ?? "");
    if (!matchesSession) {
      return;
    }

    const taskIdHint = pending.taskId?.trim();
    if (taskIdHint) {
      const byTask = document.querySelector(`[data-task-id="${CSS.escape(taskIdHint)}"]`);
      if (byTask) {
        window.setTimeout(() => {
          scrollMessageTargetIntoView(byTask);
          try {
            sessionStorage.removeItem(WISE_PENDING_NOTIFICATION_SCROLL_STORAGE_KEY);
          } catch {
            /* ignore */
          }
        }, 50);
        return;
      }
    }

    const escapedMessageId = CSS.escape((pending.messageId ?? "").trim());
    let target: Element | null = null;
    if (escapedMessageId) {
      target = document.querySelector(`[data-message-id="${escapedMessageId}"]`);
    }
    if (!target && pending.body?.trim()) {
      const keyword = extractNotificationScrollKeyword(pending.body);
      if (keyword) {
        for (let i = session.messages.length - 1; i >= 0; i -= 1) {
          const msg = session.messages[i];
          const partTexts =
            msg.parts
              ?.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
              .map((part) => part.text) ?? [];
          const fullText = [msg.content, ...partTexts].join("\n");
          if (fullText.includes(keyword)) {
            target = document.querySelector(`[data-message-id="${CSS.escape(String(msg.id))}"]`);
            break;
          }
        }
      }
    }
    if (!target) {
      return;
    }
    window.setTimeout(() => {
      const rawId = (pending.messageId ?? "").trim();
      const scrollIndex =
        rawId !== ""
          ? session.messages.findIndex((m) => String(m.id) === rawId)
          : session.messages.findIndex((m) => String(m.id) === target?.getAttribute("data-message-id"));
      if (scrollIndex >= 0) {
        const msg = session.messages[scrollIndex];
        const row =
          msg != null
            ? document.querySelector(`[data-message-id="${CSS.escape(String(msg.id))}"]`)
            : null;
        scrollMessageTargetIntoView(row);
      } else {
        scrollMessageTargetIntoView(target);
      }
      try {
        sessionStorage.removeItem(WISE_PENDING_NOTIFICATION_SCROLL_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }, 50);
  }, [session.id, session.claudeSessionId, session.messages]);

  useEffect(() => {
    if (tracePersistTimerRef.current != null) {
      window.clearTimeout(tracePersistTimerRef.current);
    }
    tracePersistTimerRef.current = window.setTimeout(() => {
      void setAppSetting(sessionTraceStorageKey, JSON.stringify(sessionSendTraces.slice(0, 50)));
      tracePersistTimerRef.current = null;
    }, 600);
    return () => {
      if (tracePersistTimerRef.current != null) {
        window.clearTimeout(tracePersistTimerRef.current);
        tracePersistTimerRef.current = null;
      }
    };
  }, [sessionSendTraces, sessionTraceStorageKey]);

  const sessionContextMetrics = useMemo(() => getSessionContextMetrics(session), [session.messages]);
  const [compactHistoryInFlight, setCompactHistoryInFlight] = useState(false);
  const isSessionBusy =
    session.status === "running" || session.status === "connecting";
  const canCompactSessionHistory =
    Boolean(onCompactSessionHistory) &&
    Boolean(session.claudeSessionId?.trim()) &&
    !isSessionBusy &&
    !compactHistoryInFlight;

  const handleCompactSessionHistory = useCallback(() => {
    if (!onCompactSessionHistory || !canCompactSessionHistory) return;
    setCompactHistoryInFlight(true);
    void Promise.resolve(onCompactSessionHistory(session.id))
      .then(() => {
        message.success("会话历史已压缩");
      })
      .catch(() => {
        /* 失败说明已由 hook 写入会话系统消息 */
      })
      .finally(() => {
        setCompactHistoryInFlight(false);
      });
  }, [canCompactSessionHistory, onCompactSessionHistory, session.id]);

  const compactSessionTooltip = useMemo(() => {
    if (!session.claudeSessionId?.trim()) {
      return "会话尚未建立 Claude session_id，暂无法压缩";
    }
    if (isSessionBusy) {
      return "会话运行中，请结束当前轮次后再压缩";
    }
    const { ctxPercent, estimatedTokens } = sessionContextMetrics;
    const autoNote =
      ctxPercent >= CONTEXT_AUTO_COMPACT_BEFORE_SEND_PERCENT
        ? "；发送新消息前也会自动压缩"
        : "";
    const clickHint = "；点击可手动压缩上下文";
    if (ctxPercent >= CONTEXT_WARN_PERCENT) {
      return `上下文约 ${ctxPercent}%（~${estimatedTokens.toLocaleString("zh-CN")} tokens）${clickHint}（/compact 压缩磁盘历史${autoNote}）`;
    }
    return `点击可手动压缩上下文（Claude Code /compact 压缩对话历史${autoNote}）`;
  }, [isSessionBusy, session.claudeSessionId, sessionContextMetrics]);

  return (
    <div
      ref={chatRootRef}
      className="app-claude-chat"
      tabIndex={-1}
      onPointerDownCapture={onChatPointerDownCapture}
    >
      {!hideSessionTools && (
        <div className="app-claude-session-feature-panel" role="toolbar" aria-label="会话功能面板">
          <div className="app-claude-session-feature-panel__left">
            <div className="app-claude-session-history-tools" role="toolbar" aria-label="历史会话与历史消息">
              <div className="app-claude-session-tool-group app-claude-session-tool-group--compact">
              <Popover
                trigger="click"
                placement="bottomLeft"
                open={historyPopoverOpen}
                onOpenChange={(nextOpen) => {
                  if (!nextOpen && historyPopoverCloseGuardRef.current) {
                    return;
                  }
                  setHistoryPopoverOpen(nextOpen);
                  if (nextOpen) {
                    setUserQuestionsPopoverOpen(false);
                    setHistoryVisibleCount(FEATURE_SESSION_LIST_PAGE_SIZE);
                    handleHistorySessionsRefresh();
                  } else {
                    setHistorySearchText("");
                  }
                }}
                overlayClassName="app-claude-session-history-popover"
                content={
                  <div ref={historyPopoverScrollRef} className="app-claude-session-history-popover__content">
                    <div className="app-claude-session-history-popover__search-wrap">
                      <div className="app-claude-session-history-popover__search-row">
                        <input
                          value={historySearchText}
                          onChange={(event) => setHistorySearchText(event.target.value)}
                          className="app-claude-session-history-popover__search-input"
                          placeholder="搜索会话..."
                        />
                        {onRefreshHistorySessions ? (
                          <Tooltip title="从磁盘重新扫描会话" mouseEnterDelay={0.35}>
                            <Button
                              type="text"
                              size="small"
                              className="app-claude-session-history-popover__refresh"
                              icon={<ReloadOutlined />}
                              loading={historySessionsRefreshing}
                              onClick={(event) => {
                                event.stopPropagation();
                                handleHistorySessionsRefresh();
                              }}
                              aria-label="刷新历史会话"
                            />
                          </Tooltip>
                        ) : null}
                      </div>
                    </div>
                    {groupedHistorySessions.length === 0 ? (
                      <div className="app-claude-session-history-popover__empty">
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description={historySearchText.trim() ? "未找到匹配会话" : "暂无历史会话"}
                        />
                      </div>
                    ) : (
                      groupedHistorySessions.map((group) => (
                        <div key={group.key} className="app-claude-session-history-popover__group">
                          <div className="app-claude-session-history-popover__group-title">{group.label}</div>
                          <div className="app-claude-session-history-popover__group-list">
                            {group.items.map((item) => {
                              const active = item.id === session.id;
                              const preview = getSessionPreview(item);
                              const sessionHoverTitle = buildClaudeSessionHoverTitle(item);
                              return (
                                <div key={item.id} className="app-claude-session-history-popover__item-row">
                                  <Tooltip title={sessionHoverTitle} mouseEnterDelay={0.35}>
                                  <button
                                    type="button"
                                    className={`app-claude-session-history-popover__item ${active ? "app-claude-session-history-popover__item--active" : ""}`}
                                    onClick={() => {
                                      onSwitchSession?.(item.id);
                                      setHistoryPopoverOpen(false);
                                      setHistorySearchText("");
                                    }}
                                  >
                                    <span className="app-claude-session-history-popover__item-dot" />
                                    <span className="app-claude-session-history-popover__item-title">{preview}</span>
                                  </button>
                                  </Tooltip>
                                  {onDeleteHistorySession ? (
                                    <Tooltip title="删除该历史会话" mouseEnterDelay={0.35}>
                                      <Button
                                        type="text"
                                        size="small"
                                        className="app-claude-session-history-popover__item-delete"
                                        icon={<DeleteOutlined />}
                                        aria-label="删除该历史会话"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          handleDeleteHistorySession(item.id, preview);
                                        }}
                                      />
                                    </Tooltip>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                }
              >
                <Tooltip title="历史会话" mouseEnterDelay={0.35}>
                  <button
                    type="button"
                    className="app-claude-session-tool-btn app-claude-session-tool-btn--history"
                    onClick={() => {
                      if (historyPopoverOpen) {
                        setHistorySearchText("");
                      }
                    }}
                  >
                    <ClockIcon />
                    <span className="app-claude-session-tool-btn__text">历史会话</span>
                  </button>
                </Tooltip>
              </Popover>

              <Popover
                trigger="click"
                placement="bottomLeft"
                open={userQuestionsPopoverOpen}
                onOpenChange={(nextOpen) => {
                  setUserQuestionsPopoverOpen(nextOpen);
                  if (nextOpen) {
                    setHistoryPopoverOpen(false);
                    setHistorySearchText("");
                  }
                }}
                overlayClassName="app-claude-session-user-questions-popover"
                content={
                  <div className="app-claude-session-user-questions-popover__content">
                    {sessionUserQuestionsForPopover.length === 0 ? (
                      <div className="app-claude-session-user-questions-popover__empty">
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无我的提问" />
                      </div>
                    ) : (
                      sessionUserQuestionsForPopover.map((row) => (
                        <button
                          key={row.id}
                          type="button"
                          className="app-claude-session-user-questions-popover__item"
                          title={row.text}
                          onClick={() => {
                            scrollToSessionMessageId(row.id);
                            setUserQuestionsPopoverOpen(false);
                          }}
                        >
                          <span className="app-claude-session-user-questions-popover__item-text">
                            {row.text}
                          </span>
                          <span className="app-claude-session-user-questions-popover__item-time">
                            {formatShortQuestionTime(row.timestamp)}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                }
              >
                <Tooltip title="历史消息" mouseEnterDelay={0.35}>
                  <button type="button" className="app-claude-session-tool-btn app-claude-session-tool-btn--user-questions">
                    <CommentOutlined />
                    <span className="app-claude-session-tool-btn__text">历史消息</span>
                  </button>
                </Tooltip>
              </Popover>

              </div>
            </div>

            {/* <div className="app-claude-session-tools" role="toolbar" aria-label="会话跟踪">
              <Tooltip title="会话跟踪" mouseEnterDelay={0.35}>
                <button
                  type="button"
                  className="app-claude-session-tool-btn"
                  onClick={handleOpenSessionTraceDrawer}
                >
                  <ProfileOutlined />
                  <span className="app-claude-session-tool-btn__text">会话跟踪</span>
                </button>
              </Tooltip>
            </div> */}
          </div>

          <div className="app-claude-session-feature-panel__right">
            <div
              className="app-claude-session-tools app-claude-session-tool-group app-claude-session-tool-group--compact"
              role="toolbar"
              aria-label={SHOW_SESSION_TASK_COMPLETION_FEATURE ? "可执行任务与完成情况" : "可执行任务与定时任务"}
            >
              <Tooltip title="定时任务：Cron 触发 Claude Code" mouseEnterDelay={0.35}>
                <button
                  type="button"
                  className="app-claude-session-tool-btn"
                  data-ui-anchor="session-scheduled-tasks-btn"
                  onClick={() => setScheduledTasksModalOpen(true)}
                >
                  <FieldTimeOutlined />
                  <span className="app-claude-session-tool-btn__text">定时任务</span>
                </button>
              </Tooltip>
              <Tooltip title="可执行任务" mouseEnterDelay={0.35}>
                <button
                  type="button"
                  className={[
                    "app-claude-session-tool-btn app-claude-session-tool-btn--task-list",
                    taskDrawerCount > 0 ? "app-claude-session-tool-btn--task-list--badged" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-ui-anchor="session-task-list-btn"
                  onClick={() => {
                    setTaskListStatusFilter("todo");
                    setTaskListDrawerOpen(true);
                  }}
                >
                  <UnorderedListOutlined />
                  <span className="app-claude-session-tool-btn__text">任务</span>
                  {taskDrawerCount > 0 ? (
                    <span className="app-claude-session-tool-btn__badge" aria-label={`可执行任务与 Trellis 任务数量 ${taskDrawerCount}`}>
                      {taskDrawerCount}
                    </span>
                  ) : null}
                </button>
              </Tooltip>
              {SHOW_SESSION_TASK_COMPLETION_FEATURE ? (
                <Tooltip title="查看本仓库各标签会话的 Claude Code 执行情况" mouseEnterDelay={0.35}>
                  <button
                    type="button"
                    className="app-claude-session-tool-btn"
                    onClick={() => setTaskCompletionModalOpen(true)}
                  >
                    <CheckCircleOutlined />
                    <span className="app-claude-session-tool-btn__text">完成任务</span>
                  </button>
                </Tooltip>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <RepositoryScheduledTasksModal
        open={scheduledTasksModalOpen}
        onClose={() => setScheduledTasksModalOpen(false)}
        repositoryPath={repositoryScopePath}
        repositoryDisplayName={sessionRepository?.name ?? session.repositoryName}
        employees={employees}
        workflowTemplates={workflowTemplates}
        workflowGraphsByWorkflowId={workflowGraphsByWorkflowId}
      />

      {SHOW_SESSION_TASK_COMPLETION_FEATURE ? (
        <Modal
          title={(
            <span className="app-task-completion-modal__title-wrap">
              <span className="app-task-completion-modal__title-text">完成任务</span>
              <Tooltip
                title={TASK_COMPLETION_MODAL_HINT}
                placement="bottomLeft"
                mouseEnterDelay={0.35}
                styles={{ container: { maxWidth: 420 } }}
              >
                <button type="button" className="app-task-completion-modal__title-help" aria-label="说明">
                  <QuestionCircleOutlined />
                </button>
              </Tooltip>
            </span>
          )}
          open={taskCompletionModalOpen}
          onCancel={() => setTaskCompletionModalOpen(false)}
          footer={
            <Button type="primary" onClick={() => setTaskCompletionModalOpen(false)}>
              关闭
            </Button>
          }
          width={Math.min(960, typeof window !== "undefined" ? window.innerWidth - 48 : 960)}
          destroyOnHidden
          className="app-task-completion-modal"
        >
          <div className="app-task-completion-modal__toolbar">
            <div className="app-task-completion-modal__filters" aria-label="筛选">
              <span className="app-task-completion-modal__filter-label">筛选</span>
              <Select<TaskCompletionOwnerFilter>
                size="small"
                value={completionOwnerFilter}
                onChange={setCompletionOwnerFilter}
                className="app-task-completion-modal__select app-task-completion-modal__select--type"
                popupMatchSelectWidth={false}
                options={[
                  { value: "all", label: "全部类型" },
                  { value: "main", label: "主会话" },
                  { value: "employee", label: "员工" },
                  { value: "team", label: "团队" },
                ]}
              />
              <Select<TaskCompletionStatusFilter>
                size="small"
                value={completionStatusFilter}
                onChange={setCompletionStatusFilter}
                className="app-task-completion-modal__select app-task-completion-modal__select--status"
                popupMatchSelectWidth={false}
                options={[
                  { value: "all", label: "全部状态" },
                  { value: "idle", label: "空闲" },
                  { value: "connecting", label: "连接中" },
                  { value: "running", label: "运行中" },
                  { value: "completed", label: "已完成" },
                  { value: "cancelled", label: "已取消" },
                  { value: "error", label: "异常" },
                ]}
              />
            </div>
            <div className="app-task-completion-modal__search-row">
              <Input.Search
                allowClear
                size="small"
                placeholder="搜索摘要、范围、ID…"
                value={completionSearchText}
                onChange={(e) => setCompletionSearchText(e.target.value)}
                className="app-task-completion-modal__search"
              />
              {onRefreshHistorySessions ? (
                <Tooltip title="从磁盘重新扫描会话并刷新列表" mouseEnterDelay={0.35}>
                  <Button
                    type="default"
                    size="small"
                    icon={<ReloadOutlined />}
                    loading={historySessionsRefreshing}
                    onClick={() => {
                      handleHistorySessionsRefresh();
                    }}
                    aria-label="刷新会话列表"
                  >
                    刷新
                  </Button>
                </Tooltip>
              ) : null}
            </div>
          </div>
          <div className="app-task-completion-modal__count">
            已显示 {completionDisplayedRows.length} / {completionFilteredRows.length} 条
            {completionHasMore ? "，表格内向下滚动加载更多" : completionFilteredRows.length > 0 ? "（已全部加载）" : null}
          </div>
          <div ref={completionTableWrapRef} className="app-task-completion-modal__table-wrap">
            <Table<RepositorySessionExecutionRow>
              className="app-task-completion-modal__table"
              tableLayout="fixed"
              size="small"
              pagination={false}
              rowKey="key"
              columns={taskCompletionTableColumns}
              dataSource={completionDisplayedRows}
              locale={{
                emptyText:
                  repositorySessionExecutionRows.length === 0
                    ? "当前仓库暂无会话标签"
                    : "没有符合筛选/搜索条件的会话",
              }}
              scroll={{ y: 340 }}
            />
          </div>
        </Modal>
      ) : null}

      <Drawer
        title={
          taskDrawerCount > 0
            ? `任务（Wise ${splitIncompleteTaskCount} · Trellis ${visibleTrellisTasks.length}）`
            : "任务"
        }
        placement="right"
        size={traceDrawerWidth}
        open={taskListDrawerOpen}
        onClose={() => setTaskListDrawerOpen(false)}
        destroyOnHidden={false}
        classNames={{ body: "app-claude-task-list-drawer-body" }}
        styles={{
          body: {
            padding: 12,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
          },
        }}
      >
        <div className="app-claude-task-list-drawer-inner">
        {trellisTaskFocus ? (
          <div className="app-claude-task-list__focus-bar">
            <span>
              当前聚焦：{trellisTaskFocus.parentTaskName || "本次落盘任务"}
              {trellisTaskFocus.childTaskNames.length > 0 ? ` · ${trellisTaskFocus.childTaskNames.length} 个子任务` : ""}
            </span>
            <button type="button" onClick={() => setTrellisTaskFocus(null)}>
              显示全部
            </button>
          </div>
        ) : null}
        {splitTodoTasks.length === 0 && visibleTrellisTasks.length === 0 ? (
          <div className="app-claude-task-list-empty">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={trellisTasksLoading ? "正在读取 Workspace Trellis 任务" : "暂无任务"}
            />
          </div>
        ) : (
          <div className="app-claude-task-list">
            {splitTodoTasks.length > 0 ? (
            <>
            <div className="app-claude-task-list__batch-bar">
              <label className="app-claude-task-list__batch-check">
                <span>筛选</span>
                <select
                  className="app-claude-task-list__batch-filter"
                  value={taskListStatusFilter}
                  onChange={(e) => {
                    setTaskListStatusFilter(e.currentTarget.value as "all" | "todo" | "done");
                  }}
                >
                  <option value="all">全部</option>
                  <option value="todo">未完成</option>
                  <option value="done">已完成</option>
                </select>
              </label>
              <label className="app-claude-task-list__batch-check">
                <input
                  type="checkbox"
                  disabled={taskListSelectableSliceIds.length === 0}
                  checked={taskListAllFilteredSelected}
                  onChange={(e) => {
                    if (e.currentTarget.checked) {
                      const next = taskListSelectableSliceIds.slice();
                      setTaskListSelectedIds(next);
                      if (filteredTaskList.length > taskListMultiSelectCap) {
                        void message.info(`当前视图共 ${filteredTaskList.length} 条，已自动只选前 ${taskListMultiSelectCap} 条（单次批量多选上限）。`);
                      }
                      return;
                    }
                    setTaskListSelectedIds([]);
                  }}
                />
                <span>全选当前视图</span>
              </label>
              <span className="app-claude-task-list__batch-count">
                已选 {taskListSelectedIds.length} / {taskListMultiSelectCap}
                {monitorClaudeSlotsRemaining != null ? (
                  <span className="app-claude-task-list__batch-slots-hint">
                    （槽位约剩 {monitorClaudeSlotsRemaining}）
                  </span>
                ) : null}
              </span>
              <div className="app-claude-task-list__batch-actions">
                <Popover
                  trigger="click"
                  open={omcBatchPopoverOpen}
                  onOpenChange={setOmcBatchPopoverOpen}
                  placement="bottomLeft"
                  overlayClassName="app-claude-task-list__omc-popover-root"
                  content={(
                    <div className="app-claude-task-list__omc-popover">
                      <div className="app-claude-task-list__omc-field">
                        <label htmlFor="omc-batch-template">执行模板</label>
                        <select
                          id="omc-batch-template"
                          className="app-claude-task-list__omc-select"
                          value={omcBatchTemplateId}
                          onChange={(e) => {
                            setOmcBatchTemplateId(e.currentTarget.value as OmcBatchTemplateId);
                          }}
                        >
                          <option value="autopilot">autopilot（/autopilot）</option>
                          <option value="ultraqa">ultraqa（/ultraqa）</option>
                          <option value="verify">verify（/verify）</option>
                          <option value="team">team（/team）</option>
                          <option value="trellis">trellis（Trellis adapter）</option>
                        </select>
                      </div>
                      <div className="app-claude-task-list__omc-footer">
                        <Button size="small" onClick={() => setOmcBatchPopoverOpen(false)}>
                          关闭
                        </Button>
                        <Button type="primary" size="small" onClick={handleOmcBatchConfirmFromPopover}>
                          执行
                        </Button>
                      </div>
                    </div>
                  )}
                >
                  <button type="button" className="app-claude-task-list__batch-action-btn">
                    批量OMC执行
                  </button>
                </Popover>
                <button
                  type="button"
                  className="app-claude-task-list__batch-action-btn app-claude-task-list__batch-action-btn--danger"
                  onClick={handleDeleteAllSplitTasks}
                >
                  全部删除
                </button>
              </div>
            </div>
            {filteredTaskList.length === 0 ? (
              <div className="app-claude-task-list-empty">
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可执行任务" />
              </div>
            ) : null}
            {filteredTaskList.map((task) => {
              const taskDescription = task.description.trim() || "暂无任务描述";
              const taskSubtasks = task.subtasks.filter((item) => item.trim().length > 0);
              const taskDod = task.dod.filter((item) => item.trim().length > 0);
              const taskDependencies = task.dependencies.filter((item) => item.trim().length > 0);
              return (
                <div key={task.id} className="app-claude-task-list__item" data-task-id={task.id}>
                  <div className="app-claude-task-list__body">
                    <div className="app-claude-task-list__left">
                      <div className="app-claude-task-list__title-row">
                        <label className="app-claude-task-list__item-check">
                          <input
                            type="checkbox"
                            checked={taskListSelectedSet.has(task.id)}
                            onChange={(e) => {
                              const checked = e.currentTarget.checked;
                              setTaskListSelectedIds((prev) => {
                                if (checked) {
                                  if (prev.length >= taskListMultiSelectCap) {
                                    void message.info(`最多只能勾选 ${taskListMultiSelectCap} 条（单次批量多选上限）。`);
                                    return prev;
                                  }
                                  return prev.includes(task.id) ? prev : [...prev, task.id];
                                }
                                return prev.filter((id) => id !== task.id);
                              });
                            }}
                          />
                        </label>
                        <span className="app-claude-task-list__id">{task.id}</span>
                        <span className="app-claude-task-list__title">{task.title || "(未命名任务)"}</span>
                        <Popover
                          trigger="click"
                          placement="leftTop"
                          overlayClassName="app-claude-task-list__detail-popover"
                          content={(
                            <div className="app-claude-task-list__detail-content">
                              <div className="app-claude-task-list__content-block">
                                <div className="app-claude-task-list__content-title">任务描述</div>
                                <div className="app-claude-task-list__content-text">{taskDescription}</div>
                              </div>
                              <div className="app-claude-task-list__content-block">
                                <div className="app-claude-task-list__content-title">子任务</div>
                                {taskSubtasks.length > 0 ? (
                                  <ul className="app-claude-task-list__content-list">
                                    {taskSubtasks.map((item, index) => (
                                      <li key={`${task.id}_subtask_${index}`}>{item}</li>
                                    ))}
                                  </ul>
                                ) : (
                                  <div className="app-claude-task-list__content-empty">暂无子任务</div>
                                )}
                              </div>
                              <div className="app-claude-task-list__content-block">
                                <div className="app-claude-task-list__content-title">验收标准</div>
                                {taskDod.length > 0 ? (
                                  <ul className="app-claude-task-list__content-list">
                                    {taskDod.map((item, index) => (
                                      <li key={`${task.id}_dod_${index}`}>{item}</li>
                                    ))}
                                  </ul>
                                ) : (
                                  <div className="app-claude-task-list__content-empty">暂无验收标准</div>
                                )}
                              </div>
                              <div className="app-claude-task-list__content-block">
                                <div className="app-claude-task-list__content-title">依赖任务</div>
                                {taskDependencies.length > 0 ? (
                                  <div className="app-claude-task-list__dependency-list">
                                    {taskDependencies.map((item) => (
                                      <span key={`${task.id}_dep_${item}`} className="app-claude-task-list__dependency-tag">
                                        {item}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="app-claude-task-list__content-empty">无依赖</div>
                                )}
                              </div>
                            </div>
                          )}
                        >
                          <button type="button" className="app-claude-task-list__action-btn app-claude-task-list__detail-btn">
                            详情
                          </button>
                        </Popover>
                      </div>
                      <div className="app-claude-task-list__meta">
                        <span>角色：{formatTaskRoleLabel(task.role)}</span>
                        <span>规模：{task.size}</span>
                        <span>估时：{task.estimateDays} 天</span>
                        <span className="app-claude-task-list__status">状态：{splitTaskListBinaryLabel(task.flowStatus)}</span>
                        {task.splitSourceTaskId?.trim() ? <span>来源：{task.splitSourceTaskId.trim()}</span> : null}
                      </div>
                      <div className="app-claude-task-list__actions">
                        <div className="app-claude-task-list__action-group">
                          <select
                            className="app-claude-task-list__select"
                            value={task.flowStatus ?? "todo"}
                            onChange={(e) => {
                              const v = e.currentTarget.value;
                              if (v !== "todo" && v !== "done") return;
                              void handleAdjustTaskStatus(task, v);
                            }}
                          >
                            <option value="todo">未完成</option>
                            <option value="done">已完成</option>
                          </select>
                          <button
                            type="button"
                            className="app-claude-task-list__action-btn app-claude-task-list__action-btn--success"
                            onClick={() => {
                              void handleCompleteTaskManually(task);
                            }}
                          >
                            完成
                          </button>
                          <Popconfirm
                            title="删除该可执行任务？"
                            description="不可撤销；其他任务依赖中会移除对该 id 的引用。"
                            okText="删除"
                            okButtonProps={{ danger: true }}
                            cancelText="取消"
                            onConfirm={() => {
                              void handleConfirmDeleteSplitTask(task);
                            }}
                          >
                            <button type="button" className="app-claude-task-list__action-btn app-claude-task-list__action-btn--danger">
                              删除
                            </button>
                          </Popconfirm>
                        </div>
                        <div className="app-claude-task-list__action-group">
                          <button
                            type="button"
                            className="app-claude-task-list__action-btn app-claude-task-list__action-btn--primary"
                            onClick={() => {
                              void handleRunTaskInMainSession(task);
                            }}
                          >
                            主会话执行
                          </button>
                        </div>
                        <div className="app-claude-task-list__action-group app-claude-task-list__inline-runner">
                          <select
                            className="app-claude-task-list__select"
                            value={task.splitListEmployeeName ?? ""}
                            onChange={(e) => {
                              void persistSplitTaskDispatchField(task.id, "splitListEmployeeName", e.currentTarget.value);
                            }}
                          >
                            <option value="">选择员工</option>
                            {taskListEmployeeOptions.map((employee) => (
                              <option key={employee.id} value={employee.name}>
                                {employee.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="app-claude-task-list__action-btn"
                            onClick={() => {
                              void handleRunTaskByEmployee(task);
                            }}
                          >
                            员工执行
                          </button>
                        </div>
                        <div className="app-claude-task-list__action-group app-claude-task-list__inline-runner">
                          <select
                            className="app-claude-task-list__select"
                            value={task.splitListWorkflowId ?? ""}
                            onChange={(e) => {
                              void persistSplitTaskDispatchField(task.id, "splitListWorkflowId", e.currentTarget.value);
                            }}
                          >
                            <option value="">选择团队</option>
                            {taskListTeamOptions.map((team) => (
                              <option key={team.id} value={team.id}>
                                {team.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="app-claude-task-list__action-btn"
                            onClick={() => {
                              void handleRunTaskByTeam(task);
                            }}
                          >
                            团队执行
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            </>
            ) : null}
            {visibleTrellisTasks.length > 0 ? (
              <div className="app-claude-task-list__section" aria-label="Workspace Trellis 任务">
                <div className="app-claude-task-list__section-head">
                  <div>
                    <div className="app-claude-task-list__section-title">Workspace Trellis</div>
                    <div className="app-claude-task-list__section-subtitle">
                      已落盘到 {activeProject?.rootPath?.trim() || "当前工作区"} 的可继续执行任务
                    </div>
                  </div>
                  <button
                    type="button"
                    className="app-claude-task-list__batch-action-btn"
                    disabled={trellisTasksLoading}
                    onClick={() => {
                      void syncTrellisTaskList();
                    }}
                  >
                    刷新
                  </button>
                </div>
                <div className="app-claude-task-list__batch-bar app-claude-task-list__batch-bar--trellis">
                  <label className="app-claude-task-list__batch-check">
                    <input
                      type="checkbox"
                      disabled={trellisTaskSelectableKeys.length === 0}
                      checked={trellisTaskAllSelected}
                      onChange={(e) => {
                        if (e.currentTarget.checked) {
                          const next = trellisTaskSelectableKeys.slice();
                          setTrellisTaskSelectedKeys(next);
                          if (visibleTrellisTasks.length > taskListMultiSelectCap) {
                            void message.info(
                              `当前共 ${visibleTrellisTasks.length} 条，已自动只选前 ${taskListMultiSelectCap} 条（单次批量多选上限）。`,
                            );
                          }
                          return;
                        }
                        setTrellisTaskSelectedKeys([]);
                      }}
                    />
                    <span>全选</span>
                  </label>
                  <span className="app-claude-task-list__batch-count">
                    已选 {trellisTaskSelectedKeys.length} / {taskListMultiSelectCap}
                  </span>
                  <div className="app-claude-task-list__batch-actions">
                    <select
                      className="app-claude-task-list__batch-filter"
                      value={trellisBatchEmployeeName}
                      disabled={!trellisEmployeeDispatchAvailable}
                      title={trellisEmployeeDispatchAvailable ? undefined : "当前工作区暂无可派发员工"}
                      onChange={(e) => {
                        const name = e.currentTarget.value;
                        setTrellisBatchEmployeeName(name);
                        setTrellisTaskEmployeeByKey((prev) => {
                          const next = { ...prev };
                          for (const key of trellisTaskSelectedKeys) {
                            if (name.trim()) next[key] = name;
                            else delete next[key];
                          }
                          return next;
                        });
                      }}
                    >
                      <option value="">批量员工</option>
                      {taskListEmployeeOptions.map((employee) => (
                        <option key={employee.id} value={employee.name}>
                          {employee.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="app-claude-task-list__batch-action-btn"
                      disabled={!trellisEmployeeDispatchAvailable || trellisTaskSelectedKeys.length === 0}
                      onClick={handleBatchRunTrellisByEmployee}
                    >
                      批量员工执行
                    </button>
                    <button
                      type="button"
                      className="app-claude-task-list__batch-action-btn app-claude-task-list__batch-action-btn--danger"
                      disabled={trellisTaskSelectedKeys.length === 0}
                      onClick={handleBatchArchiveTrellisTasks}
                    >
                      批量删除
                    </button>
                  </div>
                </div>
                {visibleTrellisTasks.map((task) => {
                  const taskPath = getTrellisTaskRelativePath(task);
                  const rowKey = trellisTaskRowKey(task);
                  const rowEmployeeName = trellisTaskEmployeeByKey[rowKey] ?? "";
                  return (
                    <div
                      key={rowKey}
                      className="app-claude-task-list__item app-claude-task-list__item--trellis"
                      data-task-id={task.taskId}
                    >
                      <div className="app-claude-task-list__body">
                        <div className="app-claude-task-list__left">
                          <div className="app-claude-task-list__title-row">
                            <label className="app-claude-task-list__item-check">
                              <input
                                type="checkbox"
                                checked={trellisTaskSelectedSet.has(rowKey)}
                                onChange={(e) => {
                                  const checked = e.currentTarget.checked;
                                  setTrellisTaskSelectedKeys((prev) => {
                                    if (checked) {
                                      if (prev.length >= taskListMultiSelectCap) {
                                        void message.info(`最多只能勾选 ${taskListMultiSelectCap} 条（单次批量多选上限）。`);
                                        return prev;
                                      }
                                      return prev.includes(rowKey) ? prev : [...prev, rowKey];
                                    }
                                    return prev.filter((key) => key !== rowKey);
                                  });
                                }}
                              />
                            </label>
                            <span className="app-claude-task-list__id">{task.taskId}</span>
                            <span className="app-claude-task-list__title">{task.title || "(未命名任务)"}</span>
                            <Popover
                              trigger="click"
                              placement="leftTop"
                              overlayClassName="app-claude-task-list__detail-popover"
                              content={(
                                <div className="app-claude-task-list__detail-content">
                                  <div className="app-claude-task-list__content-block">
                                    <div className="app-claude-task-list__content-title">任务路径</div>
                                    <div className="app-claude-task-list__content-text">{taskPath}</div>
                                  </div>
                                  <div className="app-claude-task-list__content-block">
                                    <div className="app-claude-task-list__content-title">来源需求</div>
                                    {task.sourceRequirementIds.length > 0 ? (
                                      <div className="app-claude-task-list__dependency-list">
                                        {task.sourceRequirementIds.map((item) => (
                                          <span key={`${task.taskId}_req_${item}`} className="app-claude-task-list__dependency-tag">
                                            {item}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="app-claude-task-list__content-empty">暂无来源需求映射</div>
                                    )}
                                  </div>
                                </div>
                              )}
                            >
                              <button type="button" className="app-claude-task-list__action-btn app-claude-task-list__detail-btn">
                                详情
                              </button>
                            </Popover>
                          </div>
                          <div className="app-claude-task-list__meta">
                            <span className="app-claude-task-list__status">状态：{task.status || "unknown"}</span>
                            {task.parent?.trim() ? <span>父任务：{task.parent.trim()}</span> : null}
                            {task.clusterId?.trim() ? <span>分片：{task.clusterId.trim()}</span> : null}
                            <span>路径：{taskPath}</span>
                          </div>
                          <div className="app-claude-task-list__actions">
                            <div className="app-claude-task-list__action-group">
                              <button
                                type="button"
                                className="app-claude-task-list__action-btn app-claude-task-list__action-btn--primary"
                                onClick={() => {
                                  void handleRunTrellisTaskInMainSession(task);
                                }}
                              >
                                主会话执行
                              </button>
                              <Popconfirm
                                title="删除该 Trellis 任务？"
                                description="将归档到 .trellis/tasks/archive/ 并从当前列表移除，子目录一并移走。"
                                okText="删除"
                                okButtonProps={{ danger: true }}
                                cancelText="取消"
                                onConfirm={() => {
                                  void handleArchiveTrellisTask(task);
                                }}
                              >
                                <button
                                  type="button"
                                  className="app-claude-task-list__action-btn app-claude-task-list__action-btn--danger"
                                >
                                  删除
                                </button>
                              </Popconfirm>
                            </div>
                            <div className="app-claude-task-list__action-group app-claude-task-list__inline-runner">
                              <select
                                className="app-claude-task-list__select"
                                value={rowEmployeeName}
                                disabled={!trellisEmployeeDispatchAvailable}
                                title={trellisEmployeeDispatchAvailable ? undefined : "当前工作区暂无可派发员工"}
                                onChange={(e) => {
                                  const name = e.currentTarget.value;
                                  setTrellisTaskEmployeeByKey((prev) => {
                                    const next = { ...prev };
                                    if (!name.trim()) delete next[rowKey];
                                    else next[rowKey] = name;
                                    return next;
                                  });
                                }}
                              >
                                <option value="">选择员工</option>
                                {taskListEmployeeOptions.map((employee) => (
                                  <option key={employee.id} value={employee.name}>
                                    {employee.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="app-claude-task-list__action-btn"
                                disabled={!trellisEmployeeDispatchAvailable}
                                onClick={() => {
                                  void handleRunTrellisTaskByEmployee(task);
                                }}
                              >
                                员工执行
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        )}
        </div>
      </Drawer>

      <Drawer
        title="会话跟踪"
        placement="right"
        size={traceDrawerWidth}
        open={sessionTraceDrawerOpen}
        onClose={() => setSessionTraceDrawerOpen(false)}
        destroyOnHidden={false}
        styles={{ body: { padding: 12, overflow: "auto" } }}
      >
        <div className="app-claude-session-trace-list">
          <div className="app-claude-session-trace-actions">
            <button
              type="button"
              className="app-claude-session-trace-actions__btn"
              onClick={() => {
                if (sessionSendTraces.length === 0) {
                  message.info("暂无可导出的跟踪记录");
                  return;
                }
                const payload = {
                  sessionId: session.id,
                  repositoryPath: session.repositoryPath,
                  exportedAt: Date.now(),
                  traces: sessionSendTraces,
                };
                const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = `session-trace-${session.id}-${Date.now()}.json`;
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
                URL.revokeObjectURL(url);
                message.success("会话跟踪已导出");
              }}
            >
              导出 JSON
            </button>
            <button
              type="button"
              className="app-claude-session-trace-actions__btn"
              onClick={() => {
                setSessionSendTraces([]);
                message.success("会话跟踪已清空");
              }}
            >
              清空记录
            </button>
          </div>
          {sessionSendTraces.length === 0 ? (
            <div className="app-claude-session-trace-empty">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无会话跟踪记录" />
            </div>
          ) : (
            sessionSendTraces.map((entry) => (
              <div key={entry.id} className="app-claude-session-trace-card">
                <div className="app-claude-session-trace-card__head">
                  <span className="app-claude-session-trace-card__title">发送时间</span>
                  <span className="app-claude-session-trace-card__time">
                    {new Date(entry.createdAt).toLocaleString("zh-CN")}
                  </span>
                </div>
                <div className="app-claude-session-trace-card__section">
                  <div className="app-claude-session-trace-card__label">输入消息</div>
                  <pre className="app-claude-session-trace-card__text">{entry.composerText || "(空)"}</pre>
                </div>
                <div className="app-claude-session-trace-card__section">
                  <div className="app-claude-session-trace-card__label">发送消息内容</div>
                  <pre className="app-claude-session-trace-card__text">{entry.outboundText || "(空)"}</pre>
                </div>
                <div className="app-claude-session-trace-card__section">
                  <div className="app-claude-session-trace-card__label">关键节点</div>
                  <ul className="app-claude-session-trace-card__timeline">
                    {entry.nodes.map((node, index) => (
                      <li key={`${entry.id}_${node.label}_${index}`} className="app-claude-session-trace-card__timeline-item">
                        <span className="app-claude-session-trace-card__timeline-time">
                          {new Date(node.timestamp).toLocaleTimeString("zh-CN")}
                        </span>
                        <span className="app-claude-session-trace-card__timeline-label">{node.label}</span>
                        {node.detail ? <span className="app-claude-session-trace-card__timeline-detail">{node.detail}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))
          )}
        </div>
      </Drawer>

      <ClaudeSessionTrajectoryDrawer
        open={workTrajectoryDrawerOpen}
        onClose={() => setWorkTrajectoryDrawerOpen(false)}
        messages={session.messages}
        wiseTabSessionId={session.id}
        repositoryPath={session.repositoryPath}
        claudeSessionId={session.claudeSessionId}
        diskTranscriptPartial={session.diskTranscriptPartial}
      />

      <div className="app-claude-chat-body">
        <div className="app-claude-chat-main">

      {/* Messages */}
      {!hideMessages && (
        <div
          ref={messagesScrollRef}
          className="app-claude-messages"
          tabIndex={-1}
          role="log"
          aria-label="对话消息"
          onPointerDownCapture={() => {
            const ae = document.activeElement;
            if (ae instanceof Element && ae.closest("[data-wise-composer-root] .ProseMirror")) {
              return;
            }
            messagesScrollRef.current?.focus({ preventScroll: true });
          }}
          onBlur={handleMessagesBlur}
        >
          {session.diskTranscriptPartial && onReloadFullDiskTranscript ? (
            <Alert
              className="app-claude-messages-disk-partial-alert"
              type="info"
              showIcon
              message="当前为磁盘会话记录的尾部加载（节省内存）。若需查看更早轮次，可加载完整历史。"
              action={
                <Space>
                  <Button
                    size="small"
                    loading={fullTranscriptLoading}
                    onClick={() => {
                      setFullTranscriptLoading(true);
                      void Promise.resolve(onReloadFullDiskTranscript(session.id)).finally(() => {
                        setFullTranscriptLoading(false);
                      });
                    }}
                  >
                    加载完整历史
                  </Button>
                </Space>
              }
            />
          ) : null}
          {session.messages.length === 0 ? (
            <div className="app-claude-messages-empty">
              <p>发送消息开始与 Claude Code 对话</p>
            </div>
          ) : (
            <>
              {session.messages.flatMap((msg, originalIndex) => {
                if (!hasRenderableChatMessageBody(msg)) return [];
                const streamingThisBubble =
                  session.status === "running" &&
                  msg.role === "assistant" &&
                  originalIndex === session.messages.length - 1;
                const toolUser = isToolOnlyUserMessage(msg);
                const prevRenderableIndex = indexOfPreviousRenderableMessage(
                  session.messages,
                  originalIndex,
                );
                const prevInSession =
                  prevRenderableIndex >= 0 ? session.messages[prevRenderableIndex] : undefined;
                const mergedWithPrevious =
                  prevInSession !== undefined &&
                  getMessageSenderGroupKey(prevInSession) === getMessageSenderGroupKey(msg);
                return [
                  <ClaudeChatMessageRow
                    key={msg.id}
                    msg={msg}
                    streamingThisBubble={streamingThisBubble}
                    mergedWithPrevious={mergedWithPrevious}
                    toolUser={toolUser}
                    onOpenTaskDetail={onOpenTaskDetail}
                  />,
                ];
              })}
              {showListEndThinkingHint ? (
                <div className="app-claude-messages-end-thinking">
                  <StreamingReplyHint />
                </div>
              ) : null}
            </>
          )}
        </div>
      )}
      {panelBelowMessages}

      {showPendingTaskQueue ? (
        <div className="app-pending-task-queue-anchor">
          <PendingTaskQueuePanel
            sessionStatus={session.status}
            tasks={pendingTasks}
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

      {!hideMessages ? (
        <Tooltip title={buildClaudeSessionHoverTitle(session)} placement="top" mouseEnterDelay={0.35}>
        <div className="app-session-owner-panel">
          <span className={`app-session-owner-panel__tag app-session-owner-panel__tag--${sessionOwnerInfo.type}`}>
            {sessionOwnerInfo.typeLabel}
          </span>
          {sessionOwnerInfo.name.trim() ? (
            <span className="app-session-owner-panel__text">{sessionOwnerInfo.name}</span>
          ) : null}
          {session.status === "running" || session.status === "connecting" ? (
            <Tooltip title="结束当前 Claude Code 运行（与输入区结束按钮相同）" placement="bottom" mouseEnterDelay={0.35}>
              <button
                type="button"
                className="app-session-owner-panel__end-btn"
                aria-label="结束当前运行"
                onClick={() => onCancel()}
              >
                结束
              </button>
            </Tooltip>
          ) : null}
          {effectiveReturnMainSessionId ? (
            <Tooltip title="返回主会话" placement="bottom">
              <button
                type="button"
                className="app-session-owner-panel__return-btn"
                aria-label="返回主会话"
                onClick={handleReturnMainSession}
              >
                <svg viewBox="0 0 16 16" aria-hidden>
                  <path
                    d="M7 4L4.5 6.5L7 9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M5 6.5H9.2C11.3 6.5 13 8.2 13 10.3C13 12.4 11.3 14 9.2 14H5.8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </Tooltip>
          ) : null}
        </div>
        </Tooltip>
      ) : null}

      {sessionUnreadNotificationRows.length > 0 ? (
        <div className="app-session-notification-dock">
          {notificationPanelCollapsed ? (
            <button
              type="button"
              className="app-session-notification-dock__collapsed-trigger"
              aria-expanded={false}
              aria-label="展开消息通知"
              onClick={() => {
                setNotificationPanelCollapsed(false);
              }}
            >
              <BellOutlined aria-hidden />
              <span
                className={`app-session-notification-dock__collapsed-badge${notificationBadgePulse ? " app-session-notification-dock__collapsed-badge--pulse" : ""}`}
              >
                {sessionUnreadCount > 99 ? "99+" : sessionUnreadCount}
              </span>
            </button>
          ) : (
            <div className="app-session-notification-panel" role="region" aria-label="消息通知">
              <div className="app-session-notification-panel__head">
                <span className="app-session-notification-panel__title-wrap">
                  <span className="app-session-notification-panel__title">消息通知</span>
                  <span
                    className={`app-session-notification-panel__count${notificationTitleCountPulse ? " app-session-notification-panel__count--pulse" : ""}`}
                    aria-label={`${sessionUnreadCount} 条未读`}
                  >
                    {sessionUnreadCount > 99 ? "99+" : sessionUnreadCount}
                  </span>
                </span>
                <div className="app-session-notification-panel__head-actions">
                  <button
                    type="button"
                    className="app-session-notification-panel__collapse-btn"
                    aria-label="收起消息通知面板"
                    onClick={() => {
                      setNotificationPanelCollapsed(true);
                    }}
                  >
                    收起
                  </button>
                  <button
                    type="button"
                    className="app-session-notification-panel__refresh-btn"
                    onClick={() => {
                      void loadNotificationRows();
                    }}
                    disabled={notificationLoading}
                  >
                    {notificationLoading ? "刷新中..." : "刷新"}
                  </button>
                  <div className="app-session-notification-panel__head-trailing">
                    <button
                      type="button"
                      className="app-session-notification-panel__mark-all-read-btn"
                      disabled={notificationLoading}
                      onClick={() => {
                        handleNotificationMarkAllRead();
                      }}
                    >
                      全部已读
                    </button>
                  </div>
                </div>
              </div>
              <div className="app-session-notification-panel__body">
                <div className="app-session-notification-panel__list">
                  {sessionUnreadNotificationRows.map((row) => {
                    const notificationBodyDisplay = formatNotificationInboxDisplayLine({
                      body: row.body,
                      conversationId: row.conversationId,
                      sessions,
                      repositoryDisplayNameForInbound: session.repositoryName ?? "",
                    });
                    const titleLines = `${notificationBodyDisplay}\n原文：${row.body}\n${row.conversationId}${row.createdAt ? ` · ${row.createdAt}` : ""}`;
                    return (
                    <div
                      key={row.id}
                      className={`app-session-notification-panel__item ${row.readAt ? "app-session-notification-panel__item--read" : ""}${notificationBubbleEnterIds.has(row.id) ? " app-session-notification-panel__item--bubble-enter" : ""}`}
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        className="app-session-notification-panel__item-hit"
                        title={titleLines}
                        onClick={() => {
                          handleNotificationJump(row);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleNotificationJump(row);
                          }
                        }}
                      >
                        <span className="app-session-notification-panel__dot" aria-hidden />
                        <div className="app-session-notification-panel__item-main">
                          <div className="app-session-notification-panel__item-body">{notificationBodyDisplay}</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="app-session-notification-panel__item-read-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleNotificationMarkRead(row);
                        }}
                      >
                        已读
                      </button>
                    </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}

      <div className="app-claude-chat-bottom">
      <SessionQuickActionsBar
        onCreateNewSession={onCreateNewSession}
        onOpenBuiltinAssistant={onOpenBuiltinAssistant}
        onOpenWorkTrajectory={() => setWorkTrajectoryDrawerOpen(true)}
        showWorktreeInMore={Boolean(session.repositoryPath)}
        onOpenWorktreeMenu={() => {
          setGitWorktreePopoverOpen(true);
          void loadLinkedWorktrees();
        }}
        pushControl={
          <Popover
            trigger="click"
            placement="topLeft"
            open={pushPopoverOpen}
            onOpenChange={(open) => setPushPopoverOpen(open)}
            overlayClassName="app-push-popover"
            content={
              <div className="app-push-popover__content">
                <div className="app-push-popover__title">推送前提交总结（AI 生成草稿）</div>
                {pushSummaryLoading ? (
                  <div className="app-push-popover__loading">
                    <Spin size="small" />
                    <span>{pushSummaryPhase || "正在生成提交总结..."}</span>
                  </div>
                ) : null}
                <textarea
                  className="app-push-popover__textarea"
                  value={pushSummaryDraft}
                  onChange={(event) => setPushSummaryDraft(event.target.value)}
                  placeholder="正在生成提交总结..."
                  disabled={pushSummaryLoading || pushSubmitting}
                />
                <div className="app-push-popover__footer">
                  <button
                    type="button"
                    className="app-push-popover__submit"
                    onClick={() => void handlePushSubmit()}
                    disabled={pushSummaryLoading || pushSubmitting}
                  >
                    {pushSubmitting ? "推送中..." : "推送"}
                  </button>
                </div>
              </div>
            }
          >
            <button
              type="button"
              className="app-session-quick-pill app-session-quick-pill--push"
            >
              <span className="app-session-quick-pill__icon app-session-quick-pill__icon--green" aria-hidden>
                <CloudUploadOutlined />
              </span>
              <span className="app-session-quick-pill__label">推送</span>
              <span
                className={`app-session-quick-pill__stats${reviewGitStatsPulse ? " app-session-quick-pill__stats--pulse" : ""}`}
              >
                <span className="app-session-quick-pill__add">+{stats.additions}</span>
                <span className="app-session-quick-pill__del">-{stats.deletions}</span>
              </span>
            </button>
          </Popover>
        }
      />

      {session.repositoryPath ? (
        <Modal
          title="本仓库额外 worktree"
          open={gitWorktreePopoverOpen}
          onCancel={() => setGitWorktreePopoverOpen(false)}
          footer={null}
          width={520}
          destroyOnHidden
          className="app-gitworktree-modal"
        >
          <div className="app-gitworktree-popover__content">
            {gitWorktreeLoading ? (
              <div className="app-gitworktree-popover__loading">
                <Spin size="small" />
                <span>加载中...</span>
              </div>
            ) : linkedWorktrees.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无额外 worktree" />
            ) : (
              <ul className="app-gitworktree-popover__list">
                {linkedWorktrees.map((w) => (
                  <li key={w.path} className="app-gitworktree-popover__item">
                    <div className="app-gitworktree-popover__item-main">
                      <div className="app-gitworktree-popover__branch">{formatWorktreeBranchLabel(w.branch)}</div>
                      <div className="app-gitworktree-popover__path" title={w.path}>
                        {formatWorktreePathRelative(session.repositoryPath ?? "", w.path)}
                      </div>
                    </div>
                    <div className="app-gitworktree-popover__item-actions">
                      <Tooltip title="在系统文件管理器中打开此目录">
                        <Button type="link" size="small" onClick={() => handleOpenWorktreeInFinder(w.path)}>
                          打开目录
                        </Button>
                      </Tooltip>
                      {onAddWorktreeRepositoryToProject ? (
                        <Tooltip title="加入左侧当前项目，便于在仓库列表中切换">
                          <Button
                            type="link"
                            size="small"
                            loading={gitWorktreeAddingToProjectPath === w.path}
                            disabled={
                              (gitWorktreeAddingToProjectPath !== null &&
                                gitWorktreeAddingToProjectPath !== w.path) ||
                              (gitWorktreeRemovingPath !== null && gitWorktreeRemovingPath !== w.path)
                            }
                            onClick={() => void handleAddWorktreeToProject(w.path)}
                          >
                            加入项目
                          </Button>
                        </Tooltip>
                      ) : null}
                      <Popconfirm
                        title="撤回此 worktree？"
                        description="将执行 git worktree remove --force，并删除该 worktree 对应的工作区目录。"
                        okText="确定"
                        cancelText="取消"
                        styles={{ container: { width: "min(92vw, 300px)", maxWidth: "min(92vw, 300px)" } }}
                        onConfirm={() => void handleGitWorktreeRemove(w.path)}
                      >
                        <Button
                          type="link"
                          size="small"
                          danger
                          loading={gitWorktreeRemovingPath === w.path}
                          disabled={
                            (gitWorktreeRemovingPath !== null && gitWorktreeRemovingPath !== w.path) ||
                            (gitWorktreeAddingToProjectPath !== null &&
                              gitWorktreeAddingToProjectPath !== w.path)
                          }
                        >
                          撤销
                        </Button>
                      </Popconfirm>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      ) : null}

      {/* Composer：高度写入 --app-composer-tray-h，供快捷条定位；后台 invocation 仅保留抽屉（无浮层摘要） */}
      <div ref={composerTrayRef} className="app-claude-composer-tray">
        <BackgroundInvocationDock session={session} />

        <ComposerRegion
          session={session}
          gitRepositoryPath={gitRepositoryPath}
          employeesForDispatchRoute={employees}
          pendingExecutionTaskCount={pendingTasks.length}
          onExecute={handleComposerExecute}
          onSessionModelChange={onSessionModelChange}
          onSessionConnectionKindChange={onSessionConnectionKindChange}
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
          onClearTodos={onClearTodos}
          onClearFollowups={onClearFollowups}
          onClearRevertItems={onClearRevertItems}
          onSendFollowup={onSendFollowup}
          onRestoreRevert={onRestoreRevert}
          employeeMentions={mentionEmployees.map((item) => ({ id: item.id, name: item.name }))}
          teamMentions={publishedTeamMentions}
          projectRoleTagOptions={projectRoleTagOptions}
          projectRepositoryMentionOptions={projectRepositoryMentionOptions}
          hideEmployeesInAtMode={hideEmployeesInAtMode}
          onEnqueueAsPendingTask={(payload) => addTask(payload)}
          onTrackSendFlow={(entry) => {
            if (entry.sessionId !== session.id) return;
            const traceItem: SessionSendTraceEntry = {
              id: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              sessionId: entry.sessionId,
              createdAt: Date.now(),
              composerText: entry.composerText,
              outboundText: entry.outboundText,
              nodes: entry.nodes,
            };
            setSessionSendTraces((prev) => [traceItem, ...prev].slice(0, 50));
          }}
          dualPaneRepositoryPicker={dualPaneRepositoryPicker}
          missionContext={missionContext}
          compactContext={
            onCompactSessionHistory
              ? {
                  canCompact: canCompactSessionHistory,
                  inFlight: compactHistoryInFlight,
                  ctxPercent: sessionContextMetrics.ctxPercent,
                  tooltip: compactSessionTooltip,
                  onCompact: handleCompactSessionHistory,
                }
              : undefined
          }
        />

      </div>
      </div>
        </div>
      </div>
    </div>
  );
}

function resolveSessionOwnerInfo(input: {
  session: ClaudeSession;
  workflowTasks: WorkflowTaskItem[];
  workflowTemplates: WorkflowTemplateItem[];
  taskPendingEmployeesByTaskId: Record<string, Array<{ employeeId: string; name: string }>>;
  ownerHint: SessionOwnerHint | null;
}): { type: "main" | "employee" | "team"; typeLabel: string; name: string } {
  const { session, workflowTasks, workflowTemplates, taskPendingEmployeesByTaskId, ownerHint } = input;
  if (ownerHint) {
    return {
      type: ownerHint.type,
      typeLabel: ownerHint.type === "employee" ? "员工会话" : "团队会话",
      name: ownerHint.name,
    };
  }
  const employeeNameFromRepo = extractBoundEmployeeNameFromDisplay(session.repositoryName ?? "");
  const employeeNameFromPreview = extractEmployeeNameFromBracketPreview(session.diskPreview);
  const employeeName = employeeNameFromRepo ?? employeeNameFromPreview;
  if (employeeName) {
    return {
      type: "employee",
      typeLabel: "员工会话",
      name: employeeName,
    };
  }
  const omcCommand = extractOmcCommandFromUserPrompt(session);
  if (omcCommand) {
    return {
      type: "employee",
      typeLabel: "员工会话",
      name: `OMC员工 · ${omcCommand}`,
    };
  }

  const latestUserText = getLatestUserPlainText(session);
  const isTeamAutoDriver = TEAM_AUTO_DRIVER_PREFIXES.some((prefix) => latestUserText.startsWith(prefix));
  if (isTeamAutoDriver) {
    const latestTask = [...workflowTasks].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const workflowTemplateById = new Map(workflowTemplates.map((item) => [item.id, item.name] as const));
    const teamName =
      (latestTask ? workflowTemplateById.get(latestTask.workflowId) : undefined) ??
      getLatestDispatchedTeamName(session) ??
      "团队流程";
    const pendingEmployees = latestTask ? taskPendingEmployeesByTaskId[latestTask.id] ?? [] : [];
    const currentEmployeeName = pendingEmployees[0]?.name?.trim();
    return {
      type: "team",
      typeLabel: "团队会话",
      name: currentEmployeeName ? `${teamName} · 当前：${currentEmployeeName}` : teamName,
    };
  }

  return {
    type: "main",
    typeLabel: "主会话",
    name: "",
  };
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5V12L15.5 13.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
