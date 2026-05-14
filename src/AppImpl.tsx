import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { message } from "antd";
import type {
  ClaudeSession,
  EmployeeItem,
  EmployeeTaskCountItem,
  MonitorDrawerTarget,
  ProjectItem,
  Repository,
  TaskMode,
  WorkflowGraph,
  WorkflowRuntimeStepSnapshot,
  WorkflowTaskEventItem,
  WorkflowTaskItem,
  WorkflowTemplateItem,
} from "./types";
import {
  repositoryFolderBasename,
  repositorySessionTabDisplayName,
  repositoryTypeChineseLabel,
} from "./utils/repositoryType";
import { useRepositoryList } from "./hooks/useRepositoryList";
import { useClaudeSessions, type ClaudeTurnCompletePayload } from "./hooks/useClaudeSessions";
import { openInFinder } from "./services/repository";
import { AppWorkspaceLayout } from "./components/AppWorkspaceLayout";
import type { PromptsOpenContext } from "./components/PromptsPanel";
import { reloadAppWindow } from "./services/window";
import { wiseMascotShow } from "./services/wiseMascot";
import { getTaskTemplate, setTaskTemplate } from "./services/projectState";
import { ensureCrepeToolbarTitleHintsInstalled } from "./utils/crepeToolbarTitles";
import {
  WORKFLOW_UI_EVENT_OPEN_TASK_SPLIT_PANEL,
} from "./constants/workflowUiEvents";
import { listEmployeeTaskCounts, listEmployees, createEmployee, updateEmployee, deleteEmployee, moveEmployeeDisplayOrder } from "./services/employees";
import { deleteWorkflowTemplate, listWorkflowTemplates, saveWorkflowTemplate } from "./services/workflowTemplates";
import { getWorkflowGraph, saveWorkflowGraph, validateWorkflowGraph } from "./services/workflowGraphs";
import {
  endWorkflowTask,
  listTaskEvents,
  listTaskPendingEmployees,
  listWorkflowTasks,
  migrateWorkflowSessionTabReferences,
} from "./services/workflowTasks";
import { cancelClaudeInvocation, listClaudeSubagents } from "./services/claude";
import {
  dispatchAtMentionPromptToRepos,
  planAtMentionDispatch,
} from "./services/atMentionDispatch";
import { resolveProjectMainSessionAnchor } from "./utils/projectSessionAnchor";
import { resolveSidebarSelectionTarget } from "./utils/sidebarSelectionTarget";
import { shouldHideEmployeeUi } from "./utils/projectRepositoryRoles";
import { buildProjectRoleTagOptions } from "./utils/projectRoleTagOptions";
import { useMonitorOverview } from "./hooks/useMonitorOverview";
import { useIntervalSyncedState } from "./hooks/useIntervalSyncedState";
import { useScheduledClaudeTaskRunner } from "./hooks/useScheduledClaudeTaskRunner";
import { MONITOR_SESSIONS_SYNC_INTERVAL_MS } from "./constants/monitorUi";
import { invalidateWorkflowRunCacheForRepository } from "./hooks/useWorkflowRun";
import { deleteAppSetting, getAppSetting, setAppSetting } from "./services/appSettingsStore";
import { migratePromptContextSessionKey } from "./components/ClaudeChatInput/prompt-context";
import {
  clampConcurrencyLimit,
  claudeConcurrencyScopeKey,
  getConcurrencyLimitForScope,
  loadClaudeConcurrencyLimits,
  saveClaudeConcurrencyLimits,
  type ClaudeConcurrencyLimitsMap,
} from "./services/claudeConcurrencyLimits";
import { getClaudeSpawnSlotCount } from "./services/claudeSpawnSlots";
import {
  countRunningClaudeSessionsInProjectRepository,
  evaluateBeforeSpawnClaudeCode,
  resolveClaudeConcurrencyInvokeContext,
} from "./utils/claudeConcurrencyGate";
import { pickSessionForRepositorySidebarSelect } from "./utils/claudeSessionSelection";
import {
  isOmcBatchHistoryStubSessionId,
  clearPersistedOmcBatchHistory,
  parseOmcBatchHistoryStubAnchorSessionId,
} from "./utils/omcEmployeeBatchHistory";
import { isOmcMonitorEmployeeRecord } from "./utils/omcMonitorEmployeeSession";
import {
  normalizeRepositoryPathKey as normalizeRepositoryPathForMatch,
  parseRepositoryMainSessionBindings,
  REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY,
  resolveRepositoryForSession,
  resolveRepositoryMainSessionId,
  resolveMainOwnerAgentNameForRepositoryPath,
} from "./utils/repositoryMainSessionBinding";
import { loadSessionOwnerHints } from "./utils/sessionOwnerHints";
import type { WorkflowGraphRuntimeState } from "./services/workflowGraphRuntime";
import "./App.css";
import { toUiErrorMessage } from "./utils/appErrorMessage";
import { applyTemplate } from "./utils/templateString";
import {
  DEFAULT_PROJECT_SPLIT_TEMPLATE,
  DEFAULT_REPOSITORY_SPLIT_TEMPLATE,
  LEGACY_APP_SETTING_KEY_PROJECT_SPLIT_TEMPLATE,
  LEGACY_APP_SETTING_KEY_REPOSITORY_SPLIT_TEMPLATE,
} from "./constants/taskTemplates";
import {
  DEFAULT_WORKFLOW_VERDICT_MODE,
  WORKFLOW_VERDICT_MODE_STORAGE_KEY,
  type WorkflowVerdictMode,
} from "./constants/workflowVerdictMode";
import {
  extractRuntimeSnapshotsFromEvents,
} from "./services/workflowGraphHelpers";
import { useMainLayoutModes } from "./hooks/useMainLayoutModes";
import { useDingTalkAutomationInbound } from "./hooks/useDingTalkAutomationInbound";
import { useOmcRuntime } from "./hooks/useOmcRuntime";
import { useWorkflowTeamAutomation } from "./hooks/useWorkflowTeamAutomation";
import { useWorkspaceMode } from "./hooks/useWorkspaceMode";
import {
  addProjectPrdWorkflow,
  listProjectPrdEmployeeIds,
  listWorkflowProjectIds,
} from "./services/projectPrdScope";

// ── App ──

