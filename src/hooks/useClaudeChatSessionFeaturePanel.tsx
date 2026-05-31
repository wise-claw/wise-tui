import {
  Button,
  Tooltip,
  message,
  Modal,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { ClaudeChatSessionFeaturePanelProps } from "../components/ClaudeSessions/ClaudeChatSessionFeaturePanel";
import type { ClaudeChatSessionFeatureToolbarProps } from "../components/ClaudeSessions/ClaudeChatSessionFeatureToolbar";
import type { ClaudeChatSessionTaskListDrawerProps } from "../components/ClaudeSessions/ClaudeChatSessionTaskListDrawer";
import type { ClaudeChatSessionTraceDrawerProps } from "../components/ClaudeSessions/ClaudeChatSessionTraceDrawer";
import {
  FEATURE_SESSION_LIST_PAGE_SIZE,
  SHOW_SESSION_TASK_COMPLETION_FEATURE,
  SESSION_SEND_TRACE_PERSIST_MAX,
  trellisTaskRowKey,
  type RepositorySessionExecutionRow,
  type SessionSendTraceEntry,
  type SessionUserQuestionRow,
  type RefreshHistorySessionsScope,
  type TaskCompletionOwnerFilter,
  type TaskCompletionStatusFilter,
} from "../components/ClaudeSessions/ClaudeChatSessionFeaturePanel";
import { scheduleDirectOmcBatchAfterMacrotask } from "../services/omcDirectBatchExecution";
import { requestWorkflowRunRefresh, useWorkflowRun } from "../hooks/useWorkflowRun";
import { getWorkflowFacade } from "../services/workflow";
import { runSplitTasksOmcBatch } from "../services/workflow/actions";
import { resolveTrellisSubagentForStage } from "../services/workflow/trellisDefaults";
import {
  isDirectOmcBatchTemplateId,
  TRELLIS_BATCH_TEMPLATE_ID,
  type OmcBatchTemplateId,
} from "../constants/omcBatchTemplates";
import { loadPrdTaskSplitResult, savePrdTaskSplitResult } from "../services/prdTaskSplitStore";
import {
  archiveTrellisTask,
  listProjectRequirementWorkspace,
  type TrellisRequirementTaskRow,
} from "../services/trellisTaskBridge";
import { refreshSplitResultDerivedFields } from "../services/taskSplitter";
import { getRepositoryBaseDisplayName } from "../utils/sessionRepositoryDisplay";
import { resolveOwnerHintForSession } from "../utils/sessionOwnerHints";
import type { SessionOwnerHint } from "../utils/sessionOwnerHints";
import { removeSplitResultTasksByIds } from "../utils/removeSplitResultTasksByIds";
import { notifySplitTodoCountUpdated } from "../utils/notifySplitTodoCountUpdated";
import {
  countDrawerExecutableTasks,
  listDrawerTrellisTasks,
} from "../utils/taskDrawerCounts";
import { buildOmcBatchTaskIntentOneLiner } from "../utils/omcBatchTaskIntentOneLiner";
import {
  isSessionBoundAsRepositoryMain,
  repositoryPathsMatch,
} from "../utils/repositoryMainSessionBinding";
import {
  dedupeClaudeSessionsByIdentity,
  listSessionsForRepositoryPath,
} from "../utils/sessionHistoryScope";
import { getAppSetting, setAppSetting } from "../services/appSettingsStore";
import {
  buildTaskExecutionPrompt,
  getSessionPreview,
  normalizeSplitTaskListFlowStatus,
  splitTaskListBinaryLabel,
} from "../components/ClaudeSessions/claudeChatHelpers";
import { getSessionUpdatedAt, groupSessionsByDay, sliceGroupedSessions, type SessionGroup } from "../components/ClaudeSessions/sessionGrouping";
import { isToolOnlyUserMessage, userMessagePlainTextForDisplay } from "../utils/claudeChatMessageDisplay";
import {
  WORKFLOW_UI_EVENT_FOCUS_TASK_TOOL,
  WORKFLOW_UI_EVENT_OMC_BATCH_RUNTIME_CHANGED,
  WORKFLOW_UI_EVENT_SPLIT_TODO_COUNT_UPDATED,
  type SplitTodoCountUpdatedDetail,
  type WorkflowOmcBatchRuntimeDetail,
} from "../constants/workflowUiEvents";
import type {
  ClaudeSession,
  EmployeeItem,
  PendingExecutionTask,
  ProjectItem,
  Repository,
  TaskFlowStatus,
  TaskItem,
  WorkflowTaskItem,
  WorkflowTemplateItem,
} from "../types";
import {
  buildTrellisTaskExecutionPrompt,
  EMPTY_STRING_LIST,
  EMPTY_TASK_LIST,
  executionStatusTagColor,
  formatCompletionActivityTime,
  getSessionTraceStorageKey,
  mapClaudeExecutionStatusLabel,
  resolveSessionOwnerInfo,
  rowMatchesCompletionSearch,
  TASK_LIST_MAX_SELECTED,
} from "./claudeChatSessionFeaturePanelHelpers";

const EMPTY_HISTORY_GROUPS: SessionGroup[] = [];
const EMPTY_EXECUTION_ROWS: RepositorySessionExecutionRow[] = [];

export interface UseClaudeChatSessionFeaturePanelInput {
  session: ClaudeSession;
  sessions: ClaudeSession[];
  allSessionsForHistory?: ClaudeSession[];
  repositories: Repository[];
  activeRepository?: Repository | null;
  activeProject?: ProjectItem | null;
  sessionOwnerHints: Record<string, SessionOwnerHint>;
  mentionEmployees: EmployeeItem[];
  workflowTasks: WorkflowTaskItem[];
  workflowTemplates: WorkflowTemplateItem[];
  workflowGraphStatusByWorkflowId: Record<string, string>;
  taskPendingEmployeesByTaskId: Record<string, Array<{ employeeId: string; name: string }>>;
  repositoryScopePath: string;
  sessionRepository: Repository | null;
  repositoryMainBindings: Record<string, string>;
  taskListConcurrentCapacity?: number;
  omcBatchAnchorSessionId: string;
  omcBatchUserAbortRef: MutableRefObject<boolean>;
  omcBatchInFlightRef: MutableRefObject<boolean>;
  hideSessionTools?: boolean;
  scrollToSessionMessageId: (messageId: number) => void;
  scrollMessageTargetIntoView: (target: Element | null) => boolean;
  onSwitchSession?: (
    sessionId: string,
    options?: { collapseSessionNotificationPanel?: boolean },
  ) => void;
  onExecute: (
    sessionId: string,
    prompt: string,
    dispatchTarget?: Pick<PendingExecutionTask, "targetType" | "targetEmployeeName" | "targetWorkflowId" | "targetWorkflowName">,
  ) => boolean | void | Promise<boolean | void>;
  onOpenRepositoryScheduledTasks?: () => void;
  onRefreshHistorySessions?: (scope: RefreshHistorySessionsScope) => void | Promise<void>;
  onDeleteHistorySession?: (sessionId: string) => Promise<void>;
  onOpenHistorySessionInInspector?: (sessionId: string) => void;
  onRestoreHistorySessionAsMain?: (sessionId: string) => void | Promise<void>;
  resolveTaskListOmcInvokeConcurrency?: (session: ClaudeSession) => {
    concurrencyScopeKey: string;
    concurrencyLimit: number;
  } | null;
  onAppendSystemMessage?: (sessionId: string, text: string) => void;
  onAppendUserMessage?: (sessionId: string, text: string) => void;
  onNotifyOmcEmployeeDirectBatchTaskDone?: (input: {
    repositoryPath: string;
    repositoryDisplayName: string;
    employeeMessage: string;
  }) => void;
  onPrepareFreshOmcEmployeeWorkerForDirectBatch?: (input: {
    repositoryPath: string;
    repositoryDisplayName: string;
  }) => void | Promise<void>;
}

export interface UseClaudeChatSessionFeaturePanelResult {
  featurePanelProps: ClaudeChatSessionFeaturePanelProps;
  appendSessionSendTrace: (entry: {
    sessionId: string;
    composerText: string;
    outboundText: string;
    nodes: SessionSendTraceEntry["nodes"];
  }) => void;
}

export function useClaudeChatSessionFeaturePanel(input: UseClaudeChatSessionFeaturePanelInput): UseClaudeChatSessionFeaturePanelResult {
  const {
    session,
    sessions,
    allSessionsForHistory,
    repositories,
    activeRepository,
    activeProject,
    sessionOwnerHints,
    mentionEmployees,
    workflowTasks,
    workflowTemplates,
    workflowGraphStatusByWorkflowId,
    taskPendingEmployeesByTaskId,
    repositoryScopePath,
    sessionRepository,
    repositoryMainBindings,
    taskListConcurrentCapacity,
    omcBatchAnchorSessionId,
    omcBatchUserAbortRef,
    omcBatchInFlightRef,
    hideSessionTools = false,
    scrollToSessionMessageId,
    scrollMessageTargetIntoView,
    onSwitchSession,
    onExecute,
    onOpenRepositoryScheduledTasks,
    onRefreshHistorySessions,
    onDeleteHistorySession,
    onOpenHistorySessionInInspector,
    onRestoreHistorySessionAsMain,
    resolveTaskListOmcInvokeConcurrency,
    onAppendSystemMessage,
    onAppendUserMessage,
    onNotifyOmcEmployeeDirectBatchTaskDone,
    onPrepareFreshOmcEmployeeWorkerForDirectBatch,
  } = input;

  const { run: workflowRun } = useWorkflowRun(session.id, session.repositoryPath);

  const [splitTodoTasks, setSplitTodoTasks] = useState<TaskItem[]>([]);
    const [trellisTasks, setTrellisTasks] = useState<TrellisRequirementTaskRow[]>([]);
    const [trellisTasksLoading, setTrellisTasksLoading] = useState(false);
    const [trellisTaskFocus, setTrellisTaskFocus] = useState<{
      parentTaskName: string | null;
      childTaskNames: string[];
    } | null>(null);
    const taskDrawerTrellisScope = useMemo(
      () => ({
        repositoryId: activeRepository?.id ?? null,
        focus: trellisTaskFocus,
      }),
      [activeRepository?.id, trellisTaskFocus],
    );
    const visibleTrellisTasks = useMemo(
      () => listDrawerTrellisTasks(trellisTasks, taskDrawerTrellisScope),
      [taskDrawerTrellisScope, trellisTasks],
    );
    const taskDrawerCounts = useMemo(
      () => countDrawerExecutableTasks(splitTodoTasks, trellisTasks, taskDrawerTrellisScope),
      [splitTodoTasks, taskDrawerTrellisScope, trellisTasks],
    );
    const taskDrawerCount = taskDrawerCounts.total;
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
        setTrellisTasks(snapshot.tasks);
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
    const historyLoadMoreRafRef = useRef<number | null>(null);
    const historyLoadMoreLockedRef = useRef(false);
    /** 历史会话删除二次确认 Modal 打开期间，忽略 Popover 的外部点击关闭 */
    const historyPopoverCloseGuardRef = useRef(false);
    const [sessionTraceDrawerOpen, setSessionTraceDrawerOpen] = useState(false);
    const [sessionSendTraces, setSessionSendTraces] = useState<SessionSendTraceEntry[]>([]);
    const [taskCompletionModalOpen, setTaskCompletionModalOpen] = useState(false);
    const [completionSearchText, setCompletionSearchText] = useState("");
    const [completionOwnerFilter, setCompletionOwnerFilter] = useState<TaskCompletionOwnerFilter>("all");
    const [completionStatusFilter, setCompletionStatusFilter] = useState<TaskCompletionStatusFilter>("all");
    const [completionVisibleCount, setCompletionVisibleCount] = useState(FEATURE_SESSION_LIST_PAGE_SIZE);
    const completionTableWrapRef = useRef<HTMLDivElement>(null);
    const completionFilteredLengthRef = useRef(0);

    const taskCompletionDataActive =
      SHOW_SESSION_TASK_COMPLETION_FEATURE && taskCompletionModalOpen;

    const repositorySessionExecutionRows = useMemo((): RepositorySessionExecutionRow[] => {
      if (!taskCompletionDataActive) {
        return EMPTY_EXECUTION_ROWS;
      }
      const path = session.repositoryPath;
      const sameRepo = sessions.filter((s) => repositoryPathsMatch(s.repositoryPath, path));
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
      taskCompletionDataActive,
      sessions,
      session.repositoryPath,
      workflowTasks,
      workflowTemplates,
      taskPendingEmployeesByTaskId,
      sessionOwnerHints,
    ]);

    const taskCompletionTableColumns: ColumnsType<RepositorySessionExecutionRow> = useMemo(
      () => {
        if (!taskCompletionDataActive) {
          return [];
        }
        return [
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
      ];
      },
      [taskCompletionDataActive, onSwitchSession, setTaskCompletionModalOpen],
    );

    const completionFilteredRows = useMemo(() => {
      if (!taskCompletionDataActive) {
        return EMPTY_EXECUTION_ROWS;
      }
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
      taskCompletionDataActive,
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
    const historySessionSource = allSessionsForHistory ?? sessions;
    const historyListActive = historyPopoverOpen || historySessionsRefreshing;
    const repositoryHistorySessions = useMemo(
      () => {
        if (!historyListActive) {
          return [] as ClaudeSession[];
        }
        return dedupeClaudeSessionsByIdentity(listSessionsForRepositoryPath(historySessionSource, repositoryScopePath)).sort(
          (a, b) => getSessionUpdatedAt(b) - getSessionUpdatedAt(a),
        );
      },
      [historyListActive, historySessionSource, repositoryScopePath],
    );
    const repositoryHistorySessionsForDisplay = useMemo(
      () => {
        if (!historyListActive) {
          return [] as ClaudeSession[];
        }
        return repositoryHistorySessions.filter((item) => {
          if (item.messages.length > 0) {
            return true;
          }
          return Boolean(item.diskPreview?.trim());
        });
      },
      [historyListActive, repositoryHistorySessions],
    );

    const filteredHistorySessions = useMemo(() => {
      if (!historyListActive) {
        return [] as ClaudeSession[];
      }
      const keyword = historySearchText.trim().toLocaleLowerCase("zh-CN");
      if (!keyword) {
        return repositoryHistorySessionsForDisplay;
      }
      return repositoryHistorySessionsForDisplay.filter((item) => {
        const preview = getSessionPreview(item).toLocaleLowerCase("zh-CN");
        const repositoryName = item.repositoryName.toLocaleLowerCase("zh-CN");
        return preview.includes(keyword) || repositoryName.includes(keyword);
      });
    }, [historyListActive, repositoryHistorySessionsForDisplay, historySearchText]);

    const filteredHistoryLengthRef = useRef(0);
    filteredHistoryLengthRef.current = filteredHistorySessions.length;

    const groupedHistorySessionsAll = useMemo(
      () => {
        if (!historyListActive) {
          return EMPTY_HISTORY_GROUPS;
        }
        return groupSessionsByDay(filteredHistorySessions);
      },
      [historyListActive, filteredHistorySessions],
    );
    const groupedHistorySessions = useMemo(
      () => {
        if (!historyListActive) {
          return EMPTY_HISTORY_GROUPS;
        }
        return sliceGroupedSessions(groupedHistorySessionsAll, historyVisibleCount);
      },
      [historyListActive, groupedHistorySessionsAll, historyVisibleCount],
    );

    const canRestoreHistorySession = useCallback(
      (targetSession: ClaudeSession) => {
        if (!onRestoreHistorySessionAsMain) return false;
        return !isSessionBoundAsRepositoryMain(targetSession, repositoryMainBindings, sessions, repositories ?? []);
      },
      [onRestoreHistorySessionAsMain, repositoryMainBindings, sessions, repositories],
    );

    const historyRefreshInFlightRef = useRef(false);
    const handleHistorySessionsRefresh = useCallback(() => {
      if (!onRefreshHistorySessions || historyRefreshInFlightRef.current) return;
      const scopePath = repositoryScopePath.trim();
      if (!scopePath) return;
      historyRefreshInFlightRef.current = true;
      setHistorySessionsRefreshing(true);
      void Promise.resolve(
        onRefreshHistorySessions({
          repositoryPath: scopePath,
          repositoryName: sessionRepository?.name?.trim() || session.repositoryName.trim() || scopePath,
        }),
      )
        .catch(() => {
          message.error("刷新历史会话失败");
        })
        .finally(() => {
          historyRefreshInFlightRef.current = false;
          setHistorySessionsRefreshing(false);
        });
    }, [onRefreshHistorySessions, repositoryScopePath, session.repositoryName, sessionRepository?.name]);

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
      historyLoadMoreLockedRef.current = false;
    }, [historyVisibleCount, filteredHistorySessions.length, historyPopoverOpen]);

    useEffect(() => {
      if (!historyPopoverOpen) return;
      const el = historyPopoverScrollRef.current;
      if (!el) return;
      const tryLoadMore = () => {
        const max = filteredHistoryLengthRef.current;
        if (max <= 0) return;
        const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
        if (!nearBottom) {
          historyLoadMoreLockedRef.current = false;
          return;
        }
        if (historyLoadMoreLockedRef.current) {
          return;
        }
        historyLoadMoreLockedRef.current = true;
        setHistoryVisibleCount((n) => {
          const next = Math.min(n + FEATURE_SESSION_LIST_PAGE_SIZE, max);
          if (next === n) {
            historyLoadMoreLockedRef.current = false;
          }
          return next;
        });
      };
      const handler = () => {
        if (historyLoadMoreRafRef.current !== null) return;
        historyLoadMoreRafRef.current = window.requestAnimationFrame(() => {
          historyLoadMoreRafRef.current = null;
          tryLoadMore();
        });
      };
      tryLoadMore();
      el.addEventListener("scroll", handler, { passive: true });
      return () => {
        el.removeEventListener("scroll", handler);
        if (historyLoadMoreRafRef.current !== null) {
          window.cancelAnimationFrame(historyLoadMoreRafRef.current);
          historyLoadMoreRafRef.current = null;
        }
      };
    }, [historyPopoverOpen, filteredHistorySessions.length]);

    useEffect(() => {
      return () => {
        if (historyLoadMoreRafRef.current !== null) {
          window.cancelAnimationFrame(historyLoadMoreRafRef.current);
          historyLoadMoreRafRef.current = null;
        }
      };
    }, []);
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
    const taskListDrawerDataActive = taskListDrawerOpen;
    const filteredTaskList = useMemo(() => {
      if (!taskListDrawerDataActive) {
        return EMPTY_TASK_LIST;
      }
      if (taskListStatusFilter === "todo") return splitTodoTasks.filter((task) => task.flowStatus === "todo");
      if (taskListStatusFilter === "done") return splitTodoTasks.filter((task) => task.flowStatus === "done");
      const todos = splitTodoTasks.filter((task) => task.flowStatus === "todo");
      const dones = splitTodoTasks.filter((task) => task.flowStatus === "done");
      return [...todos, ...dones];
    }, [taskListDrawerDataActive, splitTodoTasks, taskListStatusFilter]);
    const taskListSelectableSliceIds = useMemo(
      () => {
        if (!taskListDrawerDataActive) {
          return EMPTY_STRING_LIST;
        }
        return filteredTaskList.slice(0, taskListMultiSelectCap).map((task) => task.id);
      },
      [taskListDrawerDataActive, filteredTaskList, taskListMultiSelectCap],
    );
    const taskListSelectedSet = useMemo(() => new Set(taskListSelectedIds), [taskListSelectedIds]);
    const taskListAllFilteredSelected = useMemo(() => {
      if (!taskListDrawerDataActive) {
        return false;
      }
      if (taskListSelectableSliceIds.length === 0) return false;
      if (taskListSelectedIds.length !== taskListSelectableSliceIds.length) return false;
      return taskListSelectableSliceIds.every((id) => taskListSelectedSet.has(id));
    }, [taskListDrawerDataActive, taskListSelectableSliceIds, taskListSelectedIds, taskListSelectedSet]);
    const trellisTaskSelectableKeys = useMemo(
      () => {
        if (!taskListDrawerDataActive) {
          return EMPTY_STRING_LIST;
        }
        return visibleTrellisTasks.slice(0, taskListMultiSelectCap).map((task) => trellisTaskRowKey(task));
      },
      [taskListDrawerDataActive, visibleTrellisTasks, taskListMultiSelectCap],
    );
    const trellisTaskSelectedSet = useMemo(() => new Set(trellisTaskSelectedKeys), [trellisTaskSelectedKeys]);
    const trellisTaskAllSelected = useMemo(() => {
      if (!taskListDrawerDataActive) {
        return false;
      }
      if (trellisTaskSelectableKeys.length === 0) return false;
      if (trellisTaskSelectedKeys.length !== trellisTaskSelectableKeys.length) return false;
      return trellisTaskSelectableKeys.every((key) => trellisTaskSelectedSet.has(key));
    }, [taskListDrawerDataActive, trellisTaskSelectableKeys, trellisTaskSelectedKeys, trellisTaskSelectedSet]);
    const selectedTrellisTasks = useMemo(
      () => {
        if (!taskListDrawerDataActive) {
          return [] as TrellisRequirementTaskRow[];
        }
        return visibleTrellisTasks.filter((task) => trellisTaskSelectedSet.has(trellisTaskRowKey(task)));
      },
      [taskListDrawerDataActive, trellisTaskSelectedSet, visibleTrellisTasks],
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
            notifySplitTodoCountUpdated();
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
      const ok = await Promise.resolve(onExecute(session.id, buildTaskExecutionPrompt(task)));
      if (ok === false) {
        void message.error(`任务 ${task.id} 启动失败，请检查会话状态后重试。`);
        return;
      }
      void message.success(`任务 ${task.id} 已在主会话开始执行（仍为未完成，完成后请标记已完成）。`);
    }, [onExecute, session.id]);

    const handleRunTrellisTaskInMainSession = useCallback(async (task: TrellisRequirementTaskRow) => {
      const ok = await Promise.resolve(onExecute(session.id, buildTrellisTaskExecutionPrompt(task)));
      if (ok === false) {
        void message.error(`Trellis 任务 ${task.taskId} 启动失败，请检查会话状态后重试。`);
        return;
      }
      void message.success(`Trellis 任务 ${task.taskId} 已发送到主会话。`);
    }, [onExecute, session.id]);

    const handleRunTrellisTaskByEmployee = useCallback(
      async (task: TrellisRequirementTaskRow, employeeNameOverride?: string) => {
        const employeeName = (employeeNameOverride ?? trellisTaskEmployeeByKey[trellisTaskRowKey(task)] ?? "").trim();
        if (!employeeName) {
          void message.info("请先选择员工。");
          return;
        }
        const ok = await Promise.resolve(onExecute(session.id, buildTrellisTaskExecutionPrompt(task), {
          targetType: "employee",
          targetEmployeeName: employeeName,
        }));
        if (ok === false) {
          void message.error(`Trellis 任务 ${task.taskId} 派发失败，请检查终端状态后重试。`);
          return;
        }
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
      const ok = await Promise.resolve(onExecute(session.id, buildTaskExecutionPrompt(task), {
        targetType: "employee",
        targetEmployeeName: employeeName,
      }));
      if (ok === false) {
        void message.error(`任务 ${task.id} 派发失败，请检查终端状态后重试。`);
        return;
      }
      void message.success(`任务 ${task.id} 已派发给员工 ${employeeName}（仍为未完成，完成后请标记已完成）。`);
    }, [onExecute, session.id]);

    const handleRunTaskByTeam = useCallback(async (task: TaskItem) => {
      const workflowId = task.splitListWorkflowId?.trim();
      const workflowName = taskListTeamOptions.find((item) => item.id === workflowId)?.name;
      if (!workflowId || !workflowName) {
        void message.info("请先选择团队流程（选择会立即保存到拆分结果）。");
        return;
      }
      const ok = await Promise.resolve(onExecute(session.id, buildTaskExecutionPrompt(task), {
        targetType: "team",
        targetWorkflowId: workflowId,
        targetWorkflowName: workflowName,
      }));
      if (ok === false) {
        void message.error(`任务 ${task.id} 派发失败：团队流程未实际启动。`);
        return;
      }
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
          notifySplitTodoCountUpdated();
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
          notifySplitTodoCountUpdated();
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
    const sessionUserQuestions = useMemo((): SessionUserQuestionRow[] => {
      if (!userQuestionsPopoverOpen) {
        return [];
      }
      const rows: SessionUserQuestionRow[] = [];
      for (const m of session.messages) {
        if (m.role !== "user" || isToolOnlyUserMessage(m)) continue;
        const text = userMessagePlainTextForDisplay(m).trim();
        if (!text) continue;
        rows.push({ id: m.id, text, timestamp: m.timestamp });
      }
      rows.sort((a, b) => b.timestamp - a.timestamp);
      return rows;
    }, [userQuestionsPopoverOpen, session.messages]);
    const sessionTraceStorageKey = getSessionTraceStorageKey(session.id, session.repositoryPath);
    const tracePersistTimerRef = useRef<number | null>(null);

    useEffect(() => {
      if (!sessionTraceDrawerOpen) {
        setSessionSendTraces([]);
        return;
      }
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
          setSessionSendTraces(parsed.slice(0, SESSION_SEND_TRACE_PERSIST_MAX));
        } catch {
          setSessionSendTraces([]);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [sessionTraceDrawerOpen, sessionTraceStorageKey]);
    useEffect(() => {
      if (tracePersistTimerRef.current != null) {
        window.clearTimeout(tracePersistTimerRef.current);
      }
      tracePersistTimerRef.current = window.setTimeout(() => {
        void setAppSetting(sessionTraceStorageKey, JSON.stringify(sessionSendTraces.slice(0, SESSION_SEND_TRACE_PERSIST_MAX)));
        tracePersistTimerRef.current = null;
      }, 600);
      return () => {
        if (tracePersistTimerRef.current != null) {
          window.clearTimeout(tracePersistTimerRef.current);
          tracePersistTimerRef.current = null;
        }
      };
    }, [sessionSendTraces, sessionTraceStorageKey]);

  useEffect(() => {
    if (!hideSessionTools) {
      return;
    }
    setHistoryPopoverOpen(false);
    setHistorySearchText("");
  }, [hideSessionTools]);

  const traceDrawerWidth = Math.min(620, typeof window !== "undefined" ? window.innerWidth - 24 : 620);

  const closeTaskListDrawer = useCallback(() => {
    setTaskListDrawerOpen(false);
  }, []);

  const closeSessionTraceDrawer = useCallback(() => {
    setSessionTraceDrawerOpen(false);
  }, []);

  const appendSessionSendTrace = useCallback(
    (entry: {
      sessionId: string;
      composerText: string;
      outboundText: string;
      nodes: SessionSendTraceEntry["nodes"];
    }) => {
      if (entry.sessionId !== session.id) return;
      const traceItem: SessionSendTraceEntry = {
        id: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sessionId: entry.sessionId,
        createdAt: Date.now(),
        composerText: entry.composerText,
        outboundText: entry.outboundText,
        nodes: entry.nodes,
      };
      setSessionSendTraces((prev) => [traceItem, ...prev].slice(0, SESSION_SEND_TRACE_PERSIST_MAX));
    },
    [session.id],
  );

  const toolbarProps = useMemo((): ClaudeChatSessionFeatureToolbarProps => ({
    sessionId: session.id,
    sessionUserQuestions,
    historyPopoverOpen,
    setHistoryPopoverOpen,
    historyPopoverCloseGuardRef,
    setHistoryVisibleCount,
    handleHistorySessionsRefresh,
    historySearchText,
    setHistorySearchText,
    onRefreshHistorySessions,
    historySessionsRefreshing,
    groupedHistorySessions,
    onOpenHistorySessionInInspector,
    onRestoreHistorySessionAsMain,
    canRestoreHistorySession,
    onDeleteHistorySession,
    handleDeleteHistorySession,
    historyPopoverScrollRef,
    userQuestionsPopoverOpen,
    setUserQuestionsPopoverOpen,
    scrollToSessionMessageId,
    onOpenRepositoryScheduledTasks,
    taskDrawerCount,
    setTaskListStatusFilter,
    setTaskListDrawerOpen,
    setTaskCompletionModalOpen,
    taskCompletionModalOpen,
    completionOwnerFilter,
    setCompletionOwnerFilter,
    completionStatusFilter,
    setCompletionStatusFilter,
    completionSearchText,
    setCompletionSearchText,
    completionDisplayedRows,
    completionFilteredRows,
    completionHasMore,
    completionTableWrapRef,
    repositorySessionExecutionRows,
    taskCompletionTableColumns,
  }), [
    session.id,
    sessionUserQuestions,
    historyPopoverOpen,
    historyPopoverCloseGuardRef,
    handleHistorySessionsRefresh,
    historySearchText,
    onRefreshHistorySessions,
    historySessionsRefreshing,
    groupedHistorySessions,
    onOpenHistorySessionInInspector,
    onRestoreHistorySessionAsMain,
    canRestoreHistorySession,
    onDeleteHistorySession,
    handleDeleteHistorySession,
    historyPopoverScrollRef,
    userQuestionsPopoverOpen,
    scrollToSessionMessageId,
    onOpenRepositoryScheduledTasks,
    taskDrawerCount,
    taskCompletionModalOpen,
    completionOwnerFilter,
    completionStatusFilter,
    completionSearchText,
    completionDisplayedRows,
    completionFilteredRows,
    completionHasMore,
    completionTableWrapRef,
    repositorySessionExecutionRows,
    taskCompletionTableColumns,
  ]);

  const taskListDrawerProps = useMemo((): ClaudeChatSessionTaskListDrawerProps | null => {
    if (!taskListDrawerOpen) {
      return null;
    }
    return {
      open: true,
      onClose: closeTaskListDrawer,
      traceDrawerWidth,
      taskDrawerCount,
      taskDrawerCounts,
      trellisTaskFocus,
      setTrellisTaskFocus,
      splitTodoTasks,
      visibleTrellisTasks,
      trellisTasksLoading,
      taskListStatusFilter,
      setTaskListStatusFilter,
      taskListSelectableSliceIds,
      taskListAllFilteredSelected,
      taskListMultiSelectCap,
      filteredTaskList,
      taskListSelectedIds,
      setTaskListSelectedIds,
      taskListSelectedSet,
      monitorClaudeSlotsRemaining,
      omcBatchPopoverOpen,
      setOmcBatchPopoverOpen,
      omcBatchTemplateId,
      setOmcBatchTemplateId,
      handleOmcBatchConfirmFromPopover,
      handleDeleteAllSplitTasks,
      handleAdjustTaskStatus,
      handleCompleteTaskManually,
      handleConfirmDeleteSplitTask,
      handleRunTaskInMainSession,
      persistSplitTaskDispatchField,
      handleRunTaskByEmployee,
      handleRunTaskByTeam,
      taskListEmployeeOptions,
      taskListTeamOptions,
      activeProject,
      syncTrellisTaskList,
      trellisTaskSelectableKeys,
      trellisTaskAllSelected,
      trellisTaskSelectedKeys,
      trellisTaskSelectedSet,
      setTrellisTaskSelectedKeys,
      trellisBatchEmployeeName,
      setTrellisBatchEmployeeName,
      trellisEmployeeDispatchAvailable,
      trellisTaskEmployeeByKey,
      setTrellisTaskEmployeeByKey,
      handleBatchRunTrellisByEmployee,
      handleBatchArchiveTrellisTasks,
      handleRunTrellisTaskInMainSession,
      handleArchiveTrellisTask,
      handleRunTrellisTaskByEmployee,
    };
  }, [
    taskListDrawerOpen,
    ...(taskListDrawerOpen
      ? ([
          closeTaskListDrawer,
          traceDrawerWidth,
          taskDrawerCount,
          taskDrawerCounts,
          trellisTaskFocus,
          splitTodoTasks,
          visibleTrellisTasks,
          trellisTasksLoading,
          taskListStatusFilter,
          taskListSelectableSliceIds,
          taskListAllFilteredSelected,
          taskListMultiSelectCap,
          filteredTaskList,
          taskListSelectedIds,
          taskListSelectedSet,
          monitorClaudeSlotsRemaining,
          omcBatchPopoverOpen,
          omcBatchTemplateId,
          handleOmcBatchConfirmFromPopover,
          handleDeleteAllSplitTasks,
          handleAdjustTaskStatus,
          handleCompleteTaskManually,
          handleConfirmDeleteSplitTask,
          handleRunTaskInMainSession,
          persistSplitTaskDispatchField,
          handleRunTaskByEmployee,
          handleRunTaskByTeam,
          taskListEmployeeOptions,
          taskListTeamOptions,
          activeProject,
          syncTrellisTaskList,
          trellisTaskSelectableKeys,
          trellisTaskAllSelected,
          trellisTaskSelectedKeys,
          trellisTaskSelectedSet,
          trellisBatchEmployeeName,
          trellisEmployeeDispatchAvailable,
          trellisTaskEmployeeByKey,
          handleBatchRunTrellisByEmployee,
          handleBatchArchiveTrellisTasks,
          handleRunTrellisTaskInMainSession,
          handleArchiveTrellisTask,
          handleRunTrellisTaskByEmployee,
        ] as const)
      : []),
  ]);

  const traceDrawerProps = useMemo((): ClaudeChatSessionTraceDrawerProps | null => {
    if (!sessionTraceDrawerOpen) {
      return null;
    }
    return {
      open: true,
      onClose: closeSessionTraceDrawer,
      traceDrawerWidth,
      sessionId: session.id,
      sessionRepositoryPath: session.repositoryPath,
      sessionSendTraces,
      setSessionSendTraces,
    };
  }, [
    sessionTraceDrawerOpen,
    ...(sessionTraceDrawerOpen
      ? ([
          closeSessionTraceDrawer,
          traceDrawerWidth,
          session.id,
          session.repositoryPath,
          sessionSendTraces,
        ] as const)
      : []),
  ]);

  const featurePanelProps = useMemo((): ClaudeChatSessionFeaturePanelProps => ({
    toolbar: toolbarProps,
    taskListDrawer: taskListDrawerProps,
    traceDrawer: traceDrawerProps,
  }), [toolbarProps, taskListDrawerProps, traceDrawerProps]);

  return { featurePanelProps, appendSessionSendTrace };
}
