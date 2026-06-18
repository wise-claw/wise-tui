import {
  Button,
  message,
  Modal,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { HoverHint } from "../components/shared/HoverHint";
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
  type RepositorySessionExecutionRow,
  type SessionSendTraceEntry,
  type SessionUserQuestionRow,
  type RefreshHistorySessionsScope,
  type TaskCompletionOwnerFilter,
  type TaskCompletionStatusFilter,
} from "../components/ClaudeSessions/ClaudeChatSessionFeaturePanel";
import { resolveOwnerHintForSession } from "../utils/sessionOwnerHints";
import type { SessionOwnerHint } from "../utils/sessionOwnerHints";
import {
  isSessionBoundAsRepositoryMain,
  repositoryPathsMatch,
} from "../utils/repositoryMainSessionBinding";
import {
  dedupeClaudeSessionsByIdentity,
  listSessionsForHistoryScope,
  resolveHistoryDiskScopePath,
} from "../utils/sessionHistoryScope";
import { resolveProjectMainSessionAnchor } from "../utils/projectSessionAnchor";
import { getAppSetting, setAppSetting } from "../services/appSettingsStore";
import { getSessionPreview } from "../components/ClaudeSessions/claudeChatHelpers";
import { getSessionUpdatedAt, groupSessionsByDay, sliceGroupedSessions, type SessionGroup } from "../components/ClaudeSessions/sessionGrouping";
import { isToolOnlyUserMessage, userMessagePlainTextForDisplay } from "../utils/claudeChatMessageDisplay";
import type {
  ClaudeSession,
  EmployeeItem,
  PendingExecutionTask,
  ProjectItem,
  Repository,
  WorkflowTaskItem,
  WorkflowTemplateItem,
} from "../types";
import type { WorkspaceFocus, WorkspaceMode } from "../utils/workspaceMode";
import {
  executionStatusTagColor,
  formatCompletionActivityTime,
  getSessionTraceStorageKey,
  mapClaudeExecutionStatusLabel,
  resolveSessionOwnerInfo,
  rowMatchesCompletionSearch,
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
  activeWorkspaceFocus?: WorkspaceFocus;
  activeRepositoryId?: number | null;
  workspaceMode?: WorkspaceMode;
  sessionOwnerHints: Record<string, SessionOwnerHint>;
  mentionEmployees: EmployeeItem[];
  workflowTasks: WorkflowTaskItem[];
  workflowTemplates: WorkflowTemplateItem[];
  workflowGraphStatusByWorkflowId: Record<string, string>;
  taskPendingEmployeesByTaskId: Record<string, Array<{ employeeId: string; name: string }>>;
  repositoryScopePath: string;
  sessionRepository: Repository | null;
  repositoryMainBindings: Record<string, string>;
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
    activeRepository: _activeRepository,
    activeProject,
    activeWorkspaceFocus = "repository",
    activeRepositoryId = null,
    workspaceMode = "single_repo",
    sessionOwnerHints,
    mentionEmployees: _mentionEmployees,
    workflowTasks,
    workflowTemplates,
    workflowGraphStatusByWorkflowId: _workflowGraphStatusByWorkflowId,
    taskPendingEmployeesByTaskId,
    repositoryScopePath,
    sessionRepository,
    repositoryMainBindings,
    omcBatchAnchorSessionId: _omcBatchAnchorSessionId,
    omcBatchUserAbortRef: _omcBatchUserAbortRef,
    omcBatchInFlightRef: _omcBatchInFlightRef,
    hideSessionTools = false,
    scrollToSessionMessageId,
    scrollMessageTargetIntoView: _scrollMessageTargetIntoView,
    onSwitchSession,
    onExecute: _onExecute,
    onOpenRepositoryScheduledTasks,
    onRefreshHistorySessions,
    onDeleteHistorySession,
    onOpenHistorySessionInInspector,
    onRestoreHistorySessionAsMain,
    resolveTaskListOmcInvokeConcurrency: _resolveTaskListOmcInvokeConcurrency,
    onAppendSystemMessage: _onAppendSystemMessage,
    onAppendUserMessage: _onAppendUserMessage,
    onNotifyOmcEmployeeDirectBatchTaskDone: _onNotifyOmcEmployeeDirectBatchTaskDone,
    onPrepareFreshOmcEmployeeWorkerForDirectBatch: _onPrepareFreshOmcEmployeeWorkerForDirectBatch,
  } = input;

  const taskDrawerCount = 0;
  const [taskListDrawerOpen, setTaskListDrawerOpen] = useState(false);
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
              <HoverHint title={tip} placement="topLeft">
                <span className="app-task-completion-modal__ellipsis-cell">{text}</span>
              </HoverHint>
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
            <HoverHint title={id} placement="topLeft">
              <span className="app-task-completion-modal__ellipsis-cell app-task-completion-modal__mono">{id}</span>
            </HoverHint>
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
    const historyScopeInput = useMemo(
      () => ({
        repositoryScopePath,
        activeProject,
        activeWorkspaceFocus,
        activeRepositoryId: activeRepositoryId ?? sessionRepository?.id ?? null,
        repositories: repositories ?? [],
        workspaceMode,
        repositoryMainBindings,
      }),
      [
        repositoryScopePath,
        activeProject,
        activeWorkspaceFocus,
        activeRepositoryId,
        sessionRepository?.id,
        repositories,
        workspaceMode,
        repositoryMainBindings,
      ],
    );
    const historyDiskScopePath = useMemo(
      () => resolveHistoryDiskScopePath(historyScopeInput),
      [historyScopeInput],
    );
    const repositoryHistorySessions = useMemo(
      () => {
        if (!historyListActive) {
          return [] as ClaudeSession[];
        }
        return dedupeClaudeSessionsByIdentity(
          listSessionsForHistoryScope(historySessionSource, historyScopeInput),
        ).sort((a, b) => getSessionUpdatedAt(b) - getSessionUpdatedAt(a));
      },
      [historyListActive, historySessionSource, historyScopeInput],
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
      const scopePath = historyDiskScopePath.trim();
      if (!scopePath) return;
      historyRefreshInFlightRef.current = true;
      setHistorySessionsRefreshing(true);
      void Promise.resolve(
        onRefreshHistorySessions({
          repositoryPath: scopePath,
          repositoryName:
            activeWorkspaceFocus === "project" && activeProject
              ? resolveProjectMainSessionAnchor(activeProject, repositories ?? []).displayName.trim() ||
                session.repositoryName.trim() ||
                scopePath
              : sessionRepository?.name?.trim() || session.repositoryName.trim() || scopePath,
        }),
      )
        .catch(() => {
          message.error("刷新历史会话失败");
        })
        .finally(() => {
          historyRefreshInFlightRef.current = false;
          setHistorySessionsRefreshing(false);
        });
    }, [
      historyDiskScopePath,
      onRefreshHistorySessions,
      activeWorkspaceFocus,
      activeProject,
      repositories,
      session.repositoryName,
      sessionRepository?.name,
    ]);

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
      activeProject,
    };
  }, [taskListDrawerOpen, closeTaskListDrawer, traceDrawerWidth, activeProject]);

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
    closeSessionTraceDrawer,
    traceDrawerWidth,
    session.id,
    session.repositoryPath,
    sessionSendTraces,
  ]);

  const featurePanelProps = useMemo((): ClaudeChatSessionFeaturePanelProps => ({
    toolbar: toolbarProps,
    taskListDrawer: taskListDrawerProps,
    traceDrawer: traceDrawerProps,
  }), [toolbarProps, taskListDrawerProps, traceDrawerProps]);

  return { featurePanelProps, appendSessionSendTrace };
}