export default function App() {
  const [taskSplitMode, setTaskSplitMode] = useState(false);
  /** 任务面板：在主区+右栏之上叠层展示任务列表（不盖左栏）。 */
  const [taskPanelMode] = useState(false);
  const [promptsMode, setPromptsMode] = useState(false);
  /** 左栏 MCP：在主区+右栏之上叠层展示（与技能目录相同，不盖左栏）。 */
  const [mcpHubMode, setMcpHubMode] = useState(false);
  /** 左栏技能：在主区+右栏之上叠层展示 skills.sh（不盖左栏，非全屏居中 Modal）。 */
  const [skillsHubMode, setSkillsHubMode] = useState(false);
  const [codeKnowledgeGraphMode, setCodeKnowledgeGraphMode] = useState(false);
  const [promptsOpenContext, setPromptsOpenContext] = useState<PromptsOpenContext | null>(null);
  const [repositorySplitTemplate, setRepositorySplitTemplate] = useState("");
  const [projectSplitTemplate, setProjectSplitTemplate] = useState("");
  const [dark, _setDark] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [terminalCollapsed, setTerminalCollapsed] = useState(true);
  const [dualPaneEnabled, setDualPaneEnabled] = useState(false);
  const [dualPaneSecondarySessionId, setDualPaneSecondarySessionId] = useState<string | null>(null);
  /** null: right pane follows the sidebar repository; non-null: right main session is pinned to this repository id. */
  const [dualPaneSecondaryRepositoryId, setDualPaneSecondaryRepositoryId] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [employeeConfigOpen, setEmployeeConfigOpen] = useState(false);
  const [employeeConfigDefaultRepositoryIds, setEmployeeConfigDefaultRepositoryIds] = useState<number[]>([]);
  /** 非空：从需求面板打开员工配置，新建成功后自动关联到该项目。 */
  const [employeeConfigPrdProjectId, setEmployeeConfigPrdProjectId] = useState<string | null>(null);
  /** 从需求面板打开员工配置时拉取，用于表格「始终显示」项目显式关联的员工 id。 */
  const [employeeConfigPrdVisibleEmployeeIds, setEmployeeConfigPrdVisibleEmployeeIds] = useState<string[]>([]);
  const [employeeAgentTypeOptions, setEmployeeAgentTypeOptions] = useState<string[]>(["executor"]);
  const [workflowConfigOpen, setWorkflowConfigOpen] = useState(false);
  /** 非空：从需求面板打开团队配置，保存模板后自动关联到该项目。 */
  const [workflowConfigPrdProjectId, setWorkflowConfigPrdProjectId] = useState<string | null>(null);
  /** workflowId -> [projectId, ...] map，用于 WorkflowConfigModal 中展示已关联项目。 */
  const [workflowProjectIdsMap, setWorkflowProjectIdsMap] = useState<Record<string, string[]>>({});
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [monitorDrawerTarget, setMonitorDrawerTarget] = useState<MonitorDrawerTarget | null>(null);
  const [employees, setEmployees] = useState<EmployeeItem[]>([]);
  const [employeeTaskCounts, setEmployeeTaskCounts] = useState<EmployeeTaskCountItem[]>([]);
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowTemplateItem[]>([]);
  const [workflowTasks, setWorkflowTasks] = useState<WorkflowTaskItem[]>([]);
  const [workflowTaskEventsByTaskId, setWorkflowTaskEventsByTaskId] = useState<Record<string, WorkflowTaskEventItem[]>>({});
  const [taskPendingEmployeesByTaskId, setTaskPendingEmployeesByTaskId] = useState<Record<string, Array<{ employeeId: string; name: string }>>>({});
  const [workflowRuntimeStateByTaskId, setWorkflowRuntimeStateByTaskId] = useState<Record<string, WorkflowGraphRuntimeState>>({});
  const [workflowRuntimeSnapshotsByTaskId, setWorkflowRuntimeSnapshotsByTaskId] = useState<Record<string, WorkflowRuntimeStepSnapshot[]>>({});
  /** 供团队自动推进异步回调读取最新状态，避免驳回回退后闭包内 task 阶段索引滞后误判「未推进」而提前 return。 */
  const workflowTasksRef = useRef(workflowTasks);
  workflowTasksRef.current = workflowTasks;
  const taskPendingEmployeesByTaskIdRef = useRef(taskPendingEmployeesByTaskId);
  taskPendingEmployeesByTaskIdRef.current = taskPendingEmployeesByTaskId;
  const workflowRuntimeStateByTaskIdRef = useRef(workflowRuntimeStateByTaskId);
  workflowRuntimeStateByTaskIdRef.current = workflowRuntimeStateByTaskId;
  const workflowTaskEventsByTaskIdRef = useRef(workflowTaskEventsByTaskId);
  workflowTaskEventsByTaskIdRef.current = workflowTaskEventsByTaskId;
  const workflowRuntimeSnapshotsByTaskIdRef = useRef(workflowRuntimeSnapshotsByTaskId);
  workflowRuntimeSnapshotsByTaskIdRef.current = workflowRuntimeSnapshotsByTaskId;
  const [workflowGraphsByWorkflowId, setWorkflowGraphsByWorkflowId] = useState<Record<string, WorkflowGraph>>({});
  const [workflowGraphStatusByWorkflowId, setWorkflowGraphStatusByWorkflowId] = useState<Record<string, string>>({});
  const moveOmcRuntimeSessionIdRef = useRef<(fromTabId: string, toClaudeSessionId: string) => void>(() => {});
  /** 与侧栏「结束」共用同一份实现，供监控抽屉内结束 OMC 复用。 */
  const handleStopEmployeeMonitorRef = useRef<(employeeId: string) => void>(() => {});
  const [workflowVerdictMode, setWorkflowVerdictMode] = useState<WorkflowVerdictMode>(DEFAULT_WORKFLOW_VERDICT_MODE);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = (await getAppSetting(WORKFLOW_VERDICT_MODE_STORAGE_KEY))?.trim();
        if (cancelled || !raw) return;
        if (raw === "heuristic" || raw === "structured_only" || raw === "structured_plus_extractor") {
          setWorkflowVerdictMode(raw);
        }
      } catch {
        // ignore setting read errors, keep default mode
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const {
    repositories,
    projects,
    activeProjectId,
    activeRepositoryId,
    loading: repositoryListLoading,
    setActiveRepositoryId,
    setActiveProjectId,
    setActiveRepositoryWithOwner,
    handleCreateProject,
    handleUpdateProject,
    handleDeleteProject,
    handleAddRepositoryToProject,
    handleAddRepositoryPathToProject,
    handleAddFloatingRepository,
    handlePromoteFloatingRepositoryToProject,
    handleDetachRepositoryFromProject,
    handleRemoveRepository,
    handleUpdateRepositorySddMode,
    handleReorderRepositoriesInProject,
    handleMoveRepositoryToProject,
    handleUpdateRepositoryMainOwnerAgent,
    pinnedProjectIds,
    togglePinProject,
    floatingRepositories,
  } = useRepositoryList();

  const [repositoryMainSessionBindings, setRepositoryMainSessionBindings] = useState<Record<string, string>>({});
  /** 从侧栏仓库打开员工配置：与需求面板相同的 Owner 表格式，但不写 project_prd。 */
  const [employeeConfigRepositoryOwnerScopeOnly, setEmployeeConfigRepositoryOwnerScopeOnly] = useState(false);
  const [employeeConfigInitialCreateEmployeeName, setEmployeeConfigInitialCreateEmployeeName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await getAppSetting(REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY);
        if (cancelled) return;
        const fromDisk = parseRepositoryMainSessionBindings(raw);
        setRepositoryMainSessionBindings((current) => ({ ...fromDisk, ...current }));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const bindRepositoryMainSession = useCallback((repositoryPath: string, sessionId: string) => {
    const key = normalizeRepositoryPathForMatch(repositoryPath);
    setRepositoryMainSessionBindings((prev) => {
      if (prev[key] === sessionId) return prev;
      const next = { ...prev, [key]: sessionId };
      void setAppSetting(REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const handlePersistRepositoryMainOwnerAgent = useCallback(
    async (repository: Repository, mainOwnerAgentName: string | null) => {
      try {
        await handleUpdateRepositoryMainOwnerAgent(repository.id, mainOwnerAgentName);
        const key = normalizeRepositoryPathForMatch(repository.path);
        setRepositoryMainSessionBindings((prev) => {
          if (!(key in prev)) return prev;
          const next = { ...prev };
          delete next[key];
          void setAppSetting(REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY, JSON.stringify(next));
          return next;
        });
        message.success(mainOwnerAgentName?.trim() ? "仓库已更新" : "已清除仓库");
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [handleUpdateRepositoryMainOwnerAgent],
  );

  const migrateRepositoryMainSessionBindingTabIds = useCallback((fromTabId: string, toClaudeSessionId: string) => {
    setRepositoryMainSessionBindings((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [k, v] of Object.entries(prev)) {
        if (v === fromTabId) {
          next[k] = toClaudeSessionId;
          changed = true;
        }
      }
      if (!changed) return prev;
      void setAppSetting(REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const [claudeConcurrencyLimitsMap, setClaudeConcurrencyLimitsMap] = useState<ClaudeConcurrencyLimitsMap>({});
  /** Rust `spawn_slots_by_scope` 占用数（含无 UI 的批量 OMC）；`null` 表示尚未拉取或非桌面环境 */
  const [rustSpawnSlotOccupied, setRustSpawnSlotOccupied] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await loadClaudeConcurrencyLimits();
        if (!cancelled) {
          setClaudeConcurrencyLimitsMap(loaded);
        }
      } catch {
        if (!cancelled) {
          setClaudeConcurrencyLimitsMap({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const beforeSpawnClaudeRef = useRef<
    ((session: ClaudeSession) => { ok: true } | { ok: false; message: string }) | null
  >(null);

  const claudeConcurrencyInvokeContextRef = useRef<
    ((session: ClaudeSession) => { concurrencyScopeKey: string; concurrencyLimit: number } | null) | null
  >(null);

  const advanceTeamAfterTurnRef = useRef<(p: ClaudeTurnCompletePayload) => void>(() => {});

  const moveDingTalkAutomationPendingSessionIdRef = useRef<(fromTabId: string, toClaudeSessionId: string) => void>(() => {});
  const moveWorkflowAutomationSessionIdRef = useRef<(fromTabId: string, toClaudeSessionId: string) => void>(() => {});
  /** 在 `sessionsLatestRef` 就绪后每帧赋值：DB 迁移 workflow 会话引用 + 刷新任务列表（见 `handleSessionTabIdMigrated`）。 */
  const postSessionTabMigrationRef = useRef<(fromTabId: string, toClaudeSessionId: string) => void>(() => {});

  const handleSessionTabIdMigrated = useCallback(
    (fromTabId: string, toClaudeSessionId: string) => {
      setDualPaneSecondarySessionId((prev) => (prev === fromTabId ? toClaudeSessionId : prev));
      migrateRepositoryMainSessionBindingTabIds(fromTabId, toClaudeSessionId);
      void migratePromptContextSessionKey(fromTabId, toClaudeSessionId);
      moveWorkflowAutomationSessionIdRef.current(fromTabId, toClaudeSessionId);
      moveDingTalkAutomationPendingSessionIdRef.current(fromTabId, toClaudeSessionId);
      moveOmcRuntimeSessionIdRef.current(fromTabId, toClaudeSessionId);
      postSessionTabMigrationRef.current(fromTabId, toClaudeSessionId);
    },
    [migrateRepositoryMainSessionBindingTabIds],
  );

  const {
    sessions,
    activeSessionId,
    createSession,
    updateSessionModel,
    executeSession,
    appendSystemMessage,
    appendUserMessage,
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
  } = useClaudeSessions({
    onClaudeTurnComplete: (p) => {
      advanceTeamAfterTurnRef.current(p);
    },
    beforeSpawnClaudeRef,
    claudeConcurrencyInvokeContextRef,
    onClaudeSpawnBlocked: (blockedMessage) => {
      message.warning(blockedMessage);
    },
    companionSessionId: dualPaneEnabled ? dualPaneSecondarySessionId : null,
    onSessionTabIdMigrated: handleSessionTabIdMigrated,
  });

  const sessionsLatestRef = useRef(sessions);
  sessionsLatestRef.current = sessions;

  const repositoriesLatestRef = useRef(repositories);
  repositoriesLatestRef.current = repositories;

  const repositoryMainBindingsLatestRef = useRef(repositoryMainSessionBindings);
  repositoryMainBindingsLatestRef.current = repositoryMainSessionBindings;

  const employeesLatestRef = useRef(employees);
  employeesLatestRef.current = employees;

  /** 监控侧栏 / Drawer 用：与主会话流式更新解耦，避免 `useMonitorOverview` 等巨型 memo 同频重算卡死主线程 */
  const sessionsSyncedForMonitorUi = useIntervalSyncedState(
    sessions,
    MONITOR_SESSIONS_SYNC_INTERVAL_MS,
    sessions.length,
  );

  const monitorPanelSessionsMerged = sessionsSyncedForMonitorUi;

  useEffect(() => {
    clearPersistedOmcBatchHistory();
  }, []);

  postSessionTabMigrationRef.current = (fromTabId, toClaudeSessionId) => {
    const repoPath =
      sessionsLatestRef.current.find((s) => s.id === toClaudeSessionId)?.repositoryPath?.trim() ?? "";
    void (async () => {
      try {
        await migrateWorkflowSessionTabReferences({ fromTabId, toSessionId: toClaudeSessionId });
      } catch (error) {
        console.error("migrate_workflow_session_tab_references failed:", error);
      }
      if (repoPath) {
        invalidateWorkflowRunCacheForRepository(repoPath);
      }
      try {
        const tasks = await listWorkflowTasks(toClaudeSessionId);
        setWorkflowTasks((prev) => {
          const untouched = prev.filter((t) => t.creator !== toClaudeSessionId && t.creator !== fromTabId);
          return [...untouched, ...tasks];
        });
        const eventEntries = await Promise.all(
          tasks.slice(0, 8).map(async (task) => [task.id, await listTaskEvents(task.id)] as const),
        );
        const pendingEntries = await Promise.all(
          tasks.slice(0, 8).map(async (task) => [task.id, await listTaskPendingEmployees(task.id)] as const),
        );
        setWorkflowTaskEventsByTaskId((prev) => {
          const next = { ...prev };
          for (const [taskId, events] of eventEntries) {
            next[taskId] = events;
          }
          return next;
        });
        setWorkflowRuntimeSnapshotsByTaskId((prev) => {
          const next = { ...prev };
          for (const [taskId, events] of eventEntries) {
            next[taskId] = extractRuntimeSnapshotsFromEvents(events);
          }
          return next;
        });
        setTaskPendingEmployeesByTaskId((prev) => {
          const next = { ...prev };
          for (const [taskId, employees] of pendingEntries) {
            next[taskId] = employees;
          }
          return next;
        });
      } catch (error) {
        console.error("Reload workflow tasks after session tab id migration failed:", error);
      }
    })();
  };

  const handleCloseSession = useCallback(
    (sessionId: string) => {
      const session = sessionsLatestRef.current.find((s) => s.id === sessionId);
      if (session?.repositoryPath) {
        const key = normalizeRepositoryPathForMatch(session.repositoryPath);
        setRepositoryMainSessionBindings((prev) => {
          if (prev[key] !== sessionId) return prev;
          const next = { ...prev };
          delete next[key];
          void setAppSetting(REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY, JSON.stringify(next));
          return next;
        });
      }
      closeSession(sessionId);
    },
    [closeSession],
  );

  /**
   * 历史会话弹窗内删除某条会话：物理删除磁盘 jsonl（不可恢复），并清理与之绑定的主会话映射。
   * `deleteSession` 内部对 running / connecting 状态会抛错，由调用方承接 toast。
   */
  const handleDeleteHistorySession = useCallback(
    async (sessionId: string) => {
      const session = sessionsLatestRef.current.find((s) => s.id === sessionId);
      if (session?.repositoryPath) {
        const key = normalizeRepositoryPathForMatch(session.repositoryPath);
        setRepositoryMainSessionBindings((prev) => {
          if (prev[key] !== sessionId) return prev;
          const next = { ...prev };
          delete next[key];
          void setAppSetting(REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY, JSON.stringify(next));
          return next;
        });
      }
      await deleteSession(sessionId);
    },
    [deleteSession],
  );
  const activeSessionIdLatestRef = useRef(activeSessionId);
  activeSessionIdLatestRef.current = activeSessionId;

  /** 与 ClaudeSessions 内 handleSwitchToSession 对齐：先同步项目+仓库再切会话，否则 activeSession 会因 path 不一致为空。 */
  const jumpToSessionWithRepository = useCallback(
    (sessionId: string) => {
      const sid = sessionId.trim();
      if (!sid) return;
      setTaskSplitMode(false);
      if (isOmcBatchHistoryStubSessionId(sid)) {
        const anchor = parseOmcBatchHistoryStubAnchorSessionId(sid);
        if (anchor) {
          void message.info("此为批量 OMC 历史占位标签，正在跳转到发起该批次的主会话。");
          jumpToSessionWithRepository(anchor);
        }
        return;
      }
      const target = sessionsLatestRef.current.find((item) => item.id === sid || item.claudeSessionId === sid);
      const canonicalId = target?.id ?? sid;
      const currentActive = activeSessionIdLatestRef.current?.trim() ?? "";
      if (canonicalId === currentActive) {
        return;
      }
      if (!target?.repositoryPath) {
        switchSession(canonicalId);
        return;
      }
      const repo = resolveRepositoryForSession({
        session: target,
        repositories,
        bindings: repositoryMainSessionBindings,
        sessions: sessionsLatestRef.current,
        preferredRepositoryId: activeRepositoryId,
      });
      if (repo) {
        flushSync(() => {
          setActiveRepositoryWithOwner(repo.id);
        });
      }
      switchSession(canonicalId);
    },
    [
      activeRepositoryId,
      repositories,
      repositoryMainSessionBindings,
      setActiveRepositoryWithOwner,
      setTaskSplitMode,
      switchSession,
    ],
  );

  const jumpToSessionWithRepositoryRef = useRef(jumpToSessionWithRepository);
  jumpToSessionWithRepositoryRef.current = jumpToSessionWithRepository;

  const bindRepositoryMainSessionRef = useRef(bindRepositoryMainSession);
  bindRepositoryMainSessionRef.current = bindRepositoryMainSession;

  const {
    flushDingTalkAutomationReplyForTurn,
    moveDingTalkAutomationPendingSessionId,
  } = useDingTalkAutomationInbound({
    activeProjectId,
    activeRepositoryId,
    bindRepositoryMainSession,
    createSession,
    executeSession,
    jumpToSessionWithRepository,
    projects,
    repositories,
    repositoryMainSessionBindings,
    sessions,
  });
  moveDingTalkAutomationPendingSessionIdRef.current = moveDingTalkAutomationPendingSessionId;

  const {
    getOmcMonitorStopSnapshot,
    handleCancelOmcDirectBatchInvocation,
    handleOpenOmcBatchInvocationDetail,
    markOmcBatchRuntimeAborted,
    moveOmcRuntimeSessionId,
    omcBatchRuntime,
  } = useOmcRuntime({
    employees,
    jumpToSessionWithRepository,
    repositoryMainSessionBindings,
    repositories,
    sessions,
  });
  moveOmcRuntimeSessionIdRef.current = moveOmcRuntimeSessionId;

  const {
    handleClaudeTurnComplete,
    handleComposerExecute,
    handleDecideWorkflowTask,
    handleSendMessageWithTask,
    moveWorkflowAutomationSessionId,
    notifyOmcEmployeeDirectBatchTaskDone,
    prepareFreshOmcEmployeeWorkerForDirectBatch,
    refreshEmployeeData,
  } = useWorkflowTeamAutomation({
    activeSessionId,
    appendSystemMessage,
    closeSession: handleCloseSession,
    createSession,
    employees,
    executeSession,
    flushDingTalkAutomationReplyForTurn,
    repositoryMainSessionBindings,
    repositories,
    sessions,
    setEmployeeTaskCounts,
    setEmployees,
    setTaskPendingEmployeesByTaskId,
    setWorkflowRuntimeSnapshotsByTaskId,
    setWorkflowRuntimeStateByTaskId,
    setWorkflowTaskEventsByTaskId,
    setWorkflowTasks,
    taskPendingEmployeesByTaskId,
    workflowGraphStatusByWorkflowId,
    workflowGraphsByWorkflowId,
    workflowRuntimeSnapshotsByTaskId,
    workflowRuntimeStateByTaskId,
    workflowTaskEventsByTaskId,
    workflowTasks,
    workflowTemplates,
    workflowVerdictMode,
  });
  moveWorkflowAutomationSessionIdRef.current = moveWorkflowAutomationSessionId;
  advanceTeamAfterTurnRef.current = handleClaudeTurnComplete;

  const handleComposerExecuteRef = useRef(handleComposerExecute);
  handleComposerExecuteRef.current = handleComposerExecute;

  useScheduledClaudeTaskRunner({
    repositoriesRef: repositoriesLatestRef,
    sessionsRef: sessionsLatestRef,
    bindingsRef: repositoryMainBindingsLatestRef,
    employeesRef: employeesLatestRef,
    executeRef: handleComposerExecuteRef,
  });

  beforeSpawnClaudeRef.current = (session) =>
    evaluateBeforeSpawnClaudeCode({
      spawningSession: session,
      sessions,
      projects,
      repositories,
      limitsMap: claudeConcurrencyLimitsMap,
      preferredProjectId: activeProjectId,
    });

  claudeConcurrencyInvokeContextRef.current = (session) =>
    resolveClaudeConcurrencyInvokeContext({
      session,
      projects,
      repositories,
      limitsMap: claudeConcurrencyLimitsMap,
      preferredProjectId: activeProjectId,
    });

  /** @-mention 派发拦截：wise_trellis 项目下，`@<roleTag>` 命中项目仓库时改走多仓库 trellis-implement 直派；其他场景回退到原 send 路径。 */
  const handleSendMessageWithAtMention = useCallback(
    (prompt: string) => {
      const activeProject = activeProjectId
        ? projects.find((p) => p.id === activeProjectId) ?? null
        : null;
      const plan = planAtMentionDispatch({
        activeProject,
        repositories,
        prompt,
      });
      if (plan.kind === "dispatch" && activeProject && activeSessionId) {
        void dispatchAtMentionPromptToRepos({
          project: activeProject,
          matchedRepos: plan.matchedRepos,
          body: plan.body,
          sessionId: activeSessionId,
        }).catch((err) => {
          const text = err instanceof Error ? err.message : String(err);
          message.error(`@-mention 派发失败: ${text}`);
        });
        const tagsText = plan.mentionedTags.map((t) => `@${t}`).join(" ");
        const reposText = plan.matchedRepos.map((r) => r.name).join(", ");
        message.success(`${tagsText} → ${reposText}`);
        return;
      }
      if (plan.kind === "warn_then_fallthrough") {
        message.warning(
          `${plan.mentionedTags.map((t) => `@${t}`).join(", ")} 未匹配项目仓库；按常规消息发送。`,
        );
      }
      handleSendMessageWithTask(prompt);
    },
    [activeProjectId, activeSessionId, handleSendMessageWithTask, projects, repositories],
  );

  const handleClaudeConcurrencyLimitChange = useCallback(
    async (projectId: string, repositoryId: number, nextRaw: number) => {
      const next = clampConcurrencyLimit(nextRaw);
      const key = claudeConcurrencyScopeKey(projectId, repositoryId);
      const nextMap: ClaudeConcurrencyLimitsMap = { ...claudeConcurrencyLimitsMap, [key]: next };
      setClaudeConcurrencyLimitsMap(nextMap);
      try {
        await saveClaudeConcurrencyLimits(nextMap);
      } catch (error) {
        console.error("Failed to save Claude concurrency limits:", error);
        message.error("保存并发上限失败");
      }
    },
    [claudeConcurrencyLimitsMap],
  );

  useEffect(() => {
    if (!activeProjectId || activeRepositoryId == null) {
      setRustSpawnSlotOccupied(null);
      return;
    }
    const proj = projects.find((p) => p.id === activeProjectId);
    const repo = repositories.find((r) => r.id === activeRepositoryId);
    if (!proj || !repo) {
      setRustSpawnSlotOccupied(null);
      return;
    }
    const sk = claudeConcurrencyScopeKey(proj.id, repo.id);
    let cancelled = false;
    setRustSpawnSlotOccupied(null);

    const tick = async () => {
      const n = await getClaudeSpawnSlotCount(sk);
      if (cancelled) return;
      if (n !== null) {
        setRustSpawnSlotOccupied(n);
      }
    };

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeProjectId, activeRepositoryId, projects, repositories]);

  const monitorClaudeConcurrency = useMemo(() => {
    if (!activeProjectId || activeRepositoryId == null) {
      return undefined;
    }
    const proj = projects.find((p) => p.id === activeProjectId);
    const repo = repositories.find((r) => r.id === activeRepositoryId);
    if (!proj || !repo) {
      return undefined;
    }
    const limit = getConcurrencyLimitForScope(claudeConcurrencyLimitsMap, proj.id, repo.id);
    const sessionActiveCount = countRunningClaudeSessionsInProjectRepository(
      sessions,
      proj,
      repo,
      projects,
      repositories,
      claudeConcurrencyLimitsMap,
      activeProjectId,
    );
    const activeCount =
      typeof rustSpawnSlotOccupied === "number"
        ? Math.max(sessionActiveCount, rustSpawnSlotOccupied)
        : sessionActiveCount;
    return {
      activeCount,
      limit,
      onLimitChange: (value: number) => void handleClaudeConcurrencyLimitChange(proj.id, repo.id, value),
    };
  }, [
    activeProjectId,
    activeRepositoryId,
    projects,
    repositories,
    claudeConcurrencyLimitsMap,
    sessions,
    handleClaudeConcurrencyLimitChange,
    rustSpawnSlotOccupied,
  ]);

  const { employeeMonitorItems, repositoryMemberMonitorItems, teamMonitorItems, stats: monitorStats } = useMonitorOverview({
    employees,
    repositories,
    projects,
    workflowTemplates,
    workflowTasks,
    workflowTaskEventsByTaskId,
    workflowRuntimeSnapshotsByTaskId,
    taskPendingEmployeesByTaskId,
    sessions: sessionsSyncedForMonitorUi,
    workflowGraphsByWorkflowId,
    omcBatchRuntime,
  });
  const mentionEmployees = useMemo(() => {
    const monitoredEmployeeIds = new Set(employeeMonitorItems.map((item) => item.employeeId));
    return employees.filter(
      (item) =>
        item.enabled &&
        monitoredEmployeeIds.has(item.id) &&
        !isOmcMonitorEmployeeRecord(item),
    );
  }, [employeeMonitorItems, employees]);
  const activeProject = useMemo(
    () => (activeProjectId ? projects.find((p) => p.id === activeProjectId) ?? null : null),
    [activeProjectId, projects],
  );
  /** 代码图谱全库搜索：有项目时用项目内全部仓库，否则由面板退化为当前仓库 */
  const codeGraphSearchRepositoryIds = useMemo(() => {
    if (activeProject?.repositoryIds?.length) {
      return activeProject.repositoryIds;
    }
    return undefined;
  }, [activeProject?.repositoryIds]);
  const workspaceMode = useWorkspaceMode({ activeProjectId, projects });
  const composerProjectRoleTagOptions = useMemo(() => {
    if (!shouldHideEmployeeUi(activeProject)) {
      return [];
    }
    return buildProjectRoleTagOptions(activeProject, repositories);
  }, [activeProject, repositories]);
  const composerHideEmployeesInAtMode = useMemo(() => {
    return shouldHideEmployeeUi(activeProject);
  }, [activeProject]);
  const selectableWorkflowEmployeeIds = useMemo(
    () => employeeMonitorItems.map((item) => item.employeeId),
    [employeeMonitorItems],
  );
  useEffect(() => {
    const workflowIds = Array.from(new Set([...workflowTemplates.map((item) => item.id), ...workflowTasks.map((item) => item.workflowId)]));
    const missingIds = workflowIds.filter((workflowId) => !workflowGraphsByWorkflowId[workflowId]);
    if (missingIds.length === 0) {
      return;
    }
    void (async () => {
      const entries = await Promise.all(
        missingIds.map(async (workflowId) => {
          try {
            const item = await getWorkflowGraph({ workflowId });
            return [workflowId, item] as const;
          } catch {
            return [workflowId, null] as const;
          }
        }),
      );
      setWorkflowGraphsByWorkflowId((prev) => {
        const next = { ...prev };
        for (const [workflowId, graphItem] of entries) {
          if (graphItem?.graph) {
            next[workflowId] = graphItem.graph;
          }
        }
        return next;
      });
      setWorkflowGraphStatusByWorkflowId((prev) => {
        const next = { ...prev };
        for (const [workflowId, graphItem] of entries) {
          if (typeof graphItem?.status === "string") {
            next[workflowId] = graphItem.status;
          }
        }
        return next;
      });
    })();
  }, [workflowTemplates, workflowTasks, workflowGraphsByWorkflowId]);

  const repositoriesRefreshKey = useMemo(
    () =>
      repositories
        .map((p) => `${p.id}:${p.path}`)
        .sort()
        .join("|"),
    [repositories],
  );

  useEffect(() => {
    if (!tabsHydrated || !repositoriesRefreshKey) return;
    for (const p of repositories) {
      void refreshDiskSessionsForRepository(p.path, p.name);
    }
  }, [repositories, repositoriesRefreshKey, refreshDiskSessionsForRepository, tabsHydrated]);

  useEffect(() => {
    void (async () => {
      let [repoTpl, projectTpl] = await Promise.all([
        getTaskTemplate("repositorySplit"),
        getTaskTemplate("projectSplit"),
      ]);
      if (!repoTpl) {
        const legacyRepoTpl = (await getAppSetting(LEGACY_APP_SETTING_KEY_REPOSITORY_SPLIT_TEMPLATE))?.trim();
        if (legacyRepoTpl) {
          await setTaskTemplate("repositorySplit", legacyRepoTpl);
          await deleteAppSetting(LEGACY_APP_SETTING_KEY_REPOSITORY_SPLIT_TEMPLATE);
          repoTpl = legacyRepoTpl;
        }
      }
      if (!projectTpl) {
        const legacyProjectTpl = (await getAppSetting(LEGACY_APP_SETTING_KEY_PROJECT_SPLIT_TEMPLATE))?.trim();
        if (legacyProjectTpl) {
          await setTaskTemplate("projectSplit", legacyProjectTpl);
          await deleteAppSetting(LEGACY_APP_SETTING_KEY_PROJECT_SPLIT_TEMPLATE);
          projectTpl = legacyProjectTpl;
        }
      }
      setRepositorySplitTemplate(repoTpl?.trim() || DEFAULT_REPOSITORY_SPLIT_TEMPLATE);
      setProjectSplitTemplate(projectTpl?.trim() || DEFAULT_PROJECT_SPLIT_TEMPLATE);
    })();
  }, []);

  useEffect(() => {
    ensureCrepeToolbarTitleHintsInstalled();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [employeeList, counts, templates] = await Promise.all([
          listEmployees(),
          listEmployeeTaskCounts(),
          listWorkflowTemplates(),
        ]);
        setEmployees(employeeList);
        setEmployeeTaskCounts(counts);
        setWorkflowTemplates(templates);
      } catch (error) {
        console.error("Failed to load employee/workflow data:", error);
      }
    })();
  }, []);

  useEffect(() => {
    if (!activeSessionId) return;
    void (async () => {
      try {
        const tasks = await listWorkflowTasks(activeSessionId);
        setWorkflowTasks((prev) => {
          const untouched = prev.filter((item) => item.creator !== activeSessionId);
          return [...untouched, ...tasks];
        });
        const eventEntries = await Promise.all(
          tasks.slice(0, 8).map(async (task) => [task.id, await listTaskEvents(task.id)] as const),
        );
        const pendingEntries = await Promise.all(
          tasks.slice(0, 8).map(async (task) => [task.id, await listTaskPendingEmployees(task.id)] as const),
        );
        setWorkflowTaskEventsByTaskId((prev) => {
          const next = { ...prev };
          for (const [taskId, events] of eventEntries) {
            next[taskId] = events;
          }
          return next;
        });
        setWorkflowRuntimeSnapshotsByTaskId((prev) => {
          const next = { ...prev };
          for (const [taskId, events] of eventEntries) {
            next[taskId] = extractRuntimeSnapshotsFromEvents(events);
          }
          return next;
        });
        setTaskPendingEmployeesByTaskId((prev) => {
          const next = { ...prev };
          for (const [taskId, employees] of pendingEntries) {
            next[taskId] = employees;
          }
          return next;
        });
      } catch (error) {
        console.error("Failed to load workflow tasks:", error);
      }
    })();
  }, [activeSessionId]);

  const activeRepository = repositories.find((p) => p.id === activeRepositoryId);

  const workflowModalRepositoryPath = useMemo(() => {
    const fromProject = workflowConfigPrdProjectId?.trim();
    if (fromProject) {
      const proj = projects.find((p) => p.id === fromProject);
      const rid = proj?.repositoryIds?.[0];
      if (rid != null) {
        return repositories.find((r) => r.id === rid)?.path ?? null;
      }
      return null;
    }
    return activeRepository?.path ?? null;
  }, [workflowConfigPrdProjectId, projects, repositories, activeRepository?.path]);

  const loadEmployeeAgentTypeOptionsFromRepositoryPath = useCallback(async (repositoryPath: string | null) => {
    try {
      const subagents = await listClaudeSubagents(repositoryPath);
      const sorted = [...subagents].sort((a, b) => {
        if (a.isCollaborationMode !== b.isCollaborationMode) {
          return a.isCollaborationMode ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      const merged = Array.from(new Set(["executor", ...sorted.map((item) => item.name)]));
      setEmployeeAgentTypeOptions(merged);
    } catch (error) {
      console.error("Failed to load claude subagents:", error);
      setEmployeeAgentTypeOptions(["executor"]);
    }
  }, []);

  const openEmployeeConfigWithContext = useCallback(async () => {
    setEmployeeConfigPrdProjectId(null);
    setEmployeeConfigPrdVisibleEmployeeIds([]);
    setEmployeeConfigRepositoryOwnerScopeOnly(false);
    setEmployeeConfigInitialCreateEmployeeName(null);
    setEmployeeConfigDefaultRepositoryIds(activeRepositoryId ? [activeRepositoryId] : []);
    await loadEmployeeAgentTypeOptionsFromRepositoryPath(activeRepository?.path ?? null);
    setEmployeeConfigOpen(true);
  }, [activeRepositoryId, activeRepository?.path, loadEmployeeAgentTypeOptionsFromRepositoryPath]);

  /** WorkflowConfigModal 打开且 templates 就绪时，加载所有 workflow -> projectIds 映射 */
  useEffect(() => {
    if (!workflowConfigOpen || workflowTemplates.length === 0) {
      setWorkflowProjectIdsMap({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        workflowTemplates.map(async (tpl) => {
          try {
            const ids = await listWorkflowProjectIds(tpl.id);
            return [tpl.id, ids] as const;
          } catch {
            return [tpl.id, []] as const;
          }
        }),
      );
      if (!cancelled) {
        setWorkflowProjectIdsMap(Object.fromEntries(entries));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workflowConfigOpen, workflowTemplates]);

  const openEmployeeConfigForProject = useCallback(async () => {
    const pid = activeProjectId?.trim() ?? "";
    if (!pid) {
      message.warning("请先在侧栏选择项目");
      return;
    }
    const proj = projects.find((p) => p.id === pid);
    const repoIds = proj?.repositoryIds ?? [];
    if (repoIds.length === 0) {
      message.warning("该项目下暂无仓库，请先在侧栏为项目关联仓库后再新增员工");
      return;
    }
    setEmployeeConfigPrdProjectId(pid);
    setEmployeeConfigRepositoryOwnerScopeOnly(false);
    setEmployeeConfigInitialCreateEmployeeName(null);
    setEmployeeConfigDefaultRepositoryIds([...repoIds]);
    let prdEmployeeIds: string[] = [];
    try {
      prdEmployeeIds = await listProjectPrdEmployeeIds(pid);
    } catch (error) {
      console.error("Failed to list project PRD employee ids:", error);
    }
    setEmployeeConfigPrdVisibleEmployeeIds(prdEmployeeIds);
    const firstRepo = repositories.find((r) => r.id === repoIds[0]);
    await loadEmployeeAgentTypeOptionsFromRepositoryPath(firstRepo?.path ?? null);
    setEmployeeConfigOpen(true);
  }, [activeProjectId, projects, repositories, loadEmployeeAgentTypeOptionsFromRepositoryPath]);

  const openEmployeeConfigForRepositoryOwner = useCallback(
    async (repository: Repository) => {
      setEmployeeConfigRepositoryOwnerScopeOnly(true);
      setEmployeeConfigInitialCreateEmployeeName(repositoryFolderBasename(repository));
      setEmployeeConfigPrdProjectId(null);
      setEmployeeConfigPrdVisibleEmployeeIds([]);
      setEmployeeConfigDefaultRepositoryIds([repository.id]);
      await loadEmployeeAgentTypeOptionsFromRepositoryPath(repository.path);
      setEmployeeConfigOpen(true);
    },
    [loadEmployeeAgentTypeOptionsFromRepositoryPath],
  );

  const openWorkflowConfigFromSidebar = useCallback(() => {
    setWorkflowConfigPrdProjectId(null);
    setWorkflowConfigOpen(true);
  }, []);

  const openWorkflowConfigForProject = useCallback(() => {
    const pid = activeProjectId?.trim() ?? "";
    if (!pid) {
      message.warning("请先在侧栏选择项目");
      return;
    }
    const proj = projects.find((p) => p.id === pid);
    if (!proj?.repositoryIds?.length) {
      message.warning("该项目下暂无仓库，请先在侧栏为项目关联仓库后再管理团队");
      return;
    }
    setWorkflowConfigPrdProjectId(pid);
    setWorkflowConfigOpen(true);
  }, [activeProjectId, projects]);

  const {
    compactLayoutMode,
    effectiveRightCollapsed,
    handleDualPaneSecondaryRepositorySelect,
    handleNewSecondarySession,
    handleToggleCompactLayoutMode,
    handleToggleDualPane,
    handleToggleRightPanel,
    mainLayoutContentRef,
    mainLayoutLeftWidthPx,
    mainLayoutRightWidthPx,
    setMainLayoutLeftWidthPx,
    setMainLayoutRightWidthPx,
  } = useMainLayoutModes({
    activeRepository,
    activeSessionId,
    collapsed,
    createSession,
    dualPaneEnabled,
    dualPaneSecondarySessionId,
    repositories,
    repositoryMainSessionBindings,
    sessions,
    setActiveRepositoryId,
    setDualPaneEnabled,
    setDualPaneSecondaryRepositoryId,
    setDualPaneSecondarySessionId,
  });

  const handleAddWorktreeRepositoryToProject = useCallback(
    async (worktreePath: string) => {
      if (!activeProjectId) {
        message.warning("请先在侧栏选择或创建一个项目");
        return;
      }
      const repositoryType = activeRepository?.repositoryType ?? "frontend";
      try {
        const result = await handleAddRepositoryPathToProject(activeProjectId, worktreePath, repositoryType);
        if (result === "already_in_project") {
          message.info("该 worktree 目录已在当前项目中");
        } else {
          message.success("已将 worktree 目录加入当前项目");
        }
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error));
      }
    },
    [activeProjectId, activeRepository, handleAddRepositoryPathToProject],
  );

  const resolveTaskListOmcInvokeConcurrency = useCallback(
    (sess: ClaudeSession) =>
      resolveClaudeConcurrencyInvokeContext({
        session: sess,
        projects,
        repositories,
        limitsMap: claudeConcurrencyLimitsMap,
        preferredProjectId: activeProjectId,
      }),
    [projects, repositories, claudeConcurrencyLimitsMap, activeProjectId],
  );

  const handleRefreshHistorySessions = useCallback(() => {
    if (!activeRepository) {
      return Promise.resolve();
    }
    return refreshDiskSessionsForRepository(activeRepository.path, activeRepository.name);
  }, [activeRepository, refreshDiskSessionsForRepository]);

  const handleSidebarRepositorySelect = useCallback(
    (repositoryId: number | null) => {
      if (repositoryId == null) {
        setActiveRepositoryId(null);
        return;
      }
      const repository = repositories.find((item) => item.id === repositoryId);
      if (!repository) {
        return;
      }
      setActiveRepositoryWithOwner(repositoryId);
      const ownerProject = projects.find((p) => p.repositoryIds.includes(repositoryId)) ?? null;
      const target = resolveSidebarSelectionTarget({
        repository,
        ownerProject,
        repositories,
      });
      const mainOwnerPick = resolveMainOwnerAgentNameForRepositoryPath(repositories, target.path);
      const boundId = resolveRepositoryMainSessionId(
        target.path,
        repositoryMainSessionBindings,
        sessions,
        mainOwnerPick,
      );
      if (boundId) {
        switchSession(boundId);
        return;
      }
      const latestForRepo = pickSessionForRepositorySidebarSelect(
        sessions,
        target.path,
        loadSessionOwnerHints(),
        { mainOwnerAgentName: mainOwnerPick },
      );
      if (latestForRepo) {
        bindRepositoryMainSession(target.path, latestForRepo.id);
        switchSession(latestForRepo.id);
        return;
      }
      void (async () => {
        const id = await createSession(target.path, target.displayName);
        bindRepositoryMainSession(target.path, id);
      })();
    },
    [
      bindRepositoryMainSession,
      createSession,
      projects,
      repositories,
      repositoryMainSessionBindings,
      sessions,
      setActiveRepositoryId,
      setActiveRepositoryWithOwner,
      switchSession,
    ],
  );

  /**
   * 进入应用：仓库与会话 hydrated 后，对 `useRepositoryList` 通过 lastSession 或首项策略
   * 选出的 `activeRepositoryId` 打开/恢复主会话（不再要求首项必须是 project，游离 repo 同样适用）。
   */
  const startupFirstProjectRepoSessionAppliedRef = useRef(false);
  useEffect(() => {
    if (repositoryListLoading || !tabsHydrated) return;
    if (startupFirstProjectRepoSessionAppliedRef.current) return;
    if (activeRepositoryId == null) return;
    if (!repositories.some((r) => r.id === activeRepositoryId)) return;
    startupFirstProjectRepoSessionAppliedRef.current = true;
    handleSidebarRepositorySelect(activeRepositoryId);
  }, [
    activeRepositoryId,
    handleSidebarRepositorySelect,
    repositories,
    repositoryListLoading,
    tabsHydrated,
  ]);

  const handleSidebarRepositorySelectLeavingMcpHub = useCallback(
    (repositoryId: number | null) => {
      setMcpHubMode(false);
      setSkillsHubMode(false);
      setTaskSplitMode(false);
      handleSidebarRepositorySelect(repositoryId);
    },
    [handleSidebarRepositorySelect],
  );

  const handleProjectSelectLeavingMcpHub = useCallback(
    (projectId: string) => {
      setMcpHubMode(false);
      setSkillsHubMode(false);
      const project = projects.find((p) => p.id === projectId) ?? null;
      const firstRepoId = project?.repositoryIds[0] ?? null;
      // 进项目即开主会话：通过 handleSidebarRepositorySelect 统一路由
      // - multi_repo → 绑定/恢复/创建 anchor.path 上的项目主会话
      // - single_repo → per-repo session
      // - 项目无 repo → 只切 activeProjectId 等待用户后续操作
      if (firstRepoId != null) {
        handleSidebarRepositorySelect(firstRepoId);
      } else {
        setActiveProjectId(projectId);
      }
    },
    [handleSidebarRepositorySelect, projects, setActiveProjectId],
  );

  const jumpToSessionLeavingMcpHub = useCallback(
    (sessionId: string) => {
      setMcpHubMode(false);
      setSkillsHubMode(false);
      jumpToSessionWithRepository(sessionId);
    },
    [jumpToSessionWithRepository],
  );

  async function handleCreateRepositoryTask(repository: Repository, mode: TaskMode) {
    setActiveRepositoryWithOwner(repository.id);
    const ownerProject = projects.find((p) => p.repositoryIds.includes(repository.id)) ?? null;
    const target = resolveSidebarSelectionTarget({
      repository,
      ownerProject,
      repositories,
    });
    if (mode === "chat") {
      setTaskSplitMode(false);
      const id = await createSession(target.path, target.displayName);
      bindRepositoryMainSession(target.path, id);
      return;
    }
    if (mode === "split") {
      setSearchOpen(false);
      setPromptsMode(false);
      setTaskSplitMode(true);
      return;
    }
    // 默认模式（split prompt 执行）保持 per-repo 语义：repo 维度的任务拆分依赖 repo.path 上下文
    const sessionId = await createSession(repository.path, repositorySessionTabDisplayName(repository));
    executeSession(
      sessionId,
      applyTemplate(repositorySplitTemplate || DEFAULT_REPOSITORY_SPLIT_TEMPLATE, {
        repoName: repositoryFolderBasename(repository),
        repoType: repositoryTypeChineseLabel(repository.repositoryType),
        repoPath: repository.path,
      }),
    );
  }

  async function handleCreateProjectTask(project: ProjectItem, mode: TaskMode) {
    const byId = new Map(repositories.map((repo) => [repo.id, repo]));
    const repos = project.repositoryIds
      .map((id) => byId.get(id))
      .filter((repo): repo is Repository => Boolean(repo));
    if (repos.length === 0) {
      message.warning("该项目下暂无仓库，请先关联仓库");
      return;
    }
    const anchor = resolveProjectMainSessionAnchor(project, repositories);
    if (!anchor.path) {
      message.warning("该项目缺少根目录，请先在项目设置中配置 rootPath");
      return;
    }
    const primaryRepo = repos[0];
    setActiveProjectId(project.id);
    setActiveRepositoryId(primaryRepo.id);
    if (mode === "chat") {
      const id = await createSession(anchor.path, anchor.displayName);
      bindRepositoryMainSession(anchor.path, id);
      return;
    }
    if (mode === "split") {
      setSearchOpen(false);
      setPromptsMode(false);
      setTaskSplitMode(true);
      return;
    }
    const sessionId = await createSession(anchor.path, anchor.displayName);
    const repoPaths = repos.map((repo) => `- ${repo.path}`).join("\n");
    executeSession(
      sessionId,
      applyTemplate(projectSplitTemplate || DEFAULT_PROJECT_SPLIT_TEMPLATE, {
        projectName: project.name,
        repoName: repositoryFolderBasename(primaryRepo),
        repoPath: anchor.isProjectRooted ? anchor.path : primaryRepo.path,
        repoList: repoPaths,
      }),
    );
  }

  function handleOpenInFinder(repository: Repository) {
    openInFinder(repository.path).catch((err) => {
      console.error("Failed to open in finder:", err);
    });
  }

  function handleOpenPromptsForProject(project: ProjectItem) {
    setMcpHubMode(false);
    setSkillsHubMode(false);
    setPromptsOpenContext({ project });
    setActiveProjectId(project.id);
    setSearchOpen(false);
    setTaskSplitMode(false);
    setPromptsMode(true);
  }

  function handleOpenPromptsForRepository(project: ProjectItem, repository: Repository) {
    setMcpHubMode(false);
    setSkillsHubMode(false);
    setPromptsOpenContext({ project, repository });
    setActiveProjectId(project.id);
    setActiveRepositoryId(repository.id);
    setSearchOpen(false);
    setTaskSplitMode(false);
    setPromptsMode(true);
  }

  async function refreshWorkflowTemplates() {
    const templates = await listWorkflowTemplates();
    setWorkflowTemplates(templates);
  }

  useEffect(() => {
    function handleGlobalKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      // Control+`（物理 Backquote）：切换终端面板；仅用 Ctrl、不含 ⌘，与 macOS Control 一致
      if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && (e.code === "Backquote" || e.key === "`")) {
        e.preventDefault();
        setTerminalCollapsed((c) => !c);
        return;
      }
      if (mod && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
        return;
      }
      if (mod && e.shiftKey && (e.code === "KeyM" || e.key === "M" || e.key === "m")) {
        e.preventDefault();
        void wiseMascotShow().catch(() => {});
        return;
      }
      // Cmd/Ctrl+R：捕获阶段处理，避免焦点在 contentEditable / AntD 内部时冒泡不到 window；
      // 用 code===KeyR 对齐物理 R 键（与系统刷新一致）
      if (mod && (e.code === "KeyR" || e.key === "r" || e.key === "R")) {
        e.preventDefault();
        void reloadAppWindow();
      }
    }
    window.addEventListener("keydown", handleGlobalKey, { capture: true });
    return () => window.removeEventListener("keydown", handleGlobalKey, { capture: true });
  }, []);

  useEffect(() => {
    function handleOpenTaskSplitPanel() {
      setSearchOpen(false);
      setPromptsMode(false);
      setMcpHubMode(false);
      setSkillsHubMode(false);
      setTaskSplitMode(true);
    }
    window.addEventListener(WORKFLOW_UI_EVENT_OPEN_TASK_SPLIT_PANEL, handleOpenTaskSplitPanel as EventListener);
    return () => {
      window.removeEventListener(WORKFLOW_UI_EVENT_OPEN_TASK_SPLIT_PANEL, handleOpenTaskSplitPanel as EventListener);
    };
  }, []);

  handleStopEmployeeMonitorRef.current = (employeeId: string) => {
    const normalizedEmployeeId = employeeId.trim().toLowerCase();
    if (normalizedEmployeeId === "omc-worker" || normalizedEmployeeId.includes("omc")) {
      const omcItem = employeeMonitorItems.find((entry) => entry.employeeId === employeeId);
      const omcStopSnapshot = getOmcMonitorStopSnapshot();
      const anchorSessionIdForEvent =
        omcStopSnapshot.batchSessionId ||
        omcItem?.sessionId?.trim() ||
        activeSessionIdLatestRef.current?.trim() ||
        undefined;
      void (async () => {
        try {
          if (omcStopSnapshot.invocationKeys.length > 0) {
            const cancelResults = await Promise.allSettled(
              omcStopSnapshot.invocationKeys.map(async (invocationKey) => {
                await cancelClaudeInvocation(invocationKey);
              }),
            );
            const failed = cancelResults.filter((result) => result.status === "rejected");
            if (failed.length > 0) {
              console.error("Failed to cancel OMC invocations:", failed);
              message.warning(`部分子进程未能结束（${failed.length}/${omcStopSnapshot.invocationKeys.length}），其余已发送取消`);
            }
          } else if (omcItem?.sessionId) {
            cancelSession(omcItem.sessionId);
          } else if (activeSessionId?.trim()) {
            cancelSession(activeSessionId.trim());
          }
        } catch (err) {
          console.error("Failed to stop OMC worker:", err);
        } finally {
          markOmcBatchRuntimeAborted(anchorSessionIdForEvent);
        }
      })();
      return;
    }
    const item = employeeMonitorItems.find((entry) => entry.employeeId === employeeId);
    if (item?.sessionId) {
      cancelSession(item.sessionId);
    }
    if (!item?.activeTaskId) return;
    const hasWorkflowTask = workflowTasksRef.current.some((task) => task.id === item.activeTaskId);
    if (!hasWorkflowTask) {
      return;
    }
    const targetTaskId = item.activeTaskId;
    void endWorkflowTask({
      taskId: targetTaskId,
      reason: "在监控面板中手动结束员工任务",
    })
      .then(async (updatedTask) => {
        setWorkflowTasks((prev) => prev.map((task) => (task.id === updatedTask.id ? updatedTask : task)));
        const [events, pendingEmployees] = await Promise.all([
          listTaskEvents(updatedTask.id),
          listTaskPendingEmployees(updatedTask.id),
        ]);
        setWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [updatedTask.id]: events }));
        setTaskPendingEmployeesByTaskId((prev) => ({ ...prev, [updatedTask.id]: pendingEmployees }));
      })
      .catch((error) => {
        console.error("Failed to end employee workflow task:", error);
        message.error("结束员工任务失败");
      });
  };

  return (
    <>
    <AppWorkspaceLayout
      dark={dark}
      collapsed={collapsed}
      promptsMode={promptsMode}
      taskSplitMode={taskSplitMode}
      taskPanelMode={taskPanelMode}
      mcpHubMode={mcpHubMode}
      skillsHubMode={skillsHubMode}
      codeKnowledgeGraphMode={codeKnowledgeGraphMode}
      compactLayoutMode={compactLayoutMode}
      effectiveRightCollapsed={effectiveRightCollapsed}
      mainLayoutContentRef={mainLayoutContentRef}
      mainLayoutLeftWidthPx={mainLayoutLeftWidthPx}
      mainLayoutRightWidthPx={mainLayoutRightWidthPx}
      onToggleCompactLayoutMode={handleToggleCompactLayoutMode}
      onLeftWidthChange={setMainLayoutLeftWidthPx}
      onRightWidthChange={setMainLayoutRightWidthPx}
      activeRepositoryPath={activeRepository?.path}
      leftSidebarProps={{
        projects,
        activeProjectId,
        repositories,
        activeRepositoryId,
        mcpNavActive: mcpHubMode,
        onOpenMcpHub: () => {
          setPromptsMode(false);
          setSkillsHubMode(false);
          setCodeKnowledgeGraphMode(false);
          setMcpHubMode(true);
        },
        skillsNavActive: skillsHubMode,
        onOpenSkillsHub: () => {
          setPromptsMode(false);
          setMcpHubMode(false);
          setCodeKnowledgeGraphMode(false);
          setSkillsHubMode(true);
        },
        codeKnowledgeGraphNavActive: codeKnowledgeGraphMode,
        onOpenCodeKnowledgeGraph: () => {
          setPromptsMode(false);
          setMcpHubMode(false);
          setSkillsHubMode(false);
          setCodeKnowledgeGraphMode(true);
        },
        onProjectSelect: handleProjectSelectLeavingMcpHub,
        onCreateProject: handleCreateProject,
        onUpdateProject: handleUpdateProject,
        onDeleteProject: handleDeleteProject,
        pinnedProjectIds,
        onTogglePinProject: togglePinProject,
        onAddRepositoryToProject: handleAddRepositoryToProject,
        onAddFloatingRepository: handleAddFloatingRepository,
        onPromoteFloatingRepositoryToProject: handlePromoteFloatingRepositoryToProject,
        floatingRepositories,
        onRemoveRepository: handleRemoveRepository,
        onDetachRepositoryFromProject: handleDetachRepositoryFromProject,
        onUpdateRepositorySddMode: handleUpdateRepositorySddMode,
        onReorderRepositoriesInProject: handleReorderRepositoriesInProject,
        onMoveRepositoryToProject: handleMoveRepositoryToProject,
        onRepositorySelect: handleSidebarRepositorySelectLeavingMcpHub,
        onOpenInFinder: handleOpenInFinder,
        onCreateProjectTask: handleCreateProjectTask,
        onCreateRepositoryTask: handleCreateRepositoryTask,
        onOpenPromptsProject: handleOpenPromptsForProject,
        onOpenPromptsRepository: handleOpenPromptsForRepository,
        onOpenRepositoryMainOwner: (repository) => {
          void openEmployeeConfigForRepositoryOwner(repository);
        },
        sessions,
        activeSessionId,
        onSelectSession: jumpToSessionLeavingMcpHub,
        employees,
        employeeTaskCounts,
        onMoveEmployee: async (employeeId, direction) => {
          await moveEmployeeDisplayOrder({ employeeId, direction });
          await refreshEmployeeData();
        },
        onCancelSessionFromMonitor: cancelSession,
        onOpenTaskDetailFromMonitor: (taskId) => {
          setMonitorDrawerTarget({ type: "task", taskId });
        },
        onReloadFullDiskTranscript: reloadFullDiskTranscript,
        activeRepositoryPath: activeRepository?.path,
        activeRepositoryName: activeRepository?.name,
      }}
      promptsPanelProps={{
        onClose: () => {
          setPromptsOpenContext(null);
          setPromptsMode(false);
        },
        projects,
        repositories,
        activeProjectId,
        activeRepositoryId,
        openContext: promptsOpenContext,
        repositoryListLoading,
      }}
      claudeSessionsProps={{
        sessions,
        activeSessionId,
        onReloadFullDiskTranscript: reloadFullDiskTranscript,
        omcBatchPipelineActive: Boolean(omcBatchRuntime?.active),
        onAddWorktreeRepositoryToProject: handleAddWorktreeRepositoryToProject,
        activeRepository,
        repositories,
        activeRepositoryId,
        workspaceMode,
        activeProject,
        onSelectRepository: setActiveRepositoryId,
        onUpdateSessionModel: updateSessionModel,
        onExecuteSession: handleComposerExecute,
        onSendMessage: handleSendMessageWithAtMention,
        onCancelSession: cancelSession,
        onCloseSession: handleCloseSession,
        onSwitchSession: jumpToSessionWithRepository,
        onNewSession: (repository) => void handleCreateRepositoryTask(repository, "chat"),
        repositoryMainBindings: repositoryMainSessionBindings,
        onAppendSystemMessage: appendSystemMessage,
        onAppendUserMessage: appendUserMessage,
        onNotifyOmcEmployeeDirectBatchTaskDone: notifyOmcEmployeeDirectBatchTaskDone,
        onPrepareFreshOmcEmployeeWorkerForDirectBatch: prepareFreshOmcEmployeeWorkerForDirectBatch,
        onRefreshHistorySessions: handleRefreshHistorySessions,
        onDeleteHistorySession: handleDeleteHistorySession,
        onRespondToQuestion: respondToQuestion,
        onDismissQuestion: dismissQuestion,
        onRespondToPermission: respondToPermission,
        onClearTodos: clearTodos,
        onClearFollowups: clearFollowups,
        onClearRevertItems: clearRevertItems,
        onSendFollowup: sendFollowup,
        onRestoreRevert: restoreRevert,
        dualPaneEnabled,
        onToggleDualPane: handleToggleDualPane,
        secondarySessionId: dualPaneSecondarySessionId,
        dualPaneSecondaryRepositoryId,
        onDualPaneSecondaryRepositorySelect: handleDualPaneSecondaryRepositorySelect,
        onNewSecondarySession: handleNewSecondarySession,
        onToggleSidebar: () => setCollapsed((c) => !c),
        onToggleRightPanel: handleToggleRightPanel,
        onToggleTerminal: () => setTerminalCollapsed((c) => !c),
        onSearch: () => setSearchOpen(true),
        collapsed,
        rightCollapsed: effectiveRightCollapsed,
        terminalCollapsed,
        onOpenWorkflowConfig: openWorkflowConfigFromSidebar,
        employees,
        mentionEmployees,
        composerProjectRoleTagOptions,
        composerHideEmployeesInAtMode,
        workflowTasks,
        taskPendingEmployeesByTaskId,
        workflowTemplates,
        workflowGraphsByWorkflowId,
        workflowGraphStatusByWorkflowId,
        onOpenTaskDetail: (taskId) => {
          setMonitorDrawerTarget({ type: "task", taskId });
        },
        taskListConcurrentCapacity: monitorClaudeConcurrency
          ? Math.max(0, monitorClaudeConcurrency.limit - monitorClaudeConcurrency.activeCount)
          : undefined,
        resolveTaskListOmcInvokeConcurrency,
        onDecideWorkflowTask: handleDecideWorkflowTask,
      }}
      rightPanelProps={{
        dark,
        collapsed: effectiveRightCollapsed,
        siderWidth: mainLayoutRightWidthPx,
        repositoryPath: activeRepository?.path,
        repositoryName: activeRepository?.name,
        monitorStats,
        monitorPanelSessions: monitorPanelSessionsMerged,
        monitorTranscriptSourceSessions: sessions,
        employeeMonitorItems,
        repositoryMemberMonitorItems,
        teamMonitorItems,
        monitorActiveTarget: monitorDrawerTarget,
        onOpenTeamMonitorDetail: (workflowId) => {
          setMonitorDrawerTarget({ type: "team", workflowId });
        },
        onOpenEmployeeConfig: () => {
          void openEmployeeConfigWithContext();
        },
        onOpenWorkflowConfig: openWorkflowConfigFromSidebar,
        onStopEmployeeMonitor: (employeeId) => handleStopEmployeeMonitorRef.current(employeeId),
        onStopTeamMonitor: (workflowId) => {
          const item = teamMonitorItems.find((entry) => entry.workflowId === workflowId);
          if (!item?.activeTaskId) return;
          const targetTaskId = item.activeTaskId;
          const task = workflowTasks.find((entry) => entry.id === targetTaskId);
          if (task?.creator) {
            cancelSession(task.creator);
          }
          void endWorkflowTask({
            taskId: targetTaskId,
            reason: "在监控面板中手动结束团队任务",
          })
            .then(async (updatedTask) => {
              setWorkflowTasks((prev) =>
                prev.map((entry) => (entry.id === updatedTask.id ? updatedTask : entry)),
              );
              const [events, pendingEmployees] = await Promise.all([
                listTaskEvents(updatedTask.id),
                listTaskPendingEmployees(updatedTask.id),
              ]);
              setWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [updatedTask.id]: events }));
              setTaskPendingEmployeesByTaskId((prev) => ({ ...prev, [updatedTask.id]: pendingEmployees }));
            })
            .catch((error) => {
              console.error("Failed to end team workflow task:", error);
              message.error("结束团队任务失败");
            });
        },
        monitorClaudeConcurrency,
        onCancelSessionFromMonitor: cancelSession,
        onOpenTaskDetailFromMonitor: (taskId) => {
          setMonitorDrawerTarget({ type: "task", taskId });
        },
        onOpenOmcBatchInvocationDetail: handleOpenOmcBatchInvocationDetail,
        onCancelOmcDirectBatchInvocation: handleCancelOmcDirectBatchInvocation,
        onReloadFullDiskTranscript: reloadFullDiskTranscript,
        hideEmployeeUi: shouldHideEmployeeUi(activeProject),
      }}
      commandPaletteProps={{
        open: searchOpen,
        onClose: () => setSearchOpen(false),
        repositoryPath: activeRepository?.path,
      }}
      mcpHubProps={{
        repositoryPath: activeRepository?.path ?? null,
        onClose: () => setMcpHubMode(false),
      }}
      skillsHubProps={{
        repositoryPath: activeRepository?.path ?? null,
        onClose: () => setSkillsHubMode(false),
      }}
      codeKnowledgeGraphProps={{
        repositoryId: activeRepository?.id ?? null,
        repositories: repositories.map((r) => ({ id: r.id, name: r.name, path: r.path })),
        searchRepositoryIds: codeGraphSearchRepositoryIds,
        onSelectRepository: setActiveRepositoryId,
        onClose: () => setCodeKnowledgeGraphMode(false),
      }}
      prdTaskSplitPanelProps={{
        onClose: () => setTaskSplitMode(false),
        projects,
        repositories,
        activeProjectId,
        activeRepositoryId,
        employees,
        workflowTemplates,
        onOpenEmployeeConfigForProject: () => void openEmployeeConfigForProject(),
        onOpenWorkflowConfigForProject: openWorkflowConfigForProject,
      }}
      progressMonitorDrawerProps={{
        open: monitorDrawerTarget != null,
        target: monitorDrawerTarget,
        onClose: () => setMonitorDrawerTarget(null),
        employeeItems: employeeMonitorItems,
        teamItems: teamMonitorItems,
        workflowTasks,
        workflowTaskEventsByTaskId,
        workflowRuntimeSnapshotsByTaskId,
        taskPendingEmployeesByTaskId,
        sessions: monitorPanelSessionsMerged,
        transcriptSourceSessions: sessions,
        employees,
        workflowTemplates,
        workflowGraphsByWorkflowId,
        onOpenOmcBatchInvocationDetail: (input) => {
          handleOpenOmcBatchInvocationDetail(input);
          setMonitorDrawerTarget(null);
        },
        onCancelOmcDirectBatchInvocation: handleCancelOmcDirectBatchInvocation,
        onJumpToSession: (sessionId) => {
          jumpToSessionWithRepository(sessionId);
          setMonitorDrawerTarget(null);
        },
        onReloadFullDiskTranscript: reloadFullDiskTranscript,
        onCancelSession: cancelSession,
        onOpenTaskDetail: (taskId) => {
          setMonitorDrawerTarget({ type: "task", taskId });
        },
      }}
      employeeConfigModalProps={
        employeeConfigOpen
          ? {
              open: employeeConfigOpen,
              loading: employeeLoading,
              employees,
              workflowTemplates,
              workflowGraphsByWorkflowId,
              repositories,
              projects,
              agentTypeOptions: employeeAgentTypeOptions,
              defaultRepositoryIds: employeeConfigDefaultRepositoryIds,
              hideEmployeesAssociatedOnlyWithDefaultRepositories:
                Boolean(employeeConfigPrdProjectId?.trim()) || employeeConfigRepositoryOwnerScopeOnly,
              alwaysShowEmployeeIds: employeeConfigPrdVisibleEmployeeIds,
              repositoryOwnerScopeOnly: employeeConfigRepositoryOwnerScopeOnly,
              initialCreateEmployeeName: employeeConfigInitialCreateEmployeeName,
              singleProjectScopeId: employeeConfigPrdProjectId?.trim() || null,
              onClose: () => {
                setEmployeeConfigOpen(false);
                setEmployeeConfigPrdProjectId(null);
                setEmployeeConfigPrdVisibleEmployeeIds([]);
                setEmployeeConfigRepositoryOwnerScopeOnly(false);
                setEmployeeConfigInitialCreateEmployeeName(null);
              },
              onCreate: async (input) => {
                setEmployeeLoading(true);
                try {
                  const linkPid = employeeConfigPrdProjectId?.trim() ?? "";
                  const created = await createEmployee({
                    name: input.name,
                    agentType: input.agentType,
                    enabled: input.enabled,
                    repositoryIds: input.repositoryIds,
                    projectIds: linkPid ? [linkPid] : [],
                  });
                  if (linkPid) {
                    setEmployeeConfigPrdVisibleEmployeeIds((prev) =>
                      prev.includes(created.id) ? prev : [...prev, created.id],
                    );
                  }
                  if (input.ownerRepositoryId != null) {
                    try {
                      const ownerRepo = repositories.find((r) => r.id === input.ownerRepositoryId);
                      if (ownerRepo) {
                        await handlePersistRepositoryMainOwnerAgent(ownerRepo, created.agentType.trim());
                      } else {
                        await handleUpdateRepositoryMainOwnerAgent(input.ownerRepositoryId, created.agentType.trim());
                      }
                    } catch (err) {
                      message.error(`员工已创建，但设置仓库失败：${toUiErrorMessage(err)}`);
                    }
                  }
                  await refreshEmployeeData();
                } finally {
                  setEmployeeLoading(false);
                }
              },
              onUpdate: async (input) => {
                setEmployeeLoading(true);
                try {
                  await updateEmployee({
                    ...input,
                    projectIds: input.projectIds,
                  });
                  await refreshEmployeeData();
                } finally {
                  setEmployeeLoading(false);
                }
              },
              onDelete: async (employeeId) => {
                setEmployeeLoading(true);
                try {
                  const row = employees.find((e) => e.id === employeeId);
                  await deleteEmployee(employeeId);
                  const agent = row?.agentType?.trim();
                  if (agent && row?.repositoryIds?.length) {
                    for (const rid of row.repositoryIds) {
                      const r = repositories.find((x) => x.id === rid);
                      if (r?.mainOwnerAgentName?.trim() === agent) {
                        try {
                          await handlePersistRepositoryMainOwnerAgent(r, null);
                        } catch {
                          /* ignore per-repo clear errors */
                        }
                      }
                    }
                  }
                  setEmployeeConfigPrdVisibleEmployeeIds((prev) => prev.filter((id) => id !== employeeId));
                  await refreshEmployeeData();
                } finally {
                  setEmployeeLoading(false);
                }
              },
            }
          : null
      }
      workflowConfigModalProps={
        workflowConfigOpen
          ? {
              open: workflowConfigOpen,
              loading: workflowLoading,
              employees,
              repositoryPath: workflowModalRepositoryPath,
              templates: workflowTemplates,
              projects,
              workflowProjectIds: workflowProjectIdsMap,
              selectableEmployeeIds: selectableWorkflowEmployeeIds,
              onClose: () => {
                setWorkflowConfigOpen(false);
                setWorkflowConfigPrdProjectId(null);
              },
              onSaveTemplate: async (input) => {
                setWorkflowLoading(true);
                try {
                  const savedTemplate = await saveWorkflowTemplate(input);
                  await refreshWorkflowTemplates();
                  const linkPid = workflowConfigPrdProjectId?.trim() ?? "";
                  if (linkPid) {
                    try {
                      await addProjectPrdWorkflow(linkPid, savedTemplate.id);
                      message.success("已关联到当前项目");
                    } catch (err) {
                      message.error(`模板已保存，但关联到项目失败：${toUiErrorMessage(err)}`);
                    }
                  }
                  return savedTemplate;
                } finally {
                  setWorkflowLoading(false);
                }
              },
              onLoadGraphItem: async (workflowId) => {
                return getWorkflowGraph({ workflowId });
              },
              onSaveGraph: async (input) => {
                const savedGraph = await saveWorkflowGraph({
                  workflowId: input.workflowId,
                  graph: input.graph,
                  status: input.status,
                });
                setWorkflowGraphsByWorkflowId((prev) => ({
                  ...prev,
                  [input.workflowId]: savedGraph.graph,
                }));
                setWorkflowGraphStatusByWorkflowId((prev) => ({
                  ...prev,
                  [input.workflowId]: savedGraph.status,
                }));
              },
              onValidateGraph: async (graph) => {
                return validateWorkflowGraph({ graph });
              },
              onDeleteTemplate: async (workflowId) => {
                setWorkflowLoading(true);
                try {
                  await deleteWorkflowTemplate(workflowId);
                  await refreshWorkflowTemplates();
                  message.success("团队已删除");
                } catch (error) {
                  const messageText = toUiErrorMessage(error);
                  message.error(`删除团队失败：${messageText}`);
                } finally {
                  setWorkflowLoading(false);
                }
              },
            }
          : null
      }
    />
    </>
  );
}
