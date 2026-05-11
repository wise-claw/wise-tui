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
import { repositoryFolderBasename, repositoryTypeChineseLabel } from "./utils/repositoryType";
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
  resolveBoundMainSessionId,
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
import { useRepositoryFileEditor } from "./hooks/useRepositoryFileEditor";
import { useMainLayoutModes } from "./hooks/useMainLayoutModes";
import { useDingTalkAutomationInbound } from "./hooks/useDingTalkAutomationInbound";
import { useOmcRuntime } from "./hooks/useOmcRuntime";
import { useWorkflowTeamAutomation } from "./hooks/useWorkflowTeamAutomation";

// ── App ──

export default function App() {
  const [taskSplitMode, setTaskSplitMode] = useState(false);
  const [promptsMode, setPromptsMode] = useState(false);
  /** 左栏 MCP：在主区+右栏之上叠层展示（与技能目录相同，不盖左栏）。 */
  const [mcpHubMode, setMcpHubMode] = useState(false);
  /** 左栏技能：在主区+右栏之上叠层展示 skills.sh（不盖左栏，非全屏居中 Modal）。 */
  const [skillsHubMode, setSkillsHubMode] = useState(false);
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
  const [employeeAgentTypeOptions, setEmployeeAgentTypeOptions] = useState<string[]>(["executor"]);
  const [workflowConfigOpen, setWorkflowConfigOpen] = useState(false);
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
    selectProjectAndRepository,
    handleCreateProject,
    handleUpdateProject,
    handleDeleteProject,
    handleAddRepositoryToProject,
    handleAddRepositoryPathToProject,
    handleDetachRepositoryFromProject,
    handleReorderRepositoriesInProject,
    handleMoveRepositoryToProject,
    pinnedProjectIds,
    togglePinProject,
  } = useRepositoryList();

  const [repositoryMainSessionBindings, setRepositoryMainSessionBindings] = useState<Record<string, string>>({});

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
  const activeSessionIdLatestRef = useRef(activeSessionId);
  activeSessionIdLatestRef.current = activeSessionId;

  /** 与 ClaudeSessions 内 handleSwitchToSession 对齐：先同步项目+仓库再切会话，否则 activeSession 会因 path 不一致为空。 */
  const jumpToSessionWithRepository = useCallback(
    (sessionId: string) => {
      const sid = sessionId.trim();
      if (!sid) return;
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
      const wantPath = normalizeRepositoryPathForMatch(target.repositoryPath);
      const repo = repositories.find((item) => normalizeRepositoryPathForMatch(item.path) === wantPath);
      if (repo) {
        const ownerProject = projects.find((p) => p.repositoryIds.includes(repo.id));
        flushSync(() => {
          if (ownerProject) {
            selectProjectAndRepository(ownerProject.id, repo.id);
          } else {
            setActiveRepositoryId(repo.id);
          }
        });
      }
      switchSession(canonicalId);
    },
    [projects, repositories, selectProjectAndRepository, setActiveRepositoryId, switchSession],
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
    sessions,
    setEmployeeTaskCounts,
    setEmployees,
    setTaskPendingEmployeesByTaskId,
    setWorkflowRuntimeSnapshotsByTaskId,
    setWorkflowRuntimeStateByTaskId,
    setWorkflowTaskEventsByTaskId,
    setWorkflowTasks,
    switchSession,
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

  const { employeeMonitorItems, teamMonitorItems, stats: monitorStats } = useMonitorOverview({
    employees,
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
  const selectableWorkflowEmployeeIds = useMemo(
    () => employeeMonitorItems.map((item) => item.employeeId),
    [employeeMonitorItems],
  );
  const publishedTeamMonitorItems = useMemo(
    () =>
      teamMonitorItems.filter(
        (item) => (workflowGraphStatusByWorkflowId[item.workflowId] ?? "").toLowerCase() === "published",
      ),
    [teamMonitorItems, workflowGraphStatusByWorkflowId],
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
  const {
    closeFileEditorPanel,
    closeFileEditorTab,
    closeRepositoryBinaryPreview,
    editorDirty,
    editorSaving,
    editorVisible,
    fileEditorActivePath,
    fileEditorTabs,
    openRepositoryFile,
    repositoryBinaryPreview,
    saveEditor,
    setFileEditorActivePath,
    setFileEditorTabs,
  } = useRepositoryFileEditor({ repositoryPath: activeRepository?.path });

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

  const handleFileEditorTabContentChange = useCallback(
    (relativePath: string, content: string) => {
      setFileEditorTabs((prev) =>
        prev.map((tab) => (tab.relativePath === relativePath ? { ...tab, content } : tab)),
      );
    },
    [setFileEditorTabs],
  );

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
      const ownerProject = projects.find((p) => p.repositoryIds.includes(repositoryId));
      if (ownerProject) {
        selectProjectAndRepository(ownerProject.id, repositoryId);
      } else {
        setActiveRepositoryId(repositoryId);
      }
      const boundId = resolveBoundMainSessionId(repository.path, repositoryMainSessionBindings, sessions);
      if (boundId) {
        switchSession(boundId);
        return;
      }
      const latestForRepo = pickSessionForRepositorySidebarSelect(
        sessions,
        repository.path,
        loadSessionOwnerHints(),
      );
      if (latestForRepo) {
        bindRepositoryMainSession(repository.path, latestForRepo.id);
        switchSession(latestForRepo.id);
        return;
      }
      void (async () => {
        const id = await createSession(repository.path, repositoryFolderBasename(repository));
        bindRepositoryMainSession(repository.path, id);
      })();
    },
    [
      bindRepositoryMainSession,
      createSession,
      projects,
      repositories,
      repositoryMainSessionBindings,
      selectProjectAndRepository,
      sessions,
      setActiveRepositoryId,
      switchSession,
    ],
  );

  /** 进入应用：仓库与会话 hydrated 后，打开侧栏排序第一项项目下第一个仓库的主会话（与 `useRepositoryList` 默认项一致）。 */
  const startupFirstProjectRepoSessionAppliedRef = useRef(false);
  useEffect(() => {
    if (repositoryListLoading || !tabsHydrated) return;
    if (startupFirstProjectRepoSessionAppliedRef.current) return;
    const firstProject = projects[0];
    if (!firstProject?.repositoryIds?.length) return;
    const firstRepoId = firstProject.repositoryIds[0];
    if (!repositories.some((r) => r.id === firstRepoId)) return;
    startupFirstProjectRepoSessionAppliedRef.current = true;
    handleSidebarRepositorySelect(firstRepoId);
  }, [
    handleSidebarRepositorySelect,
    projects,
    repositories,
    repositoryListLoading,
    tabsHydrated,
  ]);

  const handleSidebarRepositorySelectLeavingMcpHub = useCallback(
    (repositoryId: number | null) => {
      setMcpHubMode(false);
      setSkillsHubMode(false);
      handleSidebarRepositorySelect(repositoryId);
    },
    [handleSidebarRepositorySelect],
  );

  const handleProjectSelectLeavingMcpHub = useCallback(
    (projectId: string) => {
      setMcpHubMode(false);
      setSkillsHubMode(false);
      setActiveProjectId(projectId);
    },
    [setActiveProjectId],
  );

  const jumpToSessionLeavingMcpHub = useCallback(
    (sessionId: string) => {
      setMcpHubMode(false);
      setSkillsHubMode(false);
      jumpToSessionWithRepository(sessionId);
    },
    [jumpToSessionWithRepository],
  );

  async function openEmployeeConfigWithContext() {
    setEmployeeConfigDefaultRepositoryIds(activeRepositoryId ? [activeRepositoryId] : []);
    try {
      const subagents = await listClaudeSubagents(activeRepository?.path ?? null);
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
    setEmployeeConfigOpen(true);
  }

  async function handleCreateRepositoryTask(repository: Repository, mode: TaskMode) {
    const ownerProject = projects.find((p) => p.repositoryIds.includes(repository.id));
    if (ownerProject) {
      selectProjectAndRepository(ownerProject.id, repository.id);
    } else {
      setActiveRepositoryId(repository.id);
    }
    if (mode === "chat") {
      const id = await createSession(repository.path, repositoryFolderBasename(repository));
      bindRepositoryMainSession(repository.path, id);
      return;
    }
    if (mode === "split") {
      setSearchOpen(false);
      setPromptsMode(false);
      setTaskSplitMode(true);
      return;
    }
    const sessionId = await createSession(repository.path, repositoryFolderBasename(repository));
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
    const primaryRepo = repos[0];
    setActiveProjectId(project.id);
    setActiveRepositoryId(primaryRepo.id);
    if (mode === "chat") {
      const id = await createSession(primaryRepo.path, `${project.name}/${repositoryFolderBasename(primaryRepo)}`);
      bindRepositoryMainSession(primaryRepo.path, id);
      return;
    }
    if (mode === "split") {
      setSearchOpen(false);
      setPromptsMode(false);
      setTaskSplitMode(true);
      return;
    }
    const sessionId = await createSession(primaryRepo.path, `${project.name}/${repositoryFolderBasename(primaryRepo)}`);
    const repoPaths = repos.map((repo) => `- ${repo.path}`).join("\n");
    executeSession(
      sessionId,
      applyTemplate(projectSplitTemplate || DEFAULT_PROJECT_SPLIT_TEMPLATE, {
        projectName: project.name,
        repoName: repositoryFolderBasename(primaryRepo),
        repoPath: primaryRepo.path,
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
    <AppWorkspaceLayout
      dark={dark}
      collapsed={collapsed}
      promptsMode={promptsMode}
      taskSplitMode={taskSplitMode}
      mcpHubMode={mcpHubMode}
      skillsHubMode={skillsHubMode}
      compactLayoutMode={compactLayoutMode}
      effectiveRightCollapsed={effectiveRightCollapsed}
      mainLayoutContentRef={mainLayoutContentRef}
      mainLayoutLeftWidthPx={mainLayoutLeftWidthPx}
      mainLayoutRightWidthPx={mainLayoutRightWidthPx}
      onToggleCompactLayoutMode={handleToggleCompactLayoutMode}
      onLeftWidthChange={setMainLayoutLeftWidthPx}
      onRightWidthChange={setMainLayoutRightWidthPx}
      leftSidebarProps={{
        projects,
        activeProjectId,
        repositories,
        activeRepositoryId,
        mcpNavActive: mcpHubMode,
        onOpenMcpHub: () => {
          setPromptsMode(false);
          setSkillsHubMode(false);
          setMcpHubMode(true);
        },
        skillsNavActive: skillsHubMode,
        onOpenSkillsHub: () => {
          setPromptsMode(false);
          setMcpHubMode(false);
          setSkillsHubMode(true);
        },
        onProjectSelect: handleProjectSelectLeavingMcpHub,
        onCreateProject: handleCreateProject,
        onUpdateProject: handleUpdateProject,
        onDeleteProject: handleDeleteProject,
        pinnedProjectIds,
        onTogglePinProject: togglePinProject,
        onAddRepositoryToProject: handleAddRepositoryToProject,
        onDetachRepositoryFromProject: handleDetachRepositoryFromProject,
        onReorderRepositoriesInProject: handleReorderRepositoriesInProject,
        onMoveRepositoryToProject: handleMoveRepositoryToProject,
        onRepositorySelect: handleSidebarRepositorySelectLeavingMcpHub,
        onOpenInFinder: handleOpenInFinder,
        onCreateProjectTask: handleCreateProjectTask,
        onCreateRepositoryTask: handleCreateRepositoryTask,
        onOpenPromptsProject: handleOpenPromptsForProject,
        onOpenPromptsRepository: handleOpenPromptsForRepository,
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
        onOpenActiveRepositoryFile: openRepositoryFile,
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
        onSelectRepository: setActiveRepositoryId,
        onUpdateSessionModel: updateSessionModel,
        onExecuteSession: handleComposerExecute,
        onSendMessage: handleSendMessageWithTask,
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
        onOpenWorkflowConfig: () => setWorkflowConfigOpen(true),
        employees,
        mentionEmployees,
        workflowTasks,
        taskPendingEmployeesByTaskId,
        workflowTemplates,
        workflowGraphsByWorkflowId,
        workflowGraphStatusByWorkflowId,
        hideMessages: editorVisible,
        hideSessionTools: editorVisible,
        onOpenTaskDetail: (taskId) => {
          setMonitorDrawerTarget({ type: "task", taskId });
        },
        taskListConcurrentCapacity: monitorClaudeConcurrency
          ? Math.max(0, monitorClaudeConcurrency.limit - monitorClaudeConcurrency.activeCount)
          : undefined,
        resolveTaskListOmcInvokeConcurrency,
        onDecideWorkflowTask: handleDecideWorkflowTask,
      }}
      repositoryFileEditorPanelProps={
        editorVisible
          ? {
              activePath: fileEditorActivePath,
              dark,
              dirty: editorDirty,
              repositoryPath: activeRepository?.path,
              saving: editorSaving,
              tabs: fileEditorTabs,
              onActivePathChange: setFileEditorActivePath,
              onClosePanel: closeFileEditorPanel,
              onCloseTab: closeFileEditorTab,
              onSave: () => {
                void saveEditor();
              },
              onTabContentChange: handleFileEditorTabContentChange,
            }
          : null
      }
      rightPanelProps={{
        dark,
        collapsed: effectiveRightCollapsed,
        siderWidth: mainLayoutRightWidthPx,
        repositoryPath: activeRepository?.path,
        repositoryName: activeRepository?.name,
        onOpenFile: openRepositoryFile,
        monitorStats,
        monitorPanelSessions: monitorPanelSessionsMerged,
        monitorTranscriptSourceSessions: sessions,
        employeeMonitorItems,
        teamMonitorItems: publishedTeamMonitorItems,
        monitorActiveTarget: monitorDrawerTarget,
        onOpenTeamMonitorDetail: (workflowId) => {
          setMonitorDrawerTarget({ type: "team", workflowId });
        },
        onOpenEmployeeConfig: () => {
          void openEmployeeConfigWithContext();
        },
        onOpenWorkflowConfig: () => setWorkflowConfigOpen(true),
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
      prdTaskSplitPanelProps={{
        onClose: () => setTaskSplitMode(false),
        projects,
        repositories,
        activeProjectId,
        activeRepositoryId,
      }}
      repositoryFilePreviewModalProps={{
        preview: repositoryBinaryPreview,
        onClose: closeRepositoryBinaryPreview,
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
              agentTypeOptions: employeeAgentTypeOptions,
              defaultRepositoryIds: employeeConfigDefaultRepositoryIds,
              onClose: () => setEmployeeConfigOpen(false),
              onCreate: async (input) => {
                setEmployeeLoading(true);
                try {
                  await createEmployee(input);
                  await refreshEmployeeData();
                } finally {
                  setEmployeeLoading(false);
                }
              },
              onUpdate: async (input) => {
                setEmployeeLoading(true);
                try {
                  await updateEmployee(input);
                  await refreshEmployeeData();
                } finally {
                  setEmployeeLoading(false);
                }
              },
              onDelete: async (employeeId) => {
                setEmployeeLoading(true);
                try {
                  await deleteEmployee(employeeId);
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
              repositoryPath: activeRepository?.path ?? null,
              templates: workflowTemplates,
              selectableEmployeeIds: selectableWorkflowEmployeeIds,
              onClose: () => setWorkflowConfigOpen(false),
              onSaveTemplate: async (input) => {
                setWorkflowLoading(true);
                try {
                  const savedTemplate = await saveWorkflowTemplate(input);
                  await refreshWorkflowTemplates();
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
  );
}
