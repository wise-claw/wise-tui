import {
  Suspense,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { safeUnlisten } from "./utils/safeTauriUnlisten";
import { App as AntdApp, message, notification } from "antd";
import type {
  ClaudeSession,
  EmployeeItem,
  EmployeeTaskCountItem,
  MonitorDrawerTarget,
  ProjectItem,
  Repository,
  SessionConversationTaskItem,
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
import { runWhenIdle } from "./utils/deferIdle";
import { isSessionBoundAsRepositoryMain } from "./utils/repositoryMainSessionBinding";
import {
  resolveClaudeProxyBypassForSessionSpawn,
  resolveEngineForSessionSpawn,
  resolveRepositoryPathForSessionSpawn,
  type SessionPaneSpawnContext,
} from "./utils/sessionExecutionEngine";
import { mergePaneRuntimeOverride, type PaneRuntimeOverride } from "./types/paneRuntimeOverride";
import { isSessionExecutionEngine } from "./constants/sessionExecutionEngine";
import type { PaneClaudeProxyRoute } from "./types/paneRuntimeOverride";
import { resolveChatContextRepository } from "./utils/workspaceSelectionState";
import {
  capWorkflowTaskEvents,
  collectLiveWorkflowTaskIds,
  mergeWorkflowTasksForSession,
  pruneRecordByTaskIds,
  removeWorkflowTasksForSessionCreators,
} from "./utils/pruneWorkflowTaskAuxMaps";
import { useAgentRegistryCodexAvailable } from "./hooks/useAgentRegistryCodexAvailable";
import { useAgentRegistryCursorAvailable } from "./hooks/useAgentRegistryCursorAvailable";
import { useAgentRegistryGeminiAvailable } from "./hooks/useAgentRegistryGeminiAvailable";
import { useAgentRegistryOpencodeAvailable } from "./hooks/useAgentRegistryOpencodeAvailable";
import { useAgentRegistryQoderAvailable } from "./hooks/useAgentRegistryQoderAvailable";
import {
  authorView,
  cockpitView,
  mcpHubInspectTool,
  skillsHubInspectTool,
  inspectView,
  useViewMode,
} from "./hooks/useViewMode";
import type { AuthorPane } from "./types/viewMode";
import { useRepoPanelPlacementDefault } from "./hooks/useRepoPanelPlacementDefault";
import type { PaneCount, PaneSlot } from "./constants/mainLayoutWidths";
import { useClaudeSessions, type ClaudeTurnCompletePayload } from "./hooks/useClaudeSessions";
import { useRepositoryList } from "./hooks/useRepositoryList";
import { openRepositoryRemoteInBrowser } from "./services/openRepositoryRemote";
import { openInFinder } from "./services/repository";
import { prefetchGitStatus } from "./services/gitStatusWarmCache";
import { tryOpenWorkspaceInDefaultTerminal } from "./services/openWorkspaceWithTerminalPreference";
import type { CommandPaletteSearchMode } from "./components/CommandPalette";
import { LazyAppWorkspaceLayout } from "./components/AppWorkspaceLayout.lazy";
import { AppWorkspaceLayoutShell } from "./components/AppWorkspaceLayoutShell";
import { RepositoryRunCommandModal } from "./components/RunCommand";
import {
  dismissStuckOperations,
  getStuckOperationsSnapshot,
} from "./stores/operationWatchdogStore";
import { openRepositoryRunCommandModal } from "./stores/repositoryRunCommandModalStore";
import {
  pruneRepositoryRunCommandRuntime,
  setRepositoryRunCommandConfigureHandler,
  startRepositoryRunCommand,
  stopRepositoryRunCommand,
} from "./stores/repositoryRunCommandRuntimeStore";
import {
  markExecutionEnvironmentDispatchItemExited,
} from "./stores/executionEnvironmentDispatchStore";
import { useMacTerminalDetectionBootstrap } from "./hooks/useMacTerminalDetectionBootstrap";
import { useBackgroundScriptRuntimeSync } from "./hooks/useBackgroundScriptRuntimeSync";
import type { ScheduledTasksOverlayTarget } from "./components/RepositoryScheduledTasksModal";
import { activateAssistantTemplate } from "./services/assistantTemplateActivation";
import type { AssistantEntry } from "./types/assistant";
import {
  readAuthorPaneFromSettings,
  readAuthorPaneFromStorage,
  resolveAuthorNavPane,
} from "./components/AuthorPanel/authorPaneStorage";
import { WISE_UI_EVENT_NAVIGATE, type WiseUiNavigationDetail } from "./constants/wiseUiNavigationEvents";
import { requestClaudePluginHubTab } from "./stores/claudePluginHubNavStore";
import { getActivePaneIndex } from "./stores/activePaneIndexStore";
import { reloadAppWindow } from "./services/window";
import {
  getCurrentMainWorkspaceWindowLabel,
  isPrimaryMainWorkspaceWindowLabel,
  PRIMARY_MAIN_WINDOW_LABEL,
} from "./services/mainWindow";
import {
  LEGACY_MULTI_PANE_LAYOUT_STATE_STORAGE_KEY,
  resolveCurrentMultiPaneLayoutStorageKey,
} from "./utils/multiPaneLayoutStorage";
import { isWiseAppFocused } from "./utils/isWiseAppFocused";
import { wiseMascotShow } from "./services/wiseMascot";
import { closeTerminalSession } from "./services/terminal";
import { initGlobalAtMentionShortcutRouting } from "./services/globalScreenshotHotkey";
import {
  loadAtMentionShortcutByTargetFromStore,
  registerAtMentionGlobalShortcuts,
  WISE_AT_MENTION_SHORTCUTS_CHANGED,
} from "./services/wiseDefaultConfigStore";
import { getTaskTemplate, setTaskTemplate } from "./services/projectState";
import {
  WORKFLOW_UI_EVENT_OPEN_ASSISTANT,
  WORKFLOW_UI_EVENT_OPEN_REPOSITORY_FILE,
  WORKFLOW_UI_EVENT_OPEN_WORKFLOW_CONFIG,
  WORKFLOW_UI_EVENT_WORKFLOW_GRAPH_CHANGED,
  type OpenAssistantDetail,
  type OpenRepositoryFileDetail,
  type OpenWorkflowConfigDetail,
  type WorkflowGraphChangedDetail,
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
  releaseClaudeHostProcessesForProjectScope,
  releaseClaudeHostProcessesForRepositoryScope,
  type ReleaseWiseTabSessionContext,
} from "./services/releaseClaudeHostProcessesForWorkspaceScope";
import {
  dispatchAtMentionPromptToRepos,
  planAtMentionDispatch,
} from "./services/atMentionDispatch";
import { resolveProjectMainSessionAnchor } from "./utils/projectSessionAnchor";
import { resolveChatTopbarContext, resolveProjectExplorerOpenPath, resolveScheduledTasksRepository, shouldKeepProjectFocusWhenSwitchingSession } from "./utils/workspaceSelectionState";
import { resolveFocusedPaneTargetSlot } from "./utils/multiPaneSlots";
import { resolveWorkspaceRootPath } from "./utils/projectSessionAnchor";
import { resolveSidebarSelectionTarget } from "./utils/sidebarSelectionTarget";
import {
  findOwnerProjectForRepositoryId,
  isMultiRepoProject,
  resolveWorkspaceMode,
  shouldSidebarRepositorySelectOnlyUpdateFocus,
} from "./utils/workspaceMode";
import { employeeInProjectScope, shouldHideEmployeeUi } from "./utils/projectRepositoryRoles";
import { buildProjectRoleTagOptions, buildProjectRepositoryMentionOptions } from "./utils/projectRoleTagOptions";
import {
  resolveTeamPanelEmployeeMonitorItems,
  filterRepositoryMemberMonitorItemsBySelection,
  useMonitorOverview,
} from "./hooks/useMonitorOverview";
import { useExecutionEnvironmentDispatchHistoryDays } from "./hooks/useExecutionEnvironmentDispatchHistoryDays";
import { useExecutionEnvironmentDispatchWorkerTranscriptPreload } from "./hooks/useExecutionEnvironmentDispatchWorkerTranscriptPreload";
import { useSessionConversationTasks } from "./hooks/useSessionConversationTasks";
import { dispatchExecutionEnvironmentFromMainSession } from "./services/executionEnvironmentDispatch";
import { dispatchSessionFeedbackLoopAnalysis } from "./services/sessionFeedbackLoopDispatch";
import type { FeedbackLoopDispatchKind } from "./utils/sessionFeedbackLoopDispatch";
import { createFreshTerminalWorkerTab, isTerminalWorkerWiseTab } from "./services/terminalDispatch";
import { resolveExecutionEnvironmentDispatchAnchorSessionId } from "./utils/executionEnvironmentDispatchAnchor";
import { subscribeClaudeSessionsStructure, getClaudeSessionsStructureKey, getClaudeSessionSnapshot } from "./stores/claudeSessionsLiveStore";
import { useMonitorSessionsForOverview } from "./hooks/useMonitorSessionsForOverview";
import { useLeftSidebarHubQuickEntries } from "./hooks/useLeftSidebarHubQuickEntries";
import { useMonitorPanelDefault } from "./hooks/useMonitorPanelDefault";
import { useLeftSidebarWorkspaceListDefault } from "./hooks/useLeftSidebarWorkspaceListDefault";
import { useLeftSidebarRepositoryIconBadgesDefault } from "./hooks/useLeftSidebarRepositoryIconBadgesDefault";
import { useScheduledClaudeTaskRunner } from "./hooks/useScheduledClaudeTaskRunner";
import { invalidateWorkflowRunCacheForRepository } from "./hooks/useWorkflowRun";
import { deleteAppSetting, getAppSetting, setAppSetting } from "./services/appSettingsStore";
import { loadWiseDefaultConfig } from "./services/wiseDefaultConfigStore";
import { migratePromptContextSessionKey } from "./components/ClaudeChatInput/prompt-context";
import {
  loadClaudeConcurrencyLimits,
  type ClaudeConcurrencyLimitsMap,
} from "./services/claudeConcurrencyLimits";
import { resolveClaudeSpawnExtrasForSession } from "./services/claudeSpawnExtras";
import {
  evaluateBeforeSpawnClaudeCode,
  resolveClaudeConcurrencyInvokeContext,
} from "./utils/claudeConcurrencyGate";
import {
  pickProjectMainSessionForSidebarSelect,
  pickSessionForRepositorySidebarSelect,
} from "./utils/claudeSessionSelection";
import {
  isOmcBatchHistoryStubSessionId,
  clearPersistedOmcBatchHistory,
  parseOmcBatchHistoryStubAnchorSessionId,
} from "./utils/omcEmployeeBatchHistory";
import { isOmcMonitorEmployeeRecord } from "./utils/omcMonitorEmployeeSession";
import {
  normalizeRepositoryPathKey as normalizeRepositoryPathForMatch,
  parseRepositoryMainSessionBindings,
  projectMainSessionBindingKey,
  repositoryPathsMatch,
  REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY,
  resolveRepositoryForSession,
  resolveBoundMainSessionId,
  resolveMainOwnerAgentNameForRepositoryPath,
  resolveSessionFromBindingValue,
  isProjectMainSessionBindingKey,
  isProjectRootSessionDisplayName,
} from "./utils/repositoryMainSessionBinding";
import { loadSessionOwnerHints, WISE_SESSION_OWNER_HINTS_CHANGED_EVENT } from "./utils/sessionOwnerHints";
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
  capWorkflowRuntimeSnapshots,
  extractRuntimeSnapshotsFromEvents,
} from "./services/workflowGraphHelpers";
import { useMainLayoutModes } from "./hooks/useMainLayoutModes";
import type { ReconcileProjectMode } from "./constants/reconcileProjectMode";
import { useDingTalkAutomationInbound } from "./hooks/useDingTalkAutomationInbound";
import { useOmcPluginInstalled } from "./hooks/useOmcPluginInstalled";
import { useOmcRuntime } from "./hooks/useOmcRuntime";
import { useWorkflowTeamAutomation } from "./hooks/useWorkflowTeamAutomation";
import { useWorkspaceMode } from "./hooks/useWorkspaceMode";
import {
  addProjectPrdWorkflow,
  listWorkflowProjectIds,
} from "./services/projectPrdScope";
import { isCurrentPrimaryMainWorkspaceWindowSync } from "./services/mainWindow";


interface PersistedMultiPaneSlotV1 {
  slotId?: string;
  sessionId?: string | null;
  repositoryId?: number | null;
  executionEngine?: string;
  claudeProxyRoute?: PaneClaudeProxyRoute;
}

interface PersistedMultiPaneStateV1 {
  version: 1;
  paneCount: PaneCount;
  extraPanes: PersistedMultiPaneSlotV1[];
  primaryPaneRuntime?: PaneRuntimeOverride;
}

function normalizePersistedPaneCount(raw: unknown): PaneCount {
  return raw === 1 || raw === 2 || raw === 4 || raw === 6 || raw === 8 ? raw : 1;
}

function normalizePersistedExtraPanes(raw: unknown, paneCount: PaneCount): PaneSlot[] {
  const needed = Math.max(0, paneCount - 1);
  const rows = Array.isArray(raw) ? raw : [];
  const out: PaneSlot[] = [];
  for (let i = 0; i < needed; i += 1) {
    const row = (rows[i] ?? {}) as PersistedMultiPaneSlotV1;
    const slotIdRaw = typeof row.slotId === "string" ? row.slotId.trim() : "";
    out.push({
      slotId: slotIdRaw || `pane-restored-${Date.now()}-${i}`,
      sessionId: typeof row.sessionId === "string" && row.sessionId.trim() ? row.sessionId : null,
      repositoryId:
        typeof row.repositoryId === "number" && Number.isFinite(row.repositoryId)
          ? row.repositoryId
          : null,
      executionEngine:
        typeof row.executionEngine === "string" && isSessionExecutionEngine(row.executionEngine)
          ? row.executionEngine
          : undefined,
      claudeProxyRoute:
        row.claudeProxyRoute === "auto" || row.claudeProxyRoute === "bypass"
          ? row.claudeProxyRoute
          : undefined,
    });
  }
  return out;
}

/** 侧栏选中后推迟主会话切换，让工作区/仓库高亮与 Git 面板先绘制。 */
function scheduleSidebarMainSessionEnsure(work: () => Promise<string | null>): void {
  queueMicrotask(() => {
    startTransition(() => {
      void work();
    });
  });
}

// ── App ──

export default function App() {
  /**
   * 顶层 View 状态机（参见 .trellis/spec/guides/agent-harness-architecture.md §3）。
   *
   * 取代历史上的 6 个互斥布尔（promptsMode / mcpHubMode / skillsHubMode /
   * missionControlMode）。
   * P0 通过 `viewMode.legacy.*` 提供过渡期兼容；P1 后 AppWorkspaceLayout 自身
   * 从 `viewMode` 派生这些布尔，AppImpl 不再依赖 legacy 别名。
   */
  const viewMode = useViewMode();
  // 顶层拿 antd App context：run_script 失败时通过 modal 弹出可滚动的完整 stderr/stdout，
  // 比 message.error 顶部 toast（一行）更适合排查长输出脚本（如 bun test）。
  const { modal: appModal } = AntdApp.useApp();
  useMacTerminalDetectionBootstrap();
  useBackgroundScriptRuntimeSync();
  const [lastAuthorPane, setLastAuthorPane] = useState(() => readAuthorPaneFromStorage());
  const [assistantInitialTarget, setAssistantInitialTarget] = useState<OpenAssistantDetail | null>(null);
  const [assistantOpenRequestKey, setAssistantOpenRequestKey] = useState(0);
  const [cockpitSurfaceInitialAssistantId, setCockpitSurfaceInitialAssistantId] = useState<string | null>(null);
  const [cockpitActiveAssistantId, setCockpitActiveAssistantId] = useState<string | null>(null);
  const [cockpitResumeAssistantId, setCockpitResumeAssistantId] = useState<string | null>(null);
  const [scheduledTasksOverlay, setScheduledTasksOverlay] = useState<ScheduledTasksOverlayTarget | null>(null);
  const [workspaceCreateRequest, setWorkspaceCreateRequest] = useState(0);
  const [standaloneRepoAddRequest, setStandaloneRepoAddRequest] = useState(0);
  const [repositorySplitTemplate, setRepositorySplitTemplate] = useState("");
  const [projectSplitTemplate, setProjectSplitTemplate] = useState("");
  const [dark, _setDark] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [terminalCollapsed, setTerminalCollapsed] = useState(true);
  const [terminalPanelMounted, setTerminalPanelMounted] = useState(false);

  const handleToggleTerminal = useCallback(() => {
    if (!terminalPanelMounted) {
      setTerminalPanelMounted(true);
      setTerminalCollapsed(false);
      return;
    }
    setTerminalCollapsed((collapsed) => !collapsed);
  }, [terminalPanelMounted]);

  const handleCloseTerminalPanel = useCallback(() => {
    setTerminalPanelMounted(false);
    setTerminalCollapsed(true);
  }, []);

  const handleCollapseTerminal = useCallback(() => {
    if (terminalPanelMounted) {
      setTerminalCollapsed(true);
    }
  }, [terminalPanelMounted]);
  /** 中栏多屏模式屏数：1=单屏（关闭），2/4/6/8=多屏。 */
  const [paneCount, setPaneCount] = useState<PaneCount>(1);
  /** paneCount 的 ref：供 openRepositoryFileByEvent 等回调在多屏下避免污染全局 active。 */
  const paneCountRef = useRef(paneCount);
  paneCountRef.current = paneCount;
  /** 多屏模式下额外窗格槽位（Pane 0 始终是 activeSession）。 */
  const [extraPanes, setExtraPanes] = useState<PaneSlot[]>([]);
  /** 主窗格（Pane 0）运行时覆盖：执行引擎 / Claude 代理路由。 */
  const [primaryPaneRuntimeOverride, setPrimaryPaneRuntimeOverride] =
    useState<PaneRuntimeOverride | null>(null);
  const multiPaneStorageKeyRef = useRef(
    resolveCurrentMultiPaneLayoutStorageKey(getCurrentMainWorkspaceWindowLabel()),
  );
  const paneLayoutHydratedRef = useRef(false);
  const [paneLayoutHydrated, setPaneLayoutHydrated] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  /**
   * 搜索面板打开时预置的目录范围（仓库相对路径）。
   * 文件树右键"在此搜索"通过事件携带 scopeDir 写入此 state；快捷键打开时为 undefined（整个仓库）。
   */
  const [searchInitialScopeDir, setSearchInitialScopeDir] = useState<string | undefined>(undefined);
  const [searchMode, setSearchMode] = useState<CommandPaletteSearchMode>("filename");
  /**
   * 搜索面板的仓库路径 override：多屏下 per-pane 搜索按钮作用于该 pane 仓库，
   * 而非全局 activeRepository。undefined 时回退到 activeRepository?.path（单屏行为不变）。
   * 注：UI 侧状态，onClose 时清空；多屏文件路由不依赖它（改信任 repositoryFileOpenRequest）。
   */
  const [searchRepositoryPathOverride, setSearchRepositoryPathOverride] = useState<
    string | undefined
  >(undefined);
  const searchRepositoryPathOverrideRef = useRef<string | undefined>(undefined);
  searchRepositoryPathOverrideRef.current = searchRepositoryPathOverride;
  /** 右侧 Inspector 历史会话消息抽屉（由中栏「历史会话」列表打开；默认收起右栏时不强制展开） */
  const [inspectorHistorySessionId, setInspectorHistorySessionId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readAuthorPaneFromSettings(lastAuthorPane).then((pane) => {
      if (cancelled) return;
      setLastAuthorPane(pane);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const windowLabel = getCurrentMainWorkspaceWindowLabel() ?? PRIMARY_MAIN_WINDOW_LABEL;
      const storageKey = resolveCurrentMultiPaneLayoutStorageKey(windowLabel);
      multiPaneStorageKeyRef.current = storageKey;
      try {
        let raw = (await getAppSetting(storageKey))?.trim();
        if (!raw && isPrimaryMainWorkspaceWindowLabel(windowLabel)) {
          const legacyRaw = (await getAppSetting(LEGACY_MULTI_PANE_LAYOUT_STATE_STORAGE_KEY))?.trim();
          if (legacyRaw) {
            raw = legacyRaw;
            void setAppSetting(storageKey, legacyRaw);
            void deleteAppSetting(LEGACY_MULTI_PANE_LAYOUT_STATE_STORAGE_KEY);
          }
        }
        if (!raw || cancelled) return;
        const parsed = JSON.parse(raw) as Partial<PersistedMultiPaneStateV1>;
        const restoredPaneCount = normalizePersistedPaneCount(parsed.paneCount);
        const restoredExtraPanes = normalizePersistedExtraPanes(parsed.extraPanes, restoredPaneCount);
        if (cancelled) return;
        setPaneCount(restoredPaneCount);
        setExtraPanes(restoredExtraPanes);
        if (restoredPaneCount > 1 && parsed.primaryPaneRuntime && typeof parsed.primaryPaneRuntime === "object") {
          setPrimaryPaneRuntimeOverride(
            mergePaneRuntimeOverride(null, parsed.primaryPaneRuntime as PaneRuntimeOverride),
          );
        } else {
          setPrimaryPaneRuntimeOverride(null);
        }
      } catch {
        void deleteAppSetting(storageKey);
      } finally {
        paneLayoutHydratedRef.current = true;
        setPaneLayoutHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!paneLayoutHydratedRef.current) return;
    const payload: PersistedMultiPaneStateV1 = {
      version: 1,
      paneCount,
      extraPanes: extraPanes.map((slot) => ({
        slotId: slot.slotId,
        sessionId: slot.sessionId,
        repositoryId: slot.repositoryId,
        executionEngine: slot.executionEngine,
        claudeProxyRoute: slot.claudeProxyRoute,
      })),
      primaryPaneRuntime: primaryPaneRuntimeOverride ?? undefined,
    };
    void setAppSetting(multiPaneStorageKeyRef.current, JSON.stringify(payload));
  }, [paneCount, extraPanes, primaryPaneRuntimeOverride]);

  useEffect(() => {
    void loadWiseDefaultConfig().catch(() => {
      /* 启动时确保默认配置已迁入 app_settings */
    });
  }, []);

  const enterAuthorPane = useCallback(
    (pane: AuthorPane) => {
      const resolved = resolveAuthorNavPane(pane);
      setSearchOpen(false);
      setLastAuthorPane(resolved);
      viewMode.enter(authorView(resolved));
    },
    [viewMode],
  );

  const handleAuthorPaneChange = useCallback(
    (pane: AuthorPane) => {
      const resolved = resolveAuthorNavPane(pane);
      setLastAuthorPane(resolved);
      viewMode.enter(authorView(resolved));
    },
    [viewMode],
  );
  const authorPane: AuthorPane = resolveAuthorNavPane(
    viewMode.view.kind === "author" ? viewMode.view.pane : lastAuthorPane,
  );
  const authorWorkflowPaneActive = viewMode.view.kind === "author" && viewMode.view.pane === "workflows";
  const [employeeConfigDefaultRepositoryIds, setEmployeeConfigDefaultRepositoryIds] = useState<number[]>([]);
  /** 非空：从需求面板打开员工配置，新建成功后自动关联到该 Workspace。 */
  const [employeeConfigPrdProjectId, setEmployeeConfigPrdProjectId] = useState<string | null>(null);
  /** 从需求面板打开员工配置时拉取，用于表格「始终显示」Workspace 显式关联的员工 id。 */
  const [employeeConfigPrdVisibleEmployeeIds, setEmployeeConfigPrdVisibleEmployeeIds] = useState<string[]>([]);
  const [employeeAgentTypeOptions, setEmployeeAgentTypeOptions] = useState<string[]>(["executor"]);
  /** 非空：从需求面板打开团队配置，保存模板后自动关联到该 Workspace。 */
  const [workflowConfigPrdProjectId, setWorkflowConfigPrdProjectId] = useState<string | null>(null);
  const [workflowConfigInitialWorkflowId, setWorkflowConfigInitialWorkflowId] = useState<string | null>(null);
  /** workflowId -> [projectId, ...] map，用于 WorkflowConfigModal 中展示已关联 Workspace。 */
  const [workflowProjectIdsMap, setWorkflowProjectIdsMap] = useState<Record<string, string[]>>({});
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [monitorDrawerTarget, setMonitorDrawerTarget] = useState<MonitorDrawerTarget | null>(null);
  const [employees, setEmployees] = useState<EmployeeItem[]>([]);
  const [employeeTaskCounts, setEmployeeTaskCounts] = useState<EmployeeTaskCountItem[]>([]);
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowTemplateItem[]>([]);
  const [workflowTasks, setWorkflowTasks] = useState<WorkflowTaskItem[]>([]);
  const [workflowTaskEventsByTaskId, setWorkflowTaskEventsByTaskId] = useState<Record<string, WorkflowTaskEventItem[]>>({});
  const commitWorkflowTaskEventsByTaskId = useCallback(
    (action: React.SetStateAction<Record<string, WorkflowTaskEventItem[]>>) => {
      setWorkflowTaskEventsByTaskId((prev) => {
        const raw = typeof action === "function" ? action(prev) : action;
        let changed = raw !== prev;
        const next: Record<string, WorkflowTaskEventItem[]> = {};
        for (const [taskId, events] of Object.entries(raw)) {
          const capped = capWorkflowTaskEvents(events);
          next[taskId] = capped;
          if (prev[taskId] !== capped || capped.length !== events.length) {
            changed = true;
          }
        }
        if (Object.keys(prev).length !== Object.keys(next).length) {
          changed = true;
        }
        return changed ? next : prev;
      });
    },
    [],
  );
  const [taskPendingEmployeesByTaskId, setTaskPendingEmployeesByTaskId] = useState<Record<string, Array<{ employeeId: string; name: string }>>>({});
  const [workflowRuntimeStateByTaskId, setWorkflowRuntimeStateByTaskId] = useState<Record<string, WorkflowGraphRuntimeState>>({});
  const [workflowRuntimeSnapshotsByTaskId, setWorkflowRuntimeSnapshotsByTaskId] = useState<Record<string, WorkflowRuntimeStepSnapshot[]>>({});
  const commitWorkflowRuntimeSnapshotsByTaskId = useCallback(
    (action: React.SetStateAction<Record<string, WorkflowRuntimeStepSnapshot[]>>) => {
      setWorkflowRuntimeSnapshotsByTaskId((prev) => {
        const raw = typeof action === "function" ? action(prev) : action;
        let changed = raw !== prev;
        const next: Record<string, WorkflowRuntimeStepSnapshot[]> = {};
        for (const [taskId, snapshots] of Object.entries(raw)) {
          const capped = capWorkflowRuntimeSnapshots(snapshots);
          next[taskId] = capped;
          if (prev[taskId] !== capped) {
            changed = true;
          }
        }
        if (Object.keys(prev).length !== Object.keys(next).length) {
          changed = true;
        }
        return changed ? next : prev;
      });
    },
    [],
  );
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
  const applyWorkflowTasksForSession = useCallback(
    (
      sessionId: string,
      tasks: WorkflowTaskItem[],
      eventEntries: ReadonlyArray<readonly [string, WorkflowTaskEventItem[]]>,
      pendingEntries: ReadonlyArray<readonly [string, Array<{ employeeId: string; name: string }>]>,
      options?: { dropCreatorIds?: ReadonlySet<string> },
    ) => {
      let baseTasks = workflowTasksRef.current;
      if (options?.dropCreatorIds?.size) {
        baseTasks = removeWorkflowTasksForSessionCreators(baseTasks, options.dropCreatorIds);
      }
      const merged = mergeWorkflowTasksForSession(baseTasks, sessionId, tasks);
      const liveTaskIds = collectLiveWorkflowTaskIds(merged);
      const snapshotEntries = eventEntries.map(
        ([taskId, events]) => [taskId, extractRuntimeSnapshotsFromEvents(events)] as const,
      );
      setWorkflowTasks(merged);
      commitWorkflowTaskEventsByTaskId((prev) => pruneRecordByTaskIds(prev, liveTaskIds, eventEntries));
      commitWorkflowRuntimeSnapshotsByTaskId((prev) =>
        pruneRecordByTaskIds(prev, liveTaskIds, snapshotEntries),
      );
      setTaskPendingEmployeesByTaskId((prev) => pruneRecordByTaskIds(prev, liveTaskIds, pendingEntries));
      setWorkflowRuntimeStateByTaskId((prev) => pruneRecordByTaskIds(prev, liveTaskIds));
    },
    [commitWorkflowTaskEventsByTaskId, commitWorkflowRuntimeSnapshotsByTaskId],
  );
  const [workflowGraphsByWorkflowId, setWorkflowGraphsByWorkflowId] = useState<Record<string, WorkflowGraph>>({});
  const [workflowGraphStatusByWorkflowId, setWorkflowGraphStatusByWorkflowId] = useState<Record<string, string>>({});
  const moveOmcRuntimeSessionIdRef = useRef<(fromTabId: string, toClaudeSessionId: string) => void>(() => {});
  /** 与侧栏「结束」共用同一份实现，供监控抽屉内结束 OMC 复用。 */
  const handleStopEmployeeMonitorRef = useRef<(employeeId: string) => void>(() => {});
  const [workflowVerdictMode, setWorkflowVerdictMode] = useState<WorkflowVerdictMode>(DEFAULT_WORKFLOW_VERDICT_MODE);
  useEffect(() => {
    let cancelled = false;
    // 判定模式仅在工作流执行时使用，推迟到空闲期加载，避免与首屏渲染争抢主线程。
    const cancelIdle = runWhenIdle(() => {
      if (cancelled) return;
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
    }, { timeoutMs: 2000 });
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, []);

  const {
    repositories,
    projects,
    activeProjectId,
    activeRepositoryId,
    activeWorkspaceFocus,
    loading: repositoryListLoading,
    setActiveRepositoryId,
    setActiveProjectId,
    setActiveRepositoryWithOwner,
    handleCreateProject,
    handleUpdateProject,
    handleUpdateProjectSddMode,
    handleDeleteProject,
    handleAddRepositoryToProject,
    handleAddFloatingRepository,
    handlePromoteFloatingRepositoryToProject,
    handleDetachRepositoryFromProject,
    handleRemoveRepository,
    handleUpdateRepositorySddMode,
    handleUpdateRepositoryIconBadge,
    handleReorderRepositoriesInProject,
    handleReconcileProjectWorkspace,
    handleUpdateRepositoryMainOwnerAgent,
    handleUpdateRepositoryExecutionEngine,
    handleUpdateRepositoryOpenAppId,
    handleUpdateProjectOpenAppId,
    pinnedProjectIds,
    togglePinProject,
    floatingRepositories,
    standaloneRepos,
  } = useRepositoryList();

  useEffect(() => {
    const onNavigate = (event: Event) => {
      const detail = (event as CustomEvent<WiseUiNavigationDetail>).detail;
      if (!detail || detail.kind !== "author") return;
      if (!activeProjectId && activeRepositoryId != null) {
        message.warning("Standalone Repo 不支持 Author 配置；升格为 Workspace 后启用");
        return;
      }
      if (detail.pane === "claude-plugins") {
        const tab = detail.query?.tab;
        if (tab === "installed" || tab === "catalog") {
          requestClaudePluginHubTab(tab);
        }
      }
      enterAuthorPane(detail.pane);
    };
    window.addEventListener(WISE_UI_EVENT_NAVIGATE, onNavigate);
    return () => window.removeEventListener(WISE_UI_EVENT_NAVIGATE, onNavigate);
  }, [activeProjectId, activeRepositoryId, enterAuthorPane]);

  const dockQueryAppliedRef = useRef(false);

  useEffect(() => {
    pruneRepositoryRunCommandRuntime(new Set(repositories.map((repo) => repo.id)));
  }, [repositories]);

  useEffect(() => {
    if (dockQueryAppliedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("dockRepoId");
    if (!raw) return;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      dockQueryAppliedRef.current = true;
      params.delete("dockRepoId");
      const next = params.toString();
      const newUrl = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash}`;
      window.history.replaceState(null, "", newUrl);
      return;
    }
    const hasRepo = repositories.some((repo) => repo.id === parsed);
    if (!hasRepo) return;
    dockQueryAppliedRef.current = true;
    setActiveRepositoryWithOwner(parsed);
    params.delete("dockRepoId");
    const next = params.toString();
    const newUrl = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", newUrl);
  }, [repositories, setActiveRepositoryWithOwner]);

  const auxWindowTitleRef = useRef("");
  useEffect(() => {
    try {
      const label = getCurrentMainWorkspaceWindowLabel();
      if (!label || isPrimaryMainWorkspaceWindowLabel(label)) return;
      const repo =
        activeRepositoryId != null
          ? repositories.find((item) => item.id === activeRepositoryId) ?? null
          : null;
      const suffix = repo?.name?.trim() || repo?.path?.split(/[/\\]/).filter(Boolean).pop();
      const nextTitle = suffix ? `Wise — ${suffix}` : "Wise";
      if (auxWindowTitleRef.current === nextTitle) return;
      auxWindowTitleRef.current = nextTitle;
      void getCurrentWindow().setTitle(nextTitle);
    } catch {
      /* 浏览器预览 / 非 Tauri */
    }
  }, [activeRepositoryId, repositories]);

  const handleOpenExecutionEnvironment = useCallback(() => {
    if (!activeProjectId && activeRepositoryId != null) {
      message.warning("Standalone Repo 不支持 Author 配置；升格为 Workspace 后启用");
      return;
    }
    enterAuthorPane("engine-registry");
  }, [activeProjectId, activeRepositoryId, enterAuthorPane]);

  const openRepositoryRunCommandConfigure = useCallback((repository: Pick<Repository, "id" | "path">) => {
    openRepositoryRunCommandModal({
      repositoryId: repository.id,
      repositoryPath: repository.path,
    });
  }, []);

  useEffect(() => {
    setRepositoryRunCommandConfigureHandler(openRepositoryRunCommandConfigure);
    return () => setRepositoryRunCommandConfigureHandler(undefined);
  }, [openRepositoryRunCommandConfigure]);

  const handleStartRepositoryRunCommand = useCallback(
    (repository: Repository) => {
      void startRepositoryRunCommand({
        repository,
        onRequestConfigure: () => openRepositoryRunCommandConfigure(repository),
      });
    },
    [openRepositoryRunCommandConfigure],
  );

  const handleStopRepositoryRunCommand = useCallback(
    (repository: Repository) => {
      void stopRepositoryRunCommand(repository);
    },
    [],
  );

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

  useEffect(() => {
    let cancelled = false;
    // 并发上限仅在 spawn Claude 时使用，推迟到空闲期加载，避免与首屏渲染争抢主线程。
    const cancelIdle = runWhenIdle(() => {
      if (cancelled) return;
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
    }, { timeoutMs: 2000 });
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, []);

  const beforeSpawnClaudeRef = useRef<
    ((session: ClaudeSession) => { ok: true } | { ok: false; message: string }) | null
  >(null);

  const claudeConcurrencyInvokeContextRef = useRef<
    ((session: ClaudeSession) => { concurrencyScopeKey: string; concurrencyLimit: number } | null) | null
  >(null);

  const claudeSpawnExtrasContextRef = useRef<
    ((session: ClaudeSession) => Promise<import("./services/claudeSpawnExtras").ClaudeSpawnCliExtras | null>) | null
  >(null);

  const resolveExecutionEngineRef = useRef<
    ((session: ClaudeSession) => import("./types").SessionExecutionEngine) | null
  >(null);

  const resolveExecutionRepositoryPathRef = useRef<
    ((session: ClaudeSession) => string) | null
  >(null);

  const resolveClaudeProxyBypassRef = useRef<
    ((session: ClaudeSession) => boolean) | null
  >(null);

  const codexAvailable = useAgentRegistryCodexAvailable();
  const cursorAvailable = useAgentRegistryCursorAvailable();
  const geminiAvailable = useAgentRegistryGeminiAvailable();
  const opencodeAvailable = useAgentRegistryOpencodeAvailable();
  const qoderAvailable = useAgentRegistryQoderAvailable();

  const handleUpdateEmployeeExecutionEngine = useCallback(
    async (employeeId: string, engine: import("./types").SessionExecutionEngine) => {
      const row = employees.find((e) => e.id === employeeId);
      if (!row) return;
      setEmployees((prev) =>
        prev.map((e) => (e.id === employeeId ? { ...e, executionEngine: engine } : e)),
      );
      await updateEmployee({
        employeeId,
        name: row.name,
        agentType: row.agentType,
        enabled: row.enabled,
        repositoryIds: row.repositoryIds,
        projectIds: row.projectIds,
        executionEngine: engine,
      });
    },
    [employees],
  );

  const handleUpdatePaneRuntimeOverride = useCallback(
    (paneIndex: number, patch: Partial<PaneRuntimeOverride>) => {
      if (paneCount <= 1) return;
      if (paneIndex === 0) {
        setPrimaryPaneRuntimeOverride((prev) => mergePaneRuntimeOverride(prev, patch));
        return;
      }
      const slotIndex = paneIndex - 1;
      setExtraPanes((prev) => {
        if (slotIndex < 0 || slotIndex >= prev.length) return prev;
        const slot = prev[slotIndex];
        if (!slot) return prev;
        const merged = mergePaneRuntimeOverride(
          {
            executionEngine: slot.executionEngine,
            claudeProxyRoute: slot.claudeProxyRoute,
          },
          patch,
        );
        const next = [...prev];
        next[slotIndex] = {
          ...slot,
          executionEngine: merged.executionEngine,
          claudeProxyRoute: merged.claudeProxyRoute,
        };
        return next;
      });
    },
    [paneCount],
  );

  const advanceTeamAfterTurnRef = useRef<(p: ClaudeTurnCompletePayload) => void>(() => {});

  const moveDingTalkAutomationPendingSessionIdRef = useRef<(fromTabId: string, toClaudeSessionId: string) => void>(() => {});
  const moveWorkflowAutomationSessionIdRef = useRef<(fromTabId: string, toClaudeSessionId: string) => void>(() => {});
  const purgeWorkflowWorkerSessionBindingsRef = useRef<(sessionIds: ReadonlySet<string>) => void>(() => {});
  /** 在 `sessionsLatestRef` 就绪后每帧赋值：DB 迁移 workflow 会话引用 + 刷新任务列表（见 `handleSessionTabIdMigrated`）。 */
  const postSessionTabMigrationRef = useRef<(fromTabId: string, toClaudeSessionId: string) => void>(() => {});
  /**
   * 同步更新 extraPanesLatestRef 的 session.id 迁移函数（由 useMainLayoutModes 提供，在下方解构）。
   * 用 ref 桥接，使 handleSessionTabIdMigrated 可以在 useMainLayoutModes 之前定义而无 TDZ。
   */
  const markSessionTabMigratedRef = useRef<(fromTabId: string, toClaudeSessionId: string) => void>(() => {});

  const handleSessionTabIdMigrated = useCallback(
    (fromTabId: string, toClaudeSessionId: string) => {
      // 走 markSessionTabMigrated：同步写 extraPanesLatestRef，避免 effect 727
      // （清理已不存在的 session 引用）在迁移瞬态误清 companion slot。
      markSessionTabMigratedRef.current(fromTabId, toClaudeSessionId);
      migrateRepositoryMainSessionBindingTabIds(fromTabId, toClaudeSessionId);
      void migratePromptContextSessionKey(fromTabId, toClaudeSessionId);
      moveWorkflowAutomationSessionIdRef.current(fromTabId, toClaudeSessionId);
      moveDingTalkAutomationPendingSessionIdRef.current(fromTabId, toClaudeSessionId);
      moveOmcRuntimeSessionIdRef.current(fromTabId, toClaudeSessionId);
      postSessionTabMigrationRef.current(fromTabId, toClaudeSessionId);
    },
    [migrateRepositoryMainSessionBindingTabIds],
  );

  const companionSessionIds = useMemo(() => {
    if (paneCount <= 1) return [];
    return extraPanes.map((p) => p.sessionId).filter((id): id is string => Boolean(id));
  }, [paneCount, extraPanes]);

  const {
    sessions,
    sessionsLiveRef,
    activeSessionId,
    createSession,
    updateSessionModel,
    updateSessionConnectionKind,
    updateSessionUltracodeOverride,
    executeSession,
    executeTerminalSession,
    appendSystemMessage,
    appendUserMessage,
    sendMessageToSession,
    closeSession,
    deleteSession,
    switchSession,
    cancelSession,
    stopSessionConversationTask,
    respondToQuestion,
    dismissQuestion,
    respondToPermission,
    toggleTodo,
    restoreTodosFromTranscript,
    restorePendingPermissionFromTranscript,
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
    resumeSessionFromMonitorDrawer,
    ensureSessionForMonitorDrawer,
  } = useClaudeSessions({
    subscribeLive: false,
    onClaudeTurnComplete: (p) => {
      advanceTeamAfterTurnRef.current(p);
    },
    beforeSpawnClaudeRef,
    claudeConcurrencyInvokeContextRef,
    claudeSpawnExtrasContextRef,
    resolveExecutionEngineRef,
    resolveExecutionRepositoryPathRef,
    resolveClaudeProxyBypassRef,
    onClaudeSpawnBlocked: (blockedMessage) => {
      message.warning(blockedMessage);
    },
    companionSessionIds,
    onSessionTabIdMigrated: handleSessionTabIdMigrated,
  });

  const sessionsLatestRef = sessionsLiveRef;
  const sessionsStructureKey = useSyncExternalStore(
    isCurrentPrimaryMainWorkspaceWindowSync()
      ? subscribeClaudeSessionsStructure
      : () => () => {},
    getClaudeSessionsStructureKey,
    getClaudeSessionsStructureKey,
  );

  const closeSessionsForRepositoryPath = useCallback(
    (repositoryPath: string) => {
      const related = sessionsLatestRef.current.filter((session) =>
        repositoryPathsMatch(session.repositoryPath, repositoryPath),
      );
      for (const session of related) {
        closeSession(session.id);
      }
    },
    [closeSession],
  );

  const handleRemoveRepositoryWithSessionCleanup = useCallback(
    async (repository: Repository) => {
      closeSessionsForRepositoryPath(repository.path);
      await handleRemoveRepository(repository);
    },
    [closeSessionsForRepositoryPath, handleRemoveRepository],
  );

  const handleDetachRepositoryFromProjectWithSessionCleanup = useCallback(
    async (projectId: string, repositoryId: number) => {
      const repository = repositories.find((item) => item.id === repositoryId);
      if (repository) {
        closeSessionsForRepositoryPath(repository.path);
      }
      await handleDetachRepositoryFromProject(projectId, repositoryId);
    },
    [closeSessionsForRepositoryPath, handleDetachRepositoryFromProject, repositories],
  );

  const repositoriesLatestRef = useRef(repositories);
  repositoriesLatestRef.current = repositories;

  const repositoryMainBindingsLatestRef = useRef(repositoryMainSessionBindings);
  repositoryMainBindingsLatestRef.current = repositoryMainSessionBindings;

  const releaseSessionHostProcessRef = useRef(releaseSessionHostProcess);
  releaseSessionHostProcessRef.current = releaseSessionHostProcess;

  const bindRepositoryMainSession = useCallback(
    async (
      repositoryPath: string,
      sessionId: string,
      opts?: { deferHostRelease?: boolean },
    ) => {
      const key = normalizeRepositoryPathForMatch(repositoryPath);
      const nextId = sessionId.trim();
      if (!nextId) {
        return;
      }
      const prevRaw = repositoryMainBindingsLatestRef.current[key]?.trim();
      if (prevRaw && prevRaw !== nextId && !opts?.deferHostRelease) {
        const mainOwner = isProjectMainSessionBindingKey(key)
          ? null
          : resolveMainOwnerAgentNameForRepositoryPath(repositoriesLatestRef.current, key);
        const prevTabId = resolveBoundMainSessionId(
          key,
          repositoryMainBindingsLatestRef.current,
          sessionsLatestRef.current,
          mainOwner,
        );
        const prevSession =
          (prevTabId ? sessionsLatestRef.current.find((s) => s.id === prevTabId) : null) ??
          resolveSessionFromBindingValue(prevRaw, sessionsLatestRef.current);
        if (prevSession && prevSession.id !== nextId) {
          window.setTimeout(() => {
            void releaseSessionHostProcessRef.current(prevSession.id);
          }, 0);
        }
      }
      setRepositoryMainSessionBindings((prev) => {
        if (prev[key] === nextId) return prev;
        const next = { ...prev, [key]: nextId };
        void setAppSetting(REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [],
  );

  const employeesLatestRef = useRef(employees);
  employeesLatestRef.current = employees;
  const workflowTemplatesLatestRef = useRef(workflowTemplates);
  workflowTemplatesLatestRef.current = workflowTemplates;

  const monitorPanelDefault = useMonitorPanelDefault();
  const monitorOverviewActive =
    (monitorPanelDefault.visible &&
      (monitorPanelDefault.placement === "left" || monitorPanelDefault.placement === "right")) ||
    monitorDrawerTarget != null ||
    viewMode.view.kind === "inspect";

  /** 监控侧栏 / Drawer 用：指纹节流，避免流式时每帧跑巨型 useMonitorOverview */
  const sessionsSyncedForMonitorUi = useMonitorSessionsForOverview(sessionsLiveRef, monitorOverviewActive);

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
        const eventEntries = await Promise.all(
          tasks.slice(0, 8).map(async (task) => [task.id, await listTaskEvents(task.id)] as const),
        );
        const pendingEntries = await Promise.all(
          tasks.slice(0, 8).map(async (task) => [task.id, await listTaskPendingEmployees(task.id)] as const),
        );
        applyWorkflowTasksForSession(toClaudeSessionId, tasks, eventEntries, pendingEntries, {
          dropCreatorIds: new Set([fromTabId]),
        });
      } catch (error) {
        console.error("Reload workflow tasks after session tab id migration failed:", error);
      }
    })();
  };

  const handleCloseSession = useCallback(
    (sessionId: string) => {
      const session = sessionsLatestRef.current.find((s) => s.id === sessionId);
      const creatorIds = new Set<string>([sessionId]);
      if (session?.claudeSessionId?.trim()) {
        creatorIds.add(session.claudeSessionId.trim());
      }
      const nextTasks = removeWorkflowTasksForSessionCreators(workflowTasksRef.current, creatorIds);
      const liveTaskIds = collectLiveWorkflowTaskIds(nextTasks);
      setWorkflowTasks(nextTasks);
      commitWorkflowTaskEventsByTaskId((prev) => pruneRecordByTaskIds(prev, liveTaskIds));
      commitWorkflowRuntimeSnapshotsByTaskId((prev) => pruneRecordByTaskIds(prev, liveTaskIds));
      setTaskPendingEmployeesByTaskId((prev) => pruneRecordByTaskIds(prev, liveTaskIds));
      setWorkflowRuntimeStateByTaskId((prev) => pruneRecordByTaskIds(prev, liveTaskIds));
      purgeWorkflowWorkerSessionBindingsRef.current(creatorIds);
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

  const extraPanesLatestRef = useRef(extraPanes);
  extraPanesLatestRef.current = extraPanes;
  const primaryPaneRuntimeOverrideLatestRef = useRef(primaryPaneRuntimeOverride);
  primaryPaneRuntimeOverrideLatestRef.current = primaryPaneRuntimeOverride;
  const paneCountLatestRef = useRef(paneCount);
  paneCountLatestRef.current = paneCount;
  const activeRepositoryIdLatestRef = useRef(activeRepositoryId);
  activeRepositoryIdLatestRef.current = activeRepositoryId;
  const activeProjectIdLatestRef = useRef(activeProjectId);
  activeProjectIdLatestRef.current = activeProjectId;
  const activeWorkspaceFocusLatestRef = useRef(activeWorkspaceFocus);
  activeWorkspaceFocusLatestRef.current = activeWorkspaceFocus;
  const projectsLatestRef = useRef(projects);
  projectsLatestRef.current = projects;

  useEffect(() => {
    const buildSessionPaneSpawnContext = (): SessionPaneSpawnContext => {
      const activeId = activeSessionIdLatestRef.current?.trim() ?? "";
      const activeSession = activeId
        ? sessionsLatestRef.current.find((item) => item.id === activeId) ?? null
        : null;
      const activeRepository =
        activeRepositoryIdLatestRef.current != null
          ? repositoriesLatestRef.current.find((item) => item.id === activeRepositoryIdLatestRef.current) ??
            null
          : null;
      const activeProject =
        activeProjectIdLatestRef.current != null
          ? projectsLatestRef.current.find((item) => item.id === activeProjectIdLatestRef.current) ?? null
          : null;
      const chatContextRepository = activeSession
        ? resolveChatContextRepository({
            activeRepository,
            activeProject,
            activeWorkspaceFocus: activeWorkspaceFocusLatestRef.current,
            repositories: repositoriesLatestRef.current,
            sessionRepositoryPath: activeSession.repositoryPath,
            sessionRepositoryName: activeSession.repositoryName,
          })
        : null;
      // 单屏时 Composer 改的是仓库/员工 executionEngine；多屏 override 不得覆盖，
      // 否则残留的 primaryPaneRuntime（含从多屏收起后未清除的持久化值）会导致 UI 已切换但 spawn 仍走旧引擎。
      const multiPane = paneCountLatestRef.current > 1;
      return {
        activeSessionId: activeId || null,
        chatContextRepository,
        primaryPaneRuntime: multiPane ? primaryPaneRuntimeOverrideLatestRef.current : null,
        extraPanes: multiPane ? extraPanesLatestRef.current : [],
      };
    };

    resolveExecutionEngineRef.current = (session) =>
      resolveEngineForSessionSpawn(
        session,
        repositoriesLatestRef.current,
        employeesLatestRef.current,
        buildSessionPaneSpawnContext(),
      );
    resolveExecutionRepositoryPathRef.current = (session) =>
      resolveRepositoryPathForSessionSpawn(
        session,
        repositoriesLatestRef.current,
        employeesLatestRef.current,
        buildSessionPaneSpawnContext(),
      );
    resolveClaudeProxyBypassRef.current = (session) =>
      resolveClaudeProxyBypassForSessionSpawn(
        session,
        repositoriesLatestRef.current,
        employeesLatestRef.current,
        buildSessionPaneSpawnContext(),
      );
    // 闭包仅捕获稳定的 ref 与模块级函数，resolve 被调用时才读取最新 ref.current，
    // 故只需在挂载时赋值一次；避免流式期间每帧重新创建并赋值闭包。
  }, []);

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
      const repo = resolveRepositoryForSession({
        session: target,
        repositories,
        bindings: repositoryMainSessionBindings,
        sessions: sessionsLatestRef.current,
        preferredRepositoryId: activeRepositoryId,
      });
      const activeProjectForJump = activeProjectId
        ? projects.find((item) => item.id === activeProjectId) ?? null
        : null;
      const keepProjectFocus = shouldKeepProjectFocusWhenSwitchingSession({
        session: target,
        activeWorkspaceFocus,
        activeProject: activeProjectForJump,
        repositories,
        workspaceMode: resolveWorkspaceMode({ activeProjectId, projects }),
      });
      // 同 repo 重复跳转时短路：避免对同一个 repo.id 二次触发 setActiveRepositoryWithOwner
      // 内部的 activeProjectId/activeRepositoryId/activeWorkspaceFocus 4-setter 链，
      // 进而避免 useCallback 闭包重生成、jumpToSessionWithRepositoryRef 重写以及 git 面板
      // (useRepositoryFilesExplorer/useRepositoryExplorerGitStatus/GitRepoSection) 的级联 reconcile。
      if (repo && !keepProjectFocus && repo.id !== activeRepositoryId) {
        setActiveRepositoryWithOwner(repo.id);
      }
      switchSession(canonicalId);
    },
    [
      activeProjectId,
      activeRepositoryId,
      activeWorkspaceFocus,
      projects,
      repositories,
      repositoryMainSessionBindings,
      setActiveRepositoryWithOwner,
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

  const handleStopSessionConversationTask = useCallback(
    (item: SessionConversationTaskItem) => {
      if (item.cancelMode === "invocation") {
        const key = item.invocationKey?.trim();
        if (!key) return;
        handleCancelOmcDirectBatchInvocation(key);
        void message.info("已请求结束后台任务");
        return;
      }
      // 后台 PTY 脚本：直接调 closeTerminalSession 让后端 killer.kill，
      // 并标 store exited。不走 stopSessionConversationTask/cancelSession
      // （那是 Claude host session，对 PTY 子进程无效）。
      if (item.source === "background_script") {
        const wid = item.workspaceId?.trim();
        const tid = item.terminalId?.trim();
        if (!wid || !tid) {
          void message.warning("后台脚本终端信息缺失，无法结束");
          return;
        }
        markExecutionEnvironmentDispatchItemExited({
          workerSessionId: tid,
          killedByUser: true,
          exitMessage: "已手动结束",
        });
        void closeTerminalSession(wid, tid).catch(() => undefined);
        void message.info("已请求结束后台脚本");
        return;
      }
      if (stopSessionConversationTask(item)) {
        void message.info("已请求结束执行");
        return;
      }
      const sid = item.sessionId?.trim();
      if (sid) {
        cancelSession(sid);
        void message.info("已请求结束执行");
      }
    },
    [cancelSession, handleCancelOmcDirectBatchInvocation, stopSessionConversationTask],
  );

  const {
    handleClaudeTurnComplete,
    handleComposerExecute,
    handleDecideWorkflowTask,
    handleSendMessageWithTask,
    moveWorkflowAutomationSessionId,
    notifyOmcEmployeeDirectBatchTaskDone,
    prepareFreshOmcEmployeeWorkerForDirectBatch,
    purgeWorkflowWorkerSessionBindings,
    refreshEmployeeData,
  } = useWorkflowTeamAutomation({
    activeSessionId,
    appendSystemMessage,
    closeSession: handleCloseSession,
    createSession,
    employees,
    executeSession,
    executeTerminalSession,
    flushDingTalkAutomationReplyForTurn,
    repositoryMainSessionBindings,
    repositories,
    sessions,
    sessionsLiveRef,
    setEmployeeTaskCounts,
    setEmployees,
    setTaskPendingEmployeesByTaskId,
    setWorkflowRuntimeSnapshotsByTaskId: commitWorkflowRuntimeSnapshotsByTaskId,
    setWorkflowRuntimeStateByTaskId,
    setWorkflowTaskEventsByTaskId: commitWorkflowTaskEventsByTaskId,
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
  purgeWorkflowWorkerSessionBindingsRef.current = purgeWorkflowWorkerSessionBindings;
  advanceTeamAfterTurnRef.current = handleClaudeTurnComplete;

  const handleComposerExecuteRef = useRef(handleComposerExecute);
  handleComposerExecuteRef.current = handleComposerExecute;
  const sendMessageToSessionRef = useRef(sendMessageToSession);
  sendMessageToSessionRef.current = sendMessageToSession;

  const handleDispatchExecutionEnvironment = useCallback(
    async (input: {
      prompt: string;
      userBubblePrompt?: string;
      defaultInstructionApplied?: string;
    }) => {
      const mainSessionId =
        resolveExecutionEnvironmentDispatchAnchorSessionId({
          activeSessionId,
          sessions: sessionsLatestRef.current,
          repositoryMainSessionBindings: repositoryMainBindingsLatestRef.current,
          repositories: repositoriesLatestRef.current,
        }) ?? activeSessionId;
      if (!mainSessionId) return;
      await dispatchExecutionEnvironmentFromMainSession(
        {
          getSessions: () => sessionsLatestRef.current,
          codexAvailable,
          cursorAvailable,
          geminiAvailable,
          opencodeAvailable,
          qoderAvailable,
          createSession,
          executeSession: (workerTabId, prompt, opts) => executeSession(workerTabId, prompt, opts),
          appendSystemMessage,
        },
        {
          mainSessionId,
          prompt: input.prompt,
          userBubblePrompt: input.userBubblePrompt,
          defaultInstructionApplied: input.defaultInstructionApplied,
        },
      );
    },
    [
      activeSessionId,
      codexAvailable,
      cursorAvailable,
      geminiAvailable,
      opencodeAvailable,
      qoderAvailable,
      createSession,
      executeSession,
      appendSystemMessage,
    ],
  );

  const handleDispatchSessionFeedbackLoop = useCallback(
    async (input: {
      anchorSessionId: string;
      prompt: string;
      kind: FeedbackLoopDispatchKind;
      cycleIndex?: number;
    }) => {
      await dispatchSessionFeedbackLoopAnalysis(
        {
          getSessions: () => sessionsLatestRef.current,
          createSession,
          executeSession: (workerTabId, prompt, opts) => executeSession(workerTabId, prompt, opts),
        },
        input,
      );
    },
    [createSession, executeSession],
  );

  useScheduledClaudeTaskRunner({
    repositoriesRef: repositoriesLatestRef,
    sessionsRef: sessionsLatestRef,
    bindingsRef: repositoryMainBindingsLatestRef,
    employeesRef: employeesLatestRef,
    workflowTemplatesRef: workflowTemplatesLatestRef,
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

  claudeSpawnExtrasContextRef.current = async (session) =>
    resolveClaudeSpawnExtrasForSession({
      session,
      projects,
      repositories,
      preferredProjectId: activeProjectId,
      activeAssistantId: viewMode.view.kind === "cockpit" ? cockpitActiveAssistantId : null,
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

  const { omcInstalled } = useOmcPluginInstalled(true);
  const {
    employeeMonitorItems,
    repositoryMemberMonitorItems,
    teamMonitorItems,
  } = useMonitorOverview({
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
    omcInstalled: omcInstalled === true,
    monitorDrawerOpen: monitorDrawerTarget != null,
    monitorOverviewActive,
  });
  const scopedRepositoryMemberMonitorItems = useMemo(
    () =>
      filterRepositoryMemberMonitorItemsBySelection(repositoryMemberMonitorItems, {
        activeProjectId,
        activeRepositoryId,
        projects,
      }),
    [activeProjectId, activeRepositoryId, projects, repositoryMemberMonitorItems],
  );
  const executionEnvironmentDispatchHistory = useExecutionEnvironmentDispatchHistoryDays();
  const sessionConversationTaskItems = useSessionConversationTasks(activeSessionId, sessions, {
    repositoryMainSessionBindings,
    repositories,
  });
  const dispatchAnchorSessionId = useMemo(
    () =>
      resolveExecutionEnvironmentDispatchAnchorSessionId({
        activeSessionId,
        sessions: sessionsLatestRef.current,
        repositoryMainSessionBindings,
        repositories,
      }),
    [activeSessionId, repositoryMainSessionBindings, repositories, sessionsStructureKey],
  );
  useExecutionEnvironmentDispatchWorkerTranscriptPreload(
    dispatchAnchorSessionId,
    sessions,
    reloadFullDiskTranscript,
  );
  const activeProject = useMemo(
    () => (activeProjectId ? projects.find((p) => p.id === activeProjectId) ?? null : null),
    [activeProjectId, projects],
  );
  const mentionEmployees = useMemo(() => {
    const trellisScoped = shouldHideEmployeeUi(activeProject) && activeProject != null;
    return employees.filter((item) => {
      if (!item.enabled || !item.name.trim() || isOmcMonitorEmployeeRecord(item)) {
        return false;
      }
      if (trellisScoped) {
        return employeeInProjectScope(item, activeProject);
      }
      const monitoredEmployeeIds = new Set(employeeMonitorItems.map((entry) => entry.employeeId));
      return monitoredEmployeeIds.has(item.id);
    });
  }, [activeProject, employeeMonitorItems, employees]);
  const teamPanelEmployeeMonitorItems = useMemo(
    () =>
      resolveTeamPanelEmployeeMonitorItems(employeeMonitorItems, employees, {
        activeProjectId,
        projects,
        restrictToProjectScope: shouldHideEmployeeUi(activeProject),
        omcInstalled: omcInstalled === true,
      }),
    [activeProject, activeProjectId, employeeMonitorItems, employees, omcInstalled, projects],
  );
  const [repositoryFileOpenRequest, setRepositoryFileOpenRequest] = useState<OpenRepositoryFileDetail | null>(null);
  const openRepositoryFileByEvent = useCallback((detail: OpenRepositoryFileDetail) => {
    const relativePath = detail.relativePath.trim();
    if (!relativePath) return;
    const repoPath = detail.repositoryPath?.trim() ?? "";
    const repo = detail.repositoryId != null
      ? repositories.find((item) => item.id === detail.repositoryId) ?? null
      : repoPath
        ? repositories.find((item) => item.path === repoPath) ?? null
        : null;
    if (!repo) {
      message.warning("未找到代码锚点对应的仓库");
      return;
    }
    // 多屏下不切全局 active：各 pane 自管仓库，避免第二屏打开文件污染 primary pane / 左栏 / 文件树。
    // 单屏仍保留"打开文件时切到该仓库"语义。文件路由由 repositoryFileOpenRequest + fileRootPath 处理。
    if (paneCountRef.current === 1) {
      setActiveRepositoryWithOwner(repo.id);
    }
    setRepositoryFileOpenRequest({
      repositoryId: repo.id,
      repositoryPath: repo.path,
      relativePath,
      line: detail.line ?? null,
    });
    // 打开文件 → 进入 chat 子模式（文件编辑器在 chat 主区下方）
    viewMode.enter({ kind: "chat" });
  }, [repositories, setActiveRepositoryWithOwner, viewMode]);
  const workspaceMode = useWorkspaceMode({ activeProjectId, projects });
  const enterCockpit = useCallback((view = cockpitView()) => {
    viewMode.enter(view);
  }, [viewMode]);
  /** 侧栏点「工作区/仓库需求」后短暂屏蔽「选工作区 → 回聊天」，避免菜单点击落到行上把 Cockpit 顶掉。 */
  const suppressProjectSelectToChatRef = useRef(false);
  const openRequirementAssistant = useCallback((detail: OpenAssistantDetail) => {
    suppressProjectSelectToChatRef.current = true;
    flushSync(() => {
      setSearchOpen(false);
      setAssistantInitialTarget(detail);
      const assistantId = typeof detail.assistantId === "string" ? detail.assistantId.trim() : "";
      setCockpitSurfaceInitialAssistantId(assistantId || null);
      if (assistantId) setCockpitResumeAssistantId(assistantId);
      setAssistantOpenRequestKey((value) => value + 1);
    });
    viewMode.enter(cockpitView());
    requestAnimationFrame(() => {
      suppressProjectSelectToChatRef.current = false;
    });
  }, [viewMode]);
  const openMcpHubFromSidebar = useCallback(() => {
    setSearchOpen(false);
    viewMode.enter(inspectView(mcpHubInspectTool()));
  }, [viewMode]);
  const openSkillsHubFromSidebar = useCallback(() => {
    setSearchOpen(false);
    viewMode.enter(inspectView(skillsHubInspectTool()));
  }, [viewMode]);
  const openAutomationHubFromSidebar = useCallback(() => {
    setSearchOpen(false);
    enterCockpit(cockpitView("automation"));
  }, [enterCockpit]);
  const openAssistantsFromSidebar = useCallback(() => {
    if (!activeProjectId && activeRepositoryId != null) {
      message.warning("Standalone Repo 不支持工作台配置；升格为 Workspace 后启用");
      return;
    }
    enterAuthorPane("assistants");
  }, [activeProjectId, activeRepositoryId, enterAuthorPane]);
  const openClaudePluginsFromSidebar = useCallback(() => {
    if (!activeProjectId && activeRepositoryId != null) {
      message.warning("Standalone Repo 不支持工作台配置；升格为 Workspace 后启用");
      return;
    }
    enterAuthorPane("claude-plugins");
  }, [activeProjectId, activeRepositoryId, enterAuthorPane]);
  const leftSidebarHubQuickEntries = useLeftSidebarHubQuickEntries();
  const showLeftSidebarWorkspaceList = useLeftSidebarWorkspaceListDefault();
  const showRepositoryIconBadgesInWorkspaceList = useLeftSidebarRepositoryIconBadgesDefault();
  const showMonitorOnLeft =
    monitorPanelDefault.visible && monitorPanelDefault.placement === "left";
  const openBuiltinAssistant = useCallback((assistantId: string) => {
    const trimmed = assistantId.trim();
    if (!trimmed) return;
    setSearchOpen(false);
    setAssistantInitialTarget(null);
    setCockpitSurfaceInitialAssistantId(trimmed);
    setCockpitResumeAssistantId(trimmed);
    setAssistantOpenRequestKey((value) => value + 1);
    enterCockpit();
  }, [enterCockpit]);
  const activateAssistant = useCallback(
    async (assistant: AssistantEntry) => {
      const repositoryPath =
        activeRepositoryId != null
          ? repositories.find((item) => item.id === activeRepositoryId)?.path ?? null
          : null;
      await activateAssistantTemplate({
        assistant,
        repositoryPath,
        preferredSessionId: activeSessionId ?? undefined,
        workflowTemplates,
        repositories,
        sessions,
        repositoryMainBindings: repositoryMainSessionBindings,
        executeSession: handleComposerExecute,
        directExecuteSession: (sessionId, prompt) => executeSession(sessionId, prompt),
        createSession,
        message,
        modal: appModal,
        notification,
      });
    },
    [
      activeRepositoryId,
      activeSessionId,
      appModal,
      executeSession,
      handleComposerExecute,
      message,
      repositories,
      repositoryMainSessionBindings,
      sessions,
      workflowTemplates,
    ],
  );
  const exitCockpit = useCallback(() => {
    flushSync(() => {
      setCockpitActiveAssistantId(null);
      viewMode.enter({ kind: "chat" });
    });
  }, [viewMode]);

  const openScheduledTasksForRepository = useCallback((repository: Repository) => {
    const path = repository.path?.trim();
    if (!path) return;
    setScheduledTasksOverlay({
      path,
      name: repository.name?.trim() || repositoryFolderBasename(repository),
    });
  }, []);

  const closeScheduledTasksOverlay = useCallback(() => {
    setScheduledTasksOverlay(null);
  }, []);

  const composerProjectRoleTagOptions = useMemo(() => {
    if (!shouldHideEmployeeUi(activeProject)) {
      return [];
    }
    return buildProjectRoleTagOptions(activeProject, repositories);
  }, [activeProject, repositories]);
  const composerProjectRepositoryMentionOptions = useMemo(() => {
    if (!shouldHideEmployeeUi(activeProject)) {
      return [];
    }
    return buildProjectRepositoryMentionOptions(activeProject, repositories);
  }, [activeProject, repositories]);
  const composerHideEmployeesInAtMode = false;
  const selectableWorkflowEmployeeIds = useMemo(
    () => employeeMonitorItems.map((item) => item.employeeId),
    [employeeMonitorItems],
  );
  useEffect(() => {
    const workflowIds = workflowTemplates.map((item) => item.id);
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

  const openSessionRepositoryPathsKey = useMemo(() => {
    const paths = new Set<string>();
    for (const session of sessionsLatestRef.current) {
      const path = session.repositoryPath?.trim();
      if (path) paths.add(path);
    }
    return [...paths].sort().join("|");
  }, [sessionsStructureKey]);

  useEffect(() => {
    if (!tabsHydrated || !openSessionRepositoryPathsKey) return;
    let cancelled = false;
    const cleanups: Array<() => void> = [];
    const paths = openSessionRepositoryPathsKey.split("|").filter(Boolean);
    for (let index = 0; index < paths.length; index += 1) {
      const path = paths[index]!;
      const repo = repositories.find((item) => repositoryPathsMatch(item.path, path));
      const keepPath =
        Boolean(repo) ||
        sessionsLatestRef.current.some(
          (session) =>
            repositoryPathsMatch(session.repositoryPath, path) &&
            isProjectRootSessionDisplayName(session.repositoryName ?? ""),
        );
      if (!keepPath) continue;
      const name = repo?.name?.trim() || repositoryFolderBasename(path);
      cleanups.push(
        runWhenIdle(
          () => {
            if (cancelled) return;
            void refreshDiskSessionsForRepository(path, name);
          },
          { timeoutMs: 1200 + index * 500 },
        ),
      );
    }
    return () => {
      cancelled = true;
      for (const cleanup of cleanups) cleanup();
    };
  }, [openSessionRepositoryPathsKey, repositories, refreshDiskSessionsForRepository, tabsHydrated]);

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
        const eventEntries = await Promise.all(
          tasks.slice(0, 8).map(async (task) => [task.id, await listTaskEvents(task.id)] as const),
        );
        const pendingEntries = await Promise.all(
          tasks.slice(0, 8).map(async (task) => [task.id, await listTaskPendingEmployees(task.id)] as const),
        );
        applyWorkflowTasksForSession(activeSessionId, tasks, eventEntries, pendingEntries);
      } catch (error) {
        console.error("Failed to load workflow tasks:", error);
      }
    })();
  }, [activeSessionId, applyWorkflowTasksForSession]);

  const activeRepository = useMemo(
    () => repositories.find((p) => p.id === activeRepositoryId) ?? null,
    [repositories, activeRepositoryId],
  );

  const fileEditorRootPath = useMemo(() => {
    const path = resolveChatTopbarContext({
      activeRepository,
      activeProject,
      activeWorkspaceFocus,
      repositories,
    }).openPath.trim();
    return path || activeRepository?.path?.trim() || null;
  }, [activeRepository, activeProject, activeWorkspaceFocus, repositories]);

  const authorPanelRepositoryPath = useMemo(() => {
    if (activeWorkspaceFocus === "project" && activeProject) {
      const projectPath = resolveProjectExplorerOpenPath(activeProject, repositories);
      if (projectPath) return projectPath;
    }
    return activeRepository?.path ?? null;
  }, [activeRepository, activeProject, activeWorkspaceFocus, repositories]);

  const scheduledTasksRepository = useMemo(
    () =>
      resolveScheduledTasksRepository({
        activeRepository,
        activeProject,
        activeWorkspaceFocus,
        repositories,
      }),
    [activeRepository, activeProject, activeWorkspaceFocus, repositories],
  );

  const openActiveScheduledTasksOverlay = useCallback(() => {
    if (!scheduledTasksRepository) return;
    openScheduledTasksForRepository(scheduledTasksRepository);
  }, [openScheduledTasksForRepository, scheduledTasksRepository]);

  // 仅依赖路径/名称字符串：避免 repositories 列表内任一字段（比如 metadata 流式更新）
  // 触发 activeRepository 引用变化，从而无谓重启磁盘会话刷新。
  const activeRepoPathForDiskRefresh = activeRepository?.path?.trim() ?? "";
  const activeRepoNameForDiskRefresh =
    activeRepository?.name?.trim() || (activeRepository ? repositoryFolderBasename(activeRepository) : "");
  useEffect(() => {
    if (!tabsHydrated || !activeRepoPathForDiskRefresh) return;
    const repoPath = activeRepoPathForDiskRefresh;
    const repoName = activeRepoNameForDiskRefresh || repoPath;
    const cancelIdle = runWhenIdle(() => {
      void refreshDiskSessionsForRepository(repoPath, repoName);
    }, { timeoutMs: 800 });
    return cancelIdle;
  }, [activeRepoPathForDiskRefresh, activeRepoNameForDiskRefresh, refreshDiskSessionsForRepository, tabsHydrated]);

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

  const enterAuthorAgents = useCallback(() => {
    enterAuthorPane("agents");
  }, [enterAuthorPane]);

  const enterAuthorWorkflows = useCallback(() => {
    enterAuthorPane("workflows");
  }, [enterAuthorPane]);

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
    enterAuthorAgents();
  }, [activeRepositoryId, activeRepository?.path, enterAuthorAgents, loadEmployeeAgentTypeOptionsFromRepositoryPath]);

  /** Author / Workflows 打开且 templates 就绪时，加载所有 workflow -> projectIds 映射 */
  useEffect(() => {
    if (!authorWorkflowPaneActive || workflowTemplates.length === 0) {
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
  }, [authorWorkflowPaneActive, workflowTemplates]);

  const openEmployeeConfigForRepositoryOwner = useCallback(
    async (repository: Repository) => {
      setEmployeeConfigRepositoryOwnerScopeOnly(true);
      setEmployeeConfigInitialCreateEmployeeName(repositoryFolderBasename(repository));
      setEmployeeConfigPrdProjectId(null);
      setEmployeeConfigPrdVisibleEmployeeIds([]);
      setEmployeeConfigDefaultRepositoryIds([repository.id]);
      await loadEmployeeAgentTypeOptionsFromRepositoryPath(repository.path);
      enterAuthorAgents();
    },
    [enterAuthorAgents, loadEmployeeAgentTypeOptionsFromRepositoryPath],
  );

  const openWorkflowConfigFromSidebar = useCallback(() => {
    setWorkflowConfigPrdProjectId(null);
    setWorkflowConfigInitialWorkflowId(null);
    enterAuthorWorkflows();
  }, [enterAuthorWorkflows]);

  const {
    effectiveRightCollapsed,
    handlePaneRepositorySelect,
    handlePaneProjectNewSession,
    handleNewPaneSession,
    handleNewPaneSessionInNextSlot,
    handleNewPaneProjectSessionInNextSlot,
    handleChangePaneCount,
    mainLayoutContentRef,
    mainLayoutLeftWidthPx,
    mainLayoutRightWidthPx,
    setMainLayoutLeftWidthPx,
    setMainLayoutRightWidthPx,
    paneChangeInFlight,
    markSessionTabMigrated,
  } = useMainLayoutModes({
    activeRepository: activeRepository ?? undefined,
    activeProject,
    activeWorkspaceFocus,
    activeSessionId,
    activeSessionRepositoryPath:
      sessions.find((item) => item.id === activeSessionId)?.repositoryPath ?? null,
    collapsed,
    createSession,
    paneCount,
    extraPanes,
    projects,
    repositories,
    repositoryMainSessionBindings,
    sessions,
    setActiveRepositoryId,
    setPaneCount,
    setExtraPanes,
    paneLayoutHydrated,
    tabsHydrated,
    primaryPaneRuntimeOverride,
    setPrimaryPaneRuntimeOverride,
    updateSessionModel,
  });

  // 桥接 handleSessionTabIdMigrated（定义在上方）到 useMainLayoutModes 的 markSessionTabMigrated。
  markSessionTabMigratedRef.current = markSessionTabMigrated;

  // 恢复：清除多屏槽位指向已不存在会话的 orphaned sessionId
  const paneSessionRecoveryDoneRef = useRef(false);
  useEffect(() => {
    if (!paneLayoutHydrated || !tabsHydrated) return;
    if (paneSessionRecoveryDoneRef.current) return;
    paneSessionRecoveryDoneRef.current = true;
    const sessionIds = new Set(sessions.map((s) => s.id));
    let changed = false;
    const updated = extraPanes.map((slot) => {
      if (slot.sessionId && !sessionIds.has(slot.sessionId)) {
        // 伴生会话可能已在 live store、尚未并入 React sessions：保留槽位，避免第二屏被清空。
        if (getClaudeSessionSnapshot(slot.sessionId)) {
          return slot;
        }
        changed = true;
        return { ...slot, sessionId: null };
      }
      return slot;
    });
    if (changed) {
      setExtraPanes(updated);
    }
  }, [paneLayoutHydrated, tabsHydrated, sessions, extraPanes, setExtraPanes]);

  const repoPanelPlacementDefault = useRepoPanelPlacementDefault();

  const handleNewPaneSessionForRepository = useCallback(
    (repository: Repository) => {
      void handleNewPaneSessionInNextSlot(repository, repository.path);
    },
    [handleNewPaneSessionInNextSlot],
  );

  const handleNewPaneSessionForProject = useCallback(
    (project: ProjectItem) => {
      const rootPath = resolveWorkspaceRootPath({
        scope: "project",
        project,
        repositories,
        projects,
      });
      if (!rootPath) {
        message.warning("无法解析工作区目录，请先配置工作区根目录或关联仓库");
        return;
      }
      if (project.repositoryIds.length === 0) {
        message.warning("该工作区下暂无仓库，请先关联仓库");
        return;
      }
      void handleNewPaneProjectSessionInNextSlot(project);
    },
    [handleNewPaneProjectSessionInNextSlot, message, projects, repositories],
  );

  const handleOpenHistorySessionInInspector = useCallback(
    (sessionId: string) => {
      const sid = sessionId.trim();
      if (!sid) return;
      setInspectorHistorySessionId(sid);
    },
    [],
  );

  const handleCreateTerminalEmployeeSession = useCallback(
    async (employeeId: string): Promise<string | null> => {
      const employee = employeesLatestRef.current.find((item) => item.id === employeeId);
      if (!employee || isOmcMonitorEmployeeRecord(employee)) {
        return null;
      }

      const monitorItem = employeeMonitorItems.find((item) => item.employeeId === employeeId);
      let repoPath = monitorItem?.repositoryPath?.trim();
      let repoName = monitorItem?.repositoryName?.trim();

      if (!repoPath) {
        const activeId = activeSessionIdLatestRef.current?.trim() ?? "";
        const activeSession = sessionsLatestRef.current.find((item) => item.id === activeId);
        if (activeSession && !isTerminalWorkerWiseTab(activeSession)) {
          repoPath = activeSession.repositoryPath;
          repoName = activeSession.repositoryName;
        }
      }
      if (!repoPath) {
        const repo = repositoriesLatestRef.current.find((item) => item.id === activeRepositoryId);
        if (repo) {
          repoPath = repo.path;
          repoName = repositorySessionTabDisplayName(repo);
        }
      }
      if (!repoPath?.trim()) {
        message.warning("请先选择仓库或打开主会话后再新建终端会话");
        return null;
      }

      try {
        const { workerTabId } = await createFreshTerminalWorkerTab(
          {
            getSessions: () => sessionsLatestRef.current,
            createSession,
            closeWorkerTab: closeSession,
          },
          repoPath,
          repoName ?? repoPath,
          employee,
        );
        message.success("新建会话成功");
        return workerTabId;
      } catch (err) {
        message.error(err instanceof Error ? err.message : "新建终端会话失败");
        return null;
      }
    },
    [activeRepositoryId, createSession, closeSession, employeeMonitorItems],
  );

  const canRestoreHistorySessionForDrawer = useCallback(
    (sessionId: string) => {
      const session = sessionsLatestRef.current.find((item) => item.id === sessionId);
      if (!session) return false;
      return !isSessionBoundAsRepositoryMain(
        session,
        repositoryMainBindingsLatestRef.current,
        sessionsLatestRef.current,
        repositories,
      );
    },
    [repositories],
  );

  const handleRestoreHistorySessionAsMain = useCallback(
    async (sessionId: string) => {
      const sid = sessionId.trim();
      if (!sid) return;
      const target = sessionsLatestRef.current.find((item) => item.id === sid || item.claudeSessionId === sid);
      if (!target) {
        message.warning("未找到该会话");
        return;
      }
      if (!target.repositoryPath?.trim()) {
        message.warning("无法恢复：会话缺少仓库路径");
        return;
      }
      viewMode.enter({ kind: "chat" });
      await bindRepositoryMainSessionRef.current(target.repositoryPath, target.id);
      jumpToSessionWithRepositoryRef.current(target.id);
      if (target.claudeSessionId?.trim() || target.id.trim()) {
        try {
          await reloadFullDiskTranscript(target.id);
        } catch {
          /* 落盘略晚时不阻断恢复 */
        }
      }
      setInspectorHistorySessionId(null);
    },
    [reloadFullDiskTranscript, viewMode],
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

  const handleRefreshHistorySessions = useCallback(
    (scope: { repositoryPath: string; repositoryName: string }) => {
      const path = scope.repositoryPath.trim();
      if (!path) {
        return Promise.resolve();
      }
      const name = scope.repositoryName.trim() || activeRepository?.name || path;
      return refreshDiskSessionsForRepository(path, name);
    },
    [activeRepository?.name, refreshDiskSessionsForRepository],
  );

  const sessionOwnerHintsRef = useRef(loadSessionOwnerHints());
  useEffect(() => {
    const onHintsUpdated = () => {
      sessionOwnerHintsRef.current = loadSessionOwnerHints();
    };
    window.addEventListener(WISE_SESSION_OWNER_HINTS_CHANGED_EVENT, onHintsUpdated);
    return () => {
      window.removeEventListener(WISE_SESSION_OWNER_HINTS_CHANGED_EVENT, onHintsUpdated);
    };
  }, []);

  const switchSessionIfNeeded = useCallback(
    (sessionId: string) => {
      const nextId = sessionId.trim();
      if (!nextId) {
        return;
      }
      if (activeSessionIdLatestRef.current?.trim() === nextId) {
        return;
      }
      switchSession(nextId);
    },
    [switchSession],
  );

  /** 多仓工作区内点仓库行：仅切换展示会话，不更新 per-repo 主会话绑定。 */
  function switchRepositoryDisplaySession(repository: Repository): string | null {
    const sessionsNow = sessionsLatestRef.current;
    const target = resolveSidebarSelectionTarget({ repository });
    const mainOwnerPick = resolveMainOwnerAgentNameForRepositoryPath(repositories, target.path);
    const boundId = resolveBoundMainSessionId(
      target.path,
      repositoryMainSessionBindings,
      sessionsNow,
      mainOwnerPick,
    );
    if (boundId) {
      switchSessionIfNeeded(boundId);
      return boundId;
    }
    const latestForRepo = pickSessionForRepositorySidebarSelect(
      sessionsNow,
      target.path,
      sessionOwnerHintsRef.current,
      { mainOwnerAgentName: mainOwnerPick },
    );
    if (latestForRepo) {
      switchSessionIfNeeded(latestForRepo.id);
      return latestForRepo.id;
    }
    return null;
  }

  /** 绑定仓库主会话（不修改侧栏选中态）。 */
  function bindRepositoryMainSessionTarget(repository: Repository): string | null {
    const target = resolveSidebarSelectionTarget({ repository });
    const sessionId = switchRepositoryDisplaySession(repository);
    if (sessionId) {
      void bindRepositoryMainSession(target.path, sessionId);
    }
    return sessionId;
  }

  const ensureSessionInFlightRef = useRef<string | null>(null);

  async function createAndBindRepositoryMainSession(
    repository: Repository,
    priorActiveId: string | null | undefined,
    opts?: { carryDraft?: boolean },
  ): Promise<string> {
    const target = resolveSidebarSelectionTarget({ repository });
    // 手动「新建会话」时把旧会话输入框草稿迁移到新会话，避免新会话输入框显示为空。
    // 必须在 createSession 内部 setActiveSessionId 之前完成（见 onBeforeActivate 钩子）。
    const carryDraftFromId = opts?.carryDraft ? priorActiveId ?? undefined : undefined;
    const id = await createSession(target.path, target.displayName, {
      immediateActivate: true,
      onBeforeActivate: carryDraftFromId
        ? (newId) => migratePromptContextSessionKey(carryDraftFromId, newId)
        : undefined,
    });
    void bindRepositoryMainSession(target.path, id, { deferHostRelease: true });
    scheduleReleaseScopedClaudeHostsBeforeNewMain({
      kind: "repository",
      repositoryPath: target.path,
      newSessionId: id,
      priorActiveId,
    });
    return id;
  }

  async function createAndBindProjectMainSession(
    project: ProjectItem,
    priorActiveId: string | null | undefined,
    opts?: { carryDraft?: boolean },
  ): Promise<string | null> {
    const anchor = resolveProjectMainSessionAnchor(project, repositories);
    if (!anchor.path) {
      message.warning("该 Workspace 缺少根目录，请先配置 rootPath");
      return null;
    }
    const carryDraftFromId = opts?.carryDraft ? priorActiveId ?? undefined : undefined;
    const id = await createSession(anchor.path, anchor.displayName, {
      immediateActivate: true,
      onBeforeActivate: carryDraftFromId
        ? (newId) => migratePromptContextSessionKey(carryDraftFromId, newId)
        : undefined,
    });
    void bindRepositoryMainSession(projectMainSessionBindingKey(project.id), id, {
      deferHostRelease: true,
    });
    scheduleReleaseScopedClaudeHostsBeforeNewMain({
      kind: "project",
      project,
      newSessionId: id,
      priorActiveId,
    });
    return id;
  }

  /** 打开/恢复仓库主会话：先读绑定，再挑同路径最近会话；无可用会话时自动新建。 */
  async function ensureRepositoryMainSession(repository: Repository): Promise<string | null> {
    const target = resolveSidebarSelectionTarget({ repository });
    const flightKey = `repo:${target.path}`;
    if (ensureSessionInFlightRef.current === flightKey) {
      return null;
    }
    const existing = bindRepositoryMainSessionTarget(repository);
    if (existing) {
      return existing;
    }
    ensureSessionInFlightRef.current = flightKey;
    try {
      return await createAndBindRepositoryMainSession(
        repository,
        activeSessionIdLatestRef.current,
      );
    } finally {
      if (ensureSessionInFlightRef.current === flightKey) {
        ensureSessionInFlightRef.current = null;
      }
    }
  }

  async function ensureProjectMainSession(project: ProjectItem): Promise<string | null> {
    const anchor = resolveProjectMainSessionAnchor(project, repositories);
    const flightKey = `project:${project.id}:${anchor.path ?? ""}`;
    if (!anchor.path) {
      message.warning("该 Workspace 缺少根目录，请先配置 rootPath");
      return null;
    }
    if (ensureSessionInFlightRef.current === flightKey) {
      return null;
    }
    const existing = bindProjectMainSessionTarget(project);
    if (existing) {
      return existing;
    }
    ensureSessionInFlightRef.current = flightKey;
    try {
      return await createAndBindProjectMainSession(project, activeSessionIdLatestRef.current);
    } finally {
      if (ensureSessionInFlightRef.current === flightKey) {
        ensureSessionInFlightRef.current = null;
      }
    }
  }

  async function openRepositoryMainSession(
    repository: Repository,
    options?: { enterChat?: boolean },
  ): Promise<string | null> {
    setActiveRepositoryWithOwner(repository.id);
    if (options?.enterChat ?? true) {
      startTransition(() => {
        viewMode.enter({ kind: "chat" });
      });
    }
    // 多仓工作区内点成员仓：只更新侧栏/文件树焦点；有已绑定会话则切展示，禁止新建空壳。
    if (shouldSidebarRepositorySelectOnlyUpdateFocus(repository, projects)) {
      return switchRepositoryDisplaySession(repository);
    }
    return ensureRepositoryMainSession(repository);
  }

  /** 新建主会话前结束仍占着本机 Claude 的上一活动标签（含其它仓库，避免「数量」累加）。 */
  async function releasePriorActiveSessionHostBeforeNewMain(
    priorActiveId: string | null | undefined,
    newSessionId: string,
    alreadyReleasedTabIds?: ReadonlySet<string>,
  ): Promise<void> {
    const priorId = priorActiveId?.trim();
    const nextId = newSessionId.trim();
    if (!priorId || priorId === nextId) {
      return;
    }
    if (alreadyReleasedTabIds?.has(priorId)) {
      return;
    }
    const prior = sessionsLatestRef.current.find((s) => s.id === priorId);
    if (!prior) {
      return;
    }
    await releaseSessionHostProcessRef.current(prior.id);
  }

  /** 新建主会话前：结束目标仓库 / 项目范围内仍绑定的本机 Claude 进程，并收尾上一活动标签。 */
  async function releaseScopedClaudeHostsBeforeNewMain(
    params:
      | {
          kind: "repository";
          repositoryPath: string;
          newSessionId: string;
          priorActiveId?: string | null;
        }
      | {
          kind: "project";
          project: ProjectItem;
          newSessionId: string;
          priorActiveId?: string | null;
        },
  ): Promise<void> {
    const releaseOpts = {
      sessions: sessionsLatestRef.current,
      excludeSessionId: params.newSessionId,
      releaseWiseTabSession: (sessionId: string, ctx?: ReleaseWiseTabSessionContext) =>
        releaseSessionHostProcessRef.current(sessionId, ctx),
      onCancelTabSession: (sessionId: string) => cancelSession(sessionId),
    };
    const releasedTabIds =
      params.kind === "repository"
        ? await releaseClaudeHostProcessesForRepositoryScope({
            repositoryPath: params.repositoryPath,
            ...releaseOpts,
          })
        : await releaseClaudeHostProcessesForProjectScope({
            project: params.project,
            repositories: repositoriesLatestRef.current,
            ...releaseOpts,
          });
    await releasePriorActiveSessionHostBeforeNewMain(
      params.priorActiveId,
      params.newSessionId,
      releasedTabIds,
    );
  }

  function scheduleReleaseScopedClaudeHostsBeforeNewMain(
    params: Parameters<typeof releaseScopedClaudeHostsBeforeNewMain>[0],
  ): void {
    const run = () => {
      void releaseScopedClaudeHostsBeforeNewMain(params);
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        requestAnimationFrame(run);
      });
      return;
    }
    window.setTimeout(run, 0);
  }

  /** 手动「新建会话」：始终创建新标签并绑定为仓库主会话。 */
  async function handleManualNewRepositorySession(repository: Repository): Promise<void> {
    // 注意：这里只切 viewMode，不在这里翻 activeRepositoryId。
    // activeRepositoryId 的设置推迟到 jumpToSessionWithRepository 内部完成：
    //   1) 避免对同一个 repo.id 二次触发 setActiveRepositoryWithOwner 的 4-setter 链
    //      (activeProjectId/activeRepositoryId/activeWorkspaceFocus + schedulePersistActiveProjectId)；
    //   2) 避免 useCallback 闭包因 activeRepositoryId 依赖变化重生成，触发下游消费者级联 reconcile；
    //   3) createAndBindRepositoryMainSession 走 repository 入参解析路径与 owner project，
    //      不依赖 await 期间的 activeRepositoryId，延迟翻转安全。
    startTransition(() => {
      viewMode.enter({ kind: "chat" });
    });
    const id = await createAndBindRepositoryMainSession(
      repository,
      activeSessionIdLatestRef.current,
      { carryDraft: true },
    );
    jumpToSessionWithRepository(id);
  }

  /** 手动为 Workspace 新建项目主会话标签。 */
  async function handleManualNewProjectSession(project: ProjectItem): Promise<void> {
    const byId = new Map(repositories.map((repo) => [repo.id, repo]));
    const repos = project.repositoryIds
      .map((id) => byId.get(id))
      .filter((repo): repo is Repository => Boolean(repo));
    const anchor = resolveProjectMainSessionAnchor(project, repositories);
    if (!anchor.path) {
      message.warning("该 Workspace 缺少根目录，请先配置 rootPath");
      return;
    }
    const isStandaloneTrellisProject = project.id.startsWith("repo:");
    startTransition(() => {
      viewMode.enter({ kind: "chat" });
      if (repos[0]) {
        if (isStandaloneTrellisProject) {
          setActiveRepositoryWithOwner(repos[0].id);
        } else {
          setActiveProjectId(project.id);
          setActiveRepositoryId(repos[0].id);
        }
      } else if (!isStandaloneTrellisProject) {
        setActiveProjectId(project.id);
      }
    });
    const id = await createAndBindProjectMainSession(project, activeSessionIdLatestRef.current, {
      carryDraft: true,
    });
    if (id) {
      jumpToSessionWithRepository(id);
    }
  }

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
      void openRepositoryMainSession(repository, { enterChat: false });
    },
    [repositories, setActiveRepositoryId, setActiveRepositoryWithOwner],
  );

  const startupFirstProjectRepoSessionAppliedRef = useRef(false);

  const sidebarSelectionEpochRef = useRef(0);

  /**
   * 多屏下侧栏/顶栏选仓库/工作区时，把选择路由到当前聚焦 pane（Pane 0 暂 fall back 到全局，
   * 待 Pane 0 per-pane 槽落地后再切到 primaryPaneActiveContext）。
   *
   * 与 [[multipane-setactiverepo-pollution]] 记录的 `openRepositoryFileByEvent` 护栏同形：
   * 单屏维持"切全局"原行为；多屏下"切换全局活动仓库/工作区"会污染左栏选中态、文件树、
   * 其他屏的左栏基线视图，所以改成"路由到当前活动 pane"。
   *
   * @returns true 表示已路由到 per-pane（写入器应跳过全局 setActiveXxxId），
   *          false 表示未路由（fall through，由调用方按单屏语义写全局）。
   */
  const tryRouteSidebarSelectionToFocusedPane = useCallback(
    (kind: "repository" | "project", id: number | string): boolean => {
      const target = resolveFocusedPaneTargetSlot(
        paneCountRef.current,
        getActivePaneIndex(),
        extraPanes,
      );
      if (target.kind === "extra") {
        if (kind === "repository") {
          void handlePaneRepositorySelect(target.slotIndex, Number(id));
        } else {
          void handlePaneProjectNewSession(target.slotIndex, String(id), projects);
        }
        return true;
      }
      // kind === "none" 或 "primary"：调用方按单屏语义或 Pane 0 fallback 写全局。
      return false;
    },
    [extraPanes, handlePaneProjectNewSession, handlePaneRepositorySelect, projects],
  );

  /**
   * 顶栏 / ClaudeSessionsChatHost.handleSwitchToSession 的"切到新仓库"副作用包装：
   * 多屏下路由到当前聚焦 pane；单屏维持原行为（写全局 activeRepositoryId）。
   * 与 tryRouteSidebarSelectionToFocusedPane 的差别：本函数对单屏始终 fall through 到
   * `setActiveRepositoryId`，而 helper 在单屏时早退 —— 这是为了让 ChatHost 内的
   * `handleSwitchToSession` 在 paneCount>1 时不再把全局 active 仓库跟 pane 会话强行对齐。
   */
  const handlePickedActiveRepositoryForCurrentPane = useCallback(
    (repositoryId: number) => {
      if (paneCountRef.current === 1) {
        setActiveRepositoryId(repositoryId);
        return;
      }
      tryRouteSidebarSelectionToFocusedPane("repository", repositoryId);
    },
    [setActiveRepositoryId, tryRouteSidebarSelectionToFocusedPane],
  );

  const handleSidebarRepositorySelectLeavingMcpHub = useCallback(
    (repositoryId: number | null) => {
      if (repositoryId == null) {
        startTransition(() => {
          if (viewMode.isCockpit || viewMode.isAuthor || viewMode.isInspect) {
            viewMode.back();
          }
        });
        handleSidebarRepositorySelect(repositoryId);
        return;
      }
      const repository = repositories.find((item) => item.id === repositoryId);
      if (!repository) {
        return;
      }
      prefetchGitStatus(repository.path);
      const leavingOverlay = viewMode.isCockpit || viewMode.isAuthor || viewMode.isInspect;
      // 多屏下把选择路由到当前聚焦 pane（避免污染全局 active 仓库/工作区）。
      // tryRouteSidebarSelectionToFocusedPane 在路由成功时返回 true；此时跳过 setActiveXxxId、
      // viewMode 切换、ensureRepositoryMainSession 这一系列围绕"全局活动仓库"的副作用，
      // 由 handlePaneRepositorySelect 内部独立建 pane 会话。
      if (!leavingOverlay && tryRouteSidebarSelectionToFocusedPane("repository", repositoryId)) {
        return;
      }
      // 选工作区时会把 activeRepositoryId 设为首个成员仓且 focus=project；点同一仓仍需切到 repository 焦点。
      if (
        !leavingOverlay &&
        viewMode.isChat &&
        activeRepositoryId === repositoryId &&
        activeWorkspaceFocus !== "project"
      ) {
        return;
      }
      const selectionEpoch = ++sidebarSelectionEpochRef.current;
      // 旧实现使用 flushSync 同步提交 active id，会强制重渲染整棵 AppImpl
      // (LeftSidebar + ChatHost 等)，造成点击瞬间的明显卡顿。
      // ensureRepositoryMainSession 通过参数拿 repository，不读 active id state，
      // 因此可以走默认批量更新；viewMode 切换继续走 transition。
      setActiveRepositoryWithOwner(repository.id);
      if (leavingOverlay) {
        startTransition(() => viewMode.back());
      } else if (!viewMode.isChat) {
        startTransition(() => {
          viewMode.enter({ kind: "chat" });
        });
      }
      if (sidebarSelectionEpochRef.current !== selectionEpoch) {
        return;
      }
      // 多仓工作区内点成员仓：只更新高亮/文件树；有展示会话则切换，禁止 ensure 新建空壳，
      // 否则切走时内存回收会清空原文，切回看到的是无 claudeSessionId 的空标签。
      if (shouldSidebarRepositorySelectOnlyUpdateFocus(repository, projects)) {
        switchRepositoryDisplaySession(repository);
        return;
      }
      scheduleSidebarMainSessionEnsure(() => ensureRepositoryMainSession(repository));
    },
    [
      activeRepositoryId,
      activeWorkspaceFocus,
      handleSidebarRepositorySelect,
      projects,
      repositories,
      setActiveRepositoryWithOwner,
      tryRouteSidebarSelectionToFocusedPane,
      viewMode,
    ],
  );

  const bindProjectMainSessionTarget = useCallback(
    (project: ProjectItem): string | null => {
      const sessionsNow = sessionsLatestRef.current;
      const anchor = resolveProjectMainSessionAnchor(project, repositories);
      if (!anchor.path) {
        message.warning("该 Workspace 缺少根目录，请先配置 rootPath");
        return null;
      }
      const projectBindingKey = projectMainSessionBindingKey(project.id);
      const boundId = resolveBoundMainSessionId(
        projectBindingKey,
        repositoryMainSessionBindings,
        sessionsNow,
        null,
      );
      if (boundId) {
        switchSessionIfNeeded(boundId);
        return boundId;
      }
      const latestForProject = pickProjectMainSessionForSidebarSelect(
        sessionsNow,
        anchor.path,
        sessionOwnerHintsRef.current,
      );
      if (latestForProject) {
        switchSessionIfNeeded(latestForProject.id);
        void bindRepositoryMainSession(projectBindingKey, latestForProject.id);
        return latestForProject.id;
      }
      return null;
    },
    [repositories, repositoryMainSessionBindings, sessionsStructureKey, switchSessionIfNeeded],
  );

  /**
   * 进入应用：仓库与会话 hydrated 后恢复侧栏选中态对应的主会话。
   * - 工作区焦点 → 项目主会话（不要求 activeRepositoryId）
   * - 仓库焦点 → 仓库主会话（含多仓工作区内的 per-repo 路径）
   */
  useEffect(() => {
    if (repositoryListLoading || !tabsHydrated) return;
    if (startupFirstProjectRepoSessionAppliedRef.current) return;

    if (activeWorkspaceFocus === "project" && activeProjectId) {
      const startupProject = projects.find((p) => p.id === activeProjectId) ?? null;
      if (!startupProject) return;
      startupFirstProjectRepoSessionAppliedRef.current = true;
      void ensureProjectMainSession(startupProject);
      if (!viewMode.isChat) {
        viewMode.enter({ kind: "chat" });
      }
      return;
    }

    if (activeRepositoryId == null) return;
    if (!repositories.some((r) => r.id === activeRepositoryId)) return;
    startupFirstProjectRepoSessionAppliedRef.current = true;
    const startupRepo = repositories.find((r) => r.id === activeRepositoryId) ?? null;
    const ownerProject = startupRepo
      ? findOwnerProjectForRepositoryId(startupRepo.id, projects)
      : null;
    if (startupRepo && isMultiRepoProject(ownerProject, projects) && ownerProject) {
      setActiveRepositoryWithOwner(startupRepo.id);
      void ensureProjectMainSession(ownerProject);
    } else if (startupRepo) {
      void ensureRepositoryMainSession(startupRepo);
    }
    // P1: Standalone Repo 启动时自动进 chat（宪法 §6：Standalone Repo 不进 cockpit）
    if (!ownerProject) {
      viewMode.enter({ kind: "chat" });
    }
  }, [
    activeProjectId,
    activeRepositoryId,
    activeWorkspaceFocus,
    projects,
    repositories,
    repositoryListLoading,
    setActiveRepositoryWithOwner,
    tabsHydrated,
    viewMode,
  ]);

  const handleProjectSelectLeavingMcpHub = useCallback(
    (projectId: string) => {
      if (suppressProjectSelectToChatRef.current) {
        return;
      }
      const project = projects.find((p) => p.id === projectId) ?? null;
      if (!project) {
        // Fallback：找不到匹配 project 时，让 React 按默认批量调度即可，
        // 不需要 flushSync 同步阻塞点击线程。
        setActiveProjectId(projectId);
        return;
      }
      const leavingOverlay = viewMode.isAuthor || viewMode.isInspect || viewMode.isCockpit;
      // 多屏下把选择路由到当前聚焦 pane（避免污染全局 active 工作区）。
      if (!leavingOverlay && tryRouteSidebarSelectionToFocusedPane("project", projectId)) {
        return;
      }
      if (
        !leavingOverlay &&
        viewMode.isChat &&
        activeProjectId === projectId &&
        activeWorkspaceFocus === "project"
      ) {
        return;
      }
      const selectionEpoch = ++sidebarSelectionEpochRef.current;
      // 旧实现使用 flushSync 同步提交 active id 与 setAuthorTrellisProjectId，
      // 会强制重渲染整棵 AppImpl (LeftSidebar + ChatHost 等)，造成点击瞬间的明显卡顿。
      // ensureProjectMainSession 通过参数拿 project，不读 active id state，
      // 因此可以走默认批量更新；viewMode 切换继续走 transition。
      setActiveProjectId(projectId);
      if (leavingOverlay) {
        startTransition(() => viewMode.back());
      } else if (!viewMode.isChat) {
        startTransition(() => {
          viewMode.enter({ kind: "chat" });
        });
      }
      if (sidebarSelectionEpochRef.current !== selectionEpoch) {
        return;
      }
      scheduleSidebarMainSessionEnsure(() => ensureProjectMainSession(project));
    },
    [
      activeProjectId,
      activeWorkspaceFocus,
      projects,
      setActiveProjectId,
      tryRouteSidebarSelectionToFocusedPane,
      viewMode,
    ],
  );

  const jumpToSessionLeavingMcpHub = useCallback(
    (sessionId: string) => {
      // 跳转到具体会话 → 进 chat 子模式
      viewMode.enter({ kind: "chat" });
      jumpToSessionWithRepository(sessionId);
    },
    [jumpToSessionWithRepository, viewMode],
  );

  async function handleCreateRepositoryTask(repository: Repository, mode: TaskMode) {
    if (mode === "chat") {
      const ownerProject = findOwnerProjectForRepositoryId(repository.id, projects);
      if (isMultiRepoProject(ownerProject, projects) && ownerProject) {
        await openProjectMainSession(ownerProject);
        setActiveRepositoryWithOwner(repository.id);
        return;
      }
      await openRepositoryMainSession(repository, { enterChat: true });
      return;
    }
    if (mode === "split") {
      openRepositoryRequirements(repository);
      return;
    }
    setActiveRepositoryWithOwner(repository.id);
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

  const openWorkspaceRequirements = useCallback(
    (project: ProjectItem) => {
      setActiveProjectId(project.id);
      openRequirementAssistant({
        projectId: project.id,
        requirementScope: "workspace",
      });
    },
    [openRequirementAssistant, setActiveProjectId],
  );

  const openRepositoryRequirements = useCallback(
    (repository: Repository) => {
      setActiveRepositoryWithOwner(repository.id);
      openRequirementAssistant({
        repositoryId: repository.id,
        requirementScope: "repository",
      });
    },
    [openRequirementAssistant, setActiveRepositoryWithOwner],
  );

  async function handleCreateProjectTask(project: ProjectItem, mode: TaskMode) {
    if (mode === "split") {
      openWorkspaceRequirements(project);
      return;
    }

    const byId = new Map(repositories.map((repo) => [repo.id, repo]));
    const repos = project.repositoryIds
      .map((id) => byId.get(id))
      .filter((repo): repo is Repository => Boolean(repo));
    if (repos.length === 0) {
      message.warning("该 Workspace 下暂无仓库，请先关联仓库");
      return;
    }
    const anchor = resolveProjectMainSessionAnchor(project, repositories);
    if (!anchor.path) {
      message.warning("该 Workspace 缺少根目录，请先在 Author / Workspaces 中配置 rootPath");
      return;
    }
    const primaryRepo = repos[0];
    setActiveProjectId(project.id);
    setActiveRepositoryId(primaryRepo.id);
    if (mode === "chat") {
      await openProjectMainSession(project);
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

  async function openProjectMainSession(project: ProjectItem): Promise<string | null> {
    const byId = new Map(repositories.map((repo) => [repo.id, repo]));
    const repos = project.repositoryIds
      .map((id) => byId.get(id))
      .filter((repo): repo is Repository => Boolean(repo));
    const anchor = resolveProjectMainSessionAnchor(project, repositories);
    if (!anchor.path) {
      message.warning("该 Workspace 缺少根目录，请先配置 rootPath");
      return null;
    }
    const isStandaloneTrellisProject = project.id.startsWith("repo:");
    if (repos[0]) {
      if (isStandaloneTrellisProject) {
        setActiveRepositoryWithOwner(repos[0].id);
      } else {
        setActiveProjectId(project.id);
        setActiveRepositoryId(repos[0].id);
      }
    } else if (!isStandaloneTrellisProject) {
      setActiveProjectId(project.id);
    }
    startTransition(() => {
      viewMode.enter({ kind: "chat" });
    });

    return ensureProjectMainSession(project);
  }

  function handleOpenInFinder(repository: Repository) {
    openInFinder(repository.path).catch((err) => {
      console.error("Failed to open in finder:", err);
    });
  }

  const handleOpenProjectInFinder = useCallback(
    (project: ProjectItem) => {
      const path = resolveWorkspaceRootPath({
        scope: "project",
        project,
        repositories,
        projects,
      });
      if (!path) {
        message.warning("无法解析工作区目录，请先配置工作区根目录或关联仓库");
        return;
      }
      openInFinder(path).catch((err) => {
        console.error("Failed to open project directory in finder:", err);
        message.error("打开目录失败");
      });
    },
    [message, projects, repositories],
  );

  const openPathInDefaultTerminal = useCallback(
    async (path: string | null | undefined, emptyMessage: string) => {
      const trimmed = path?.trim() ?? "";
      if (!trimmed) {
        message.warning(emptyMessage);
        return;
      }
      const result = await tryOpenWorkspaceInDefaultTerminal(trimmed);
      if (!result.ok) {
        message.warning(result.message);
        return;
      }
    },
    [message],
  );

  const handleOpenInTerminal = useCallback(
    (repository: Repository) => {
      void openPathInDefaultTerminal(repository.path, "仓库路径为空");
    },
    [openPathInDefaultTerminal],
  );

  const handleOpenProjectInTerminal = useCallback(
    (project: ProjectItem) => {
      const path = resolveWorkspaceRootPath({
        scope: "project",
        project,
        repositories,
        projects,
      });
      void openPathInDefaultTerminal(
        path,
        "无法解析工作区目录，请先配置工作区根目录或关联仓库",
      );
    },
    [openPathInDefaultTerminal, projects, repositories],
  );

  function handleOpenRepositoryInBrowser(repository: Repository) {
    void openRepositoryRemoteInBrowser(repository.path)
      .then((result) => {
        if (!result.ok) {
          message.warning(result.message);
        }
      })
      .catch((err) => {
        message.error(err instanceof Error ? err.message : String(err));
      });
  }

  async function refreshWorkflowTemplates() {
    const templates = await listWorkflowTemplates();
    setWorkflowTemplates(templates);
  }

  const openFilenameSearchPalette = useCallback(
    (scopeDir?: string, repositoryPathOverride?: string) => {
      setSearchMode("filename");
      setSearchInitialScopeDir(scopeDir);
      setSearchRepositoryPathOverride(repositoryPathOverride);
      setSearchOpen(true);
    },
    [],
  );
  /** 多屏 per-pane 搜索按钮：作用于指定 pane 仓库（整个仓库，scopeDir=undefined），仓库路径作为 override。 */
  const openFilenameSearchPaletteForRepository = useCallback(
    (repositoryPath: string) => {
      const trimmed = repositoryPath.trim();
      openFilenameSearchPalette(undefined, trimmed || undefined);
    },
    [openFilenameSearchPalette],
  );

  const openContentSearchPalette = useCallback((scopeDir?: string) => {
    setSearchMode("content");
    setSearchInitialScopeDir(scopeDir);
    setSearchOpen(true);
  }, []);

  useEffect(() => {
    let unlistenFilename: (() => void) | undefined;
    let unlistenContent: (() => void) | undefined;
    void listen("global-open-filename-search", (event) => {
      // 后端通过 Focused 守卫控制是否 emit，但 Tauri 的 emit 会广播到所有 webview；
      // 多主窗口并存时必须再叠加「本 webview 拥有系统焦点」的兜底，让非聚焦窗口静默忽略。
      // 与 handleGlobalKey 的 Cmd/Ctrl+K 行为对齐。
      if (!isWiseAppFocused()) return;
      const scopeDir = (event.payload as { scopeDir?: string } | undefined)?.scopeDir;
      // Ctrl+F 打开 Wise 文件名搜索（macOS 也用 Control 而非 Cmd）：
      // ⌘F 留给 Monaco 编辑器自身的内查找；带目录范围（文件树右键"在此搜索"）
      // 则限定搜索范围，否则全局搜索。
      openFilenameSearchPalette(scopeDir);
    })
      .then((fn) => {
        unlistenFilename = fn;
      })
      .catch(() => undefined);
    void listen("global-open-content-search", (event) => {
      // 同上：多窗口下仅当前聚焦窗口响应内容搜索（与文件搜索对称）。
      if (!isWiseAppFocused()) return;
      const scopeDir = (event.payload as { scopeDir?: string } | undefined)?.scopeDir;
      openContentSearchPalette(scopeDir);
    })
      .then((fn) => {
        unlistenContent = fn;
      })
      .catch(() => undefined);
    return () => {
      void safeUnlisten(unlistenFilename);
      void safeUnlisten(unlistenContent);
    };
  }, [openFilenameSearchPalette, openContentSearchPalette]);

  /** ⌘N / Ctrl+N：新建会话 */
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("global-create-new-session", () => {
      // 多窗口下：仅当前聚焦窗口触发新建会话，避免另一窗口被动弹窗/创建。
      if (!isWiseAppFocused()) return;
      const repoId = activeRepositoryIdLatestRef.current;
      if (repoId == null) {
        message.warning("请先选择一个仓库");
        return;
      }
      const repo = repositoriesLatestRef.current.find((item) => item.id === repoId);
      if (!repo) {
        message.warning("当前仓库不可用");
        return;
      }
      void handleManualNewRepositorySession(repo);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      void safeUnlisten(unlisten);
    };
  }, []);

  useEffect(() => {
    initGlobalAtMentionShortcutRouting();
    let cancelled = false;
    void loadAtMentionShortcutByTargetFromStore().then((bindings) => {
      if (!cancelled) void registerAtMentionGlobalShortcuts(bindings).catch(() => {});
    });
    const onAtMentionShortcutsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ atMentionShortcutByTarget: Record<string, string> }>).detail;
      if (!detail?.atMentionShortcutByTarget) return;
      void registerAtMentionGlobalShortcuts(detail.atMentionShortcutByTarget).catch(() => {});
    };
    window.addEventListener(WISE_AT_MENTION_SHORTCUTS_CHANGED, onAtMentionShortcutsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_AT_MENTION_SHORTCUTS_CHANGED, onAtMentionShortcutsChanged);
    };
  }, []);

  useEffect(() => {
    function handleGlobalKey(e: KeyboardEvent) {
      if (!isWiseAppFocused()) return;
      const mod = e.metaKey || e.ctrlKey;
      // Escape：若有看门狗标记的卡住操作，优先解除 UI 阻塞（遮罩/确认旋钮），再走默认行为。
      if (!mod && !e.shiftKey && !e.altKey && e.key === "Escape") {
        if (getStuckOperationsSnapshot().length > 0) {
          e.preventDefault();
          dismissStuckOperations();
          message.warning("已尝试解除卡住的操作遮罩，可继续使用；后台任务可能仍在执行");
          return;
        }
      }
      // Control+`（物理 Backquote）：切换终端面板；仅用 Ctrl、不含 ⌘，与 macOS Control 一致
      if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && (e.code === "Backquote" || e.key === "`")) {
        e.preventDefault();
        handleToggleTerminal();
        return;
      }
      // ⌘F / Ctrl+F 与 ⌘⇧F / Ctrl+Shift+F：桌面版由主窗口聚焦时注册的 Tauri 快捷键派发事件
      if (mod && e.key === "k") {
        e.preventDefault();
        setSearchMode("filename");
        setSearchOpen((prev) => !prev);
        return;
      }
      if (mod && e.shiftKey && (e.code === "KeyM" || e.key === "m" || e.key === "M")) {
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
  }, [handleToggleTerminal]);

  useEffect(() => {
    function handleOpenAssistantEvent(event: Event) {
      const detail = (event as CustomEvent<OpenAssistantDetail>).detail ?? {};
      if (typeof detail.assistantId === "string" && detail.assistantId.trim()) {
        openBuiltinAssistant(detail.assistantId);
        return;
      }
      openRequirementAssistant(detail);
    }
    window.addEventListener(WORKFLOW_UI_EVENT_OPEN_ASSISTANT, handleOpenAssistantEvent as EventListener);
    return () => {
      window.removeEventListener(WORKFLOW_UI_EVENT_OPEN_ASSISTANT, handleOpenAssistantEvent as EventListener);
    };
  }, [openBuiltinAssistant, openRequirementAssistant]);

  useEffect(() => {
    let cancelled = false;
    function handleWorkflowConfigEvent(event: Event) {
      const detail = (event as CustomEvent<OpenWorkflowConfigDetail>).detail;
      const workflowId = detail?.workflowId?.trim() ?? "";
      const projectId = detail?.projectId?.trim() ?? "";
      setWorkflowConfigPrdProjectId(projectId || null);
      setWorkflowConfigInitialWorkflowId(workflowId || null);
      enterAuthorPane("workflows");
    }
    function handleWorkflowGraphChanged(event: Event) {
      const detail = (event as CustomEvent<WorkflowGraphChangedDetail>).detail;
      const workflowId = detail?.workflowId?.trim();
      if (!workflowId) return;
      void (async () => {
        try {
          const [templates, graphItem] = await Promise.all([
            listWorkflowTemplates(),
            getWorkflowGraph({ workflowId }),
          ]);
          if (cancelled) return;
          setWorkflowTemplates(templates);
          if (graphItem?.graph) {
            setWorkflowGraphsByWorkflowId((prev) => ({ ...prev, [workflowId]: graphItem.graph }));
            setWorkflowGraphStatusByWorkflowId((prev) => ({
              ...prev,
              [workflowId]: graphItem.status,
            }));
          }
        } catch (error) {
          console.error("Failed to refresh workflow graph after external change:", error);
        }
      })();
    }
    function handleOpenRepositoryFileEvent(event: Event) {
      const detail = (event as CustomEvent<OpenRepositoryFileDetail>).detail;
      if (!detail) return;
      openRepositoryFileByEvent(detail);
    }
    window.addEventListener(WORKFLOW_UI_EVENT_OPEN_WORKFLOW_CONFIG, handleWorkflowConfigEvent as EventListener);
    window.addEventListener(WORKFLOW_UI_EVENT_WORKFLOW_GRAPH_CHANGED, handleWorkflowGraphChanged as EventListener);
    window.addEventListener(WORKFLOW_UI_EVENT_OPEN_REPOSITORY_FILE, handleOpenRepositoryFileEvent as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener(WORKFLOW_UI_EVENT_OPEN_WORKFLOW_CONFIG, handleWorkflowConfigEvent as EventListener);
      window.removeEventListener(WORKFLOW_UI_EVENT_WORKFLOW_GRAPH_CHANGED, handleWorkflowGraphChanged as EventListener);
      window.removeEventListener(WORKFLOW_UI_EVENT_OPEN_REPOSITORY_FILE, handleOpenRepositoryFileEvent as EventListener);
    };
  }, [enterAuthorPane, openRepositoryFileByEvent]);

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
        commitWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [updatedTask.id]: events }));
        setTaskPendingEmployeesByTaskId((prev) => ({ ...prev, [updatedTask.id]: pendingEmployees }));
      })
      .catch((error) => {
        console.error("Failed to end employee workflow task:", error);
        message.error("结束员工任务失败");
      });
  };

  const workspaceWelcomeFullscreen =
    !repositoryListLoading &&
    projects.length === 0 &&
    repositories.length === 0 &&
    viewMode.view.kind === "chat";

  const onConsumeRepositoryFileOpenRequest = useCallback(() => {
    setRepositoryFileOpenRequest(null);
  }, []);

  const onOpenRemoteChannels = useCallback(() => {
    enterAuthorPane("channels");
  }, [enterAuthorPane]);

  return (
    <>
    <Suspense
      fallback={<AppWorkspaceLayoutShell />}
    >
    <LazyAppWorkspaceLayout
      dark={dark}
      collapsed={collapsed}
      viewMode={viewMode.view}
      onCloseCockpitAutomationHub={viewMode.back}
      onCloseCockpit={exitCockpit}
      effectiveRightCollapsed={effectiveRightCollapsed}
      mainLayoutContentRef={mainLayoutContentRef}
      mainLayoutLeftWidthPx={mainLayoutLeftWidthPx}
      mainLayoutRightWidthPx={mainLayoutRightWidthPx}
      repositoryFileOpenRequest={repositoryFileOpenRequest}
      onConsumeRepositoryFileOpenRequest={onConsumeRepositoryFileOpenRequest}
      onLeftWidthChange={setMainLayoutLeftWidthPx}
      onRightWidthChange={setMainLayoutRightWidthPx}
      onOpenRemoteChannels={onOpenRemoteChannels}
      activeRepositoryPath={fileEditorRootPath}
      leftSidebarProps={{
        projects,
        activeProjectId,
        activeWorkspaceFocus,
        repositories,
        activeRepositoryId,
        onOpenAuthor: (pane?: AuthorPane) => {
          enterAuthorPane(pane ?? lastAuthorPane);
        },
        leftSidebarHubQuickEntryIds: leftSidebarHubQuickEntries.enabledEntryIds,
        showLeftSidebarMonitorPanel: showMonitorOnLeft,
        showLeftSidebarWorkspaceList,
        showRepositoryIconBadgesInWorkspaceList,
        mcpHubActive:
          viewMode.view.kind === "inspect" && viewMode.view.tool.kind === "mcp-hub",
        onOpenMcpHub: openMcpHubFromSidebar,
        skillsHubActive:
          viewMode.view.kind === "inspect" && viewMode.view.tool.kind === "skills-hub",
        onOpenSkillsHub: openSkillsHubFromSidebar,
        automationHubActive: viewMode.view.kind === "cockpit" && viewMode.view.hubPane === "automation",
        onOpenAutomationHub: openAutomationHubFromSidebar,
        assistantsHubActive: viewMode.view.kind === "author" && viewMode.view.pane === "assistants",
        onOpenAssistantsHub: openAssistantsFromSidebar,
        claudePluginsHubActive: viewMode.view.kind === "author" && viewMode.view.pane === "claude-plugins",
        onOpenClaudePluginsHub: openClaudePluginsFromSidebar,
        workspaceCreateRequest,
        standaloneRepoAddRequest,
        onProjectSelect: handleProjectSelectLeavingMcpHub,
        onCreateProject: handleCreateProject,
        onUpdateProject: handleUpdateProject,
        onDeleteProject: handleDeleteProject,
        pinnedProjectIds,
        onTogglePinProject: togglePinProject,
        onAddFloatingRepository: handleAddFloatingRepository,
        onAddRepositoryToProject: handleAddRepositoryToProject,
        onReconcileProject: async (projectId, mode: ReconcileProjectMode) => {
          try {
            await handleReconcileProjectWorkspace(projectId, mode);
          } catch (e) {
            message.error(e instanceof Error ? e.message : String(e));
          }
        },
        onPromoteFloatingRepositoryToProject: handlePromoteFloatingRepositoryToProject,
        floatingRepositories,
        onRemoveRepository: handleRemoveRepositoryWithSessionCleanup,
        onDetachRepositoryFromProject: handleDetachRepositoryFromProjectWithSessionCleanup,
        onUpdateRepositorySddMode: handleUpdateRepositorySddMode,
        onUpdateRepositoryIconBadge: handleUpdateRepositoryIconBadge,
        onUpdateProjectSddMode: async (projectId, sddMode) => {
          await handleUpdateProjectSddMode(projectId, sddMode);
        },
        onUpdateRepositoryOpenAppId: handleUpdateRepositoryOpenAppId,
        onUpdateProjectOpenAppId: handleUpdateProjectOpenAppId,
        onNewPaneSessionForRepository: handleNewPaneSessionForRepository,
        onNewPaneSessionForProject: handleNewPaneSessionForProject,
        onReorderRepositoriesInProject: handleReorderRepositoriesInProject,
        onRepositorySelect: handleSidebarRepositorySelectLeavingMcpHub,
        onOpenInFinder: handleOpenInFinder,
        onOpenProjectInFinder: handleOpenProjectInFinder,
        onOpenInTerminal: handleOpenInTerminal,
        onOpenProjectInTerminal: handleOpenProjectInTerminal,
        onOpenRepositoryInBrowser: handleOpenRepositoryInBrowser,
        onOpenScheduledTasksForRepository: openScheduledTasksForRepository,
        onCreateProjectTask: handleCreateProjectTask,
        onCreateRepositoryTask: handleCreateRepositoryTask,
        onOpenWorkspaceRequirements: openWorkspaceRequirements,
        onOpenRepositoryRequirements: openRepositoryRequirements,
        onOpenRepositoryMainOwner: (repository) => {
          void openEmployeeConfigForRepositoryOwner(repository);
        },
        onConfigureRepositoryMainSessionRun: openRepositoryRunCommandConfigure,
        onStartRepositoryRunCommand: handleStartRepositoryRunCommand,
        onStopRepositoryRunCommand: handleStopRepositoryRunCommand,
        sessions,
        sessionsStructureKey,
        sessionsLiveRef: sessionsLatestRef,
        monitorPanelSessions: monitorPanelSessionsMerged,
        repositoryMainSessionBindings,
        activeSessionId,
        onSelectSession: jumpToSessionLeavingMcpHub,
        sessionConversationTaskItems,
        onStopSessionConversationTask: handleStopSessionConversationTask,
        executionEnvironmentDispatchHistoryDays: executionEnvironmentDispatchHistory.days,
        onExecutionEnvironmentDispatchHistoryDaysChange: executionEnvironmentDispatchHistory.applyDays,
        executionEnvironmentDispatchHistoryDaysSaving: false,
        projectId: activeProjectId,
        employeeMonitorItems: teamPanelEmployeeMonitorItems,
        repositoryMemberMonitorItems: scopedRepositoryMemberMonitorItems,
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
              commitWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [updatedTask.id]: events }));
              setTaskPendingEmployeesByTaskId((prev) => ({ ...prev, [updatedTask.id]: pendingEmployees }));
            })
            .catch((error) => {
              console.error("Failed to end team workflow task:", error);
              message.error("结束团队任务失败");
            });
        },
        onOpenOmcBatchInvocationDetail: handleOpenOmcBatchInvocationDetail,
        onCancelOmcDirectBatchInvocation: handleCancelOmcDirectBatchInvocation,
        onCompactSessionHistory: compactSessionHistory,
        hideEmployeeUi: shouldHideEmployeeUi(activeProject),
        historyDrawerSessionId: inspectorHistorySessionId,
        onHistoryDrawerSessionIdChange: setInspectorHistorySessionId,
        onRestoreHistorySessionAsMain: handleRestoreHistorySessionAsMain,
        onCreateTerminalEmployeeSession: handleCreateTerminalEmployeeSession,
        onResumeSession: resumeSessionFromMonitorDrawer,
        onPrepareSessionForMonitorDrawer: ensureSessionForMonitorDrawer,
        onRespondToQuestion: respondToQuestion,
        onDismissQuestion: dismissQuestion,
        onRespondToPermission: respondToPermission,
        onToggleTodo: toggleTodo,
        onSendFollowup: sendFollowup,
        onRestoreRevert: restoreRevert,
        onClearFollowups: clearFollowups,
        onClearRevertItems: clearRevertItems,
        employees,
        employeeTaskCounts,
        workflowTemplates,
        workflowGraphsByWorkflowId,
        onMoveEmployee: async (employeeId, direction) => {
          await moveEmployeeDisplayOrder({ employeeId, direction });
          await refreshEmployeeData();
        },
        onCancelSessionFromMonitor: cancelSession,
        onOpenTaskDetailFromMonitor: (taskId) => {
          setMonitorDrawerTarget({ type: "task", taskId });
        },
        onReloadFullDiskTranscript: reloadFullDiskTranscript,
        onRefreshHistorySessions: handleRefreshHistorySessions,
        onLoadMoreTranscriptFromDisk: loadMoreTranscriptFromDisk,
        activeRepositoryPath: activeRepository?.path,
        activeRepositoryName: activeRepository?.name,
        gitPanelPlacement: repoPanelPlacementDefault.gitPanelPlacement,
        filesPanelPlacement: repoPanelPlacementDefault.filesPanelPlacement,
        repoPanelSplitMode: repoPanelPlacementDefault.repoPanelSplitMode,
      }}
      authorPanelProps={{
        pane: authorPane,
        onPaneChange: handleAuthorPaneChange,
        onBack: viewMode.back,
        workspacesTabProps: {
          workspaces: projects,
          repositories,
          standaloneRepos,
          activeWorkspaceId: activeProjectId,
          activeRepositoryId,
          onCreateWorkspace: () => {
            setWorkspaceCreateRequest((value) => value + 1);
          },
          onAddStandaloneRepo: () => {
            setStandaloneRepoAddRequest((value) => value + 1);
          },
          onSelectWorkspace: handleProjectSelectLeavingMcpHub,
          onSelectStandaloneRepo: (repositoryId) => handleSidebarRepositorySelectLeavingMcpHub(repositoryId),
        },
        employeeConfigProps: {
          open: true,
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
          onClose: viewMode.back,
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
                executionEngine: input.executionEngine,
                defaultInstruction: input.defaultInstruction,
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
        },
        workflowConfigProps: {
          open: true,
          loading: workflowLoading,
          employees,
          repositoryPath: workflowModalRepositoryPath,
          templates: workflowTemplates,
          projects,
          workflowProjectIds: workflowProjectIdsMap,
          selectableEmployeeIds: selectableWorkflowEmployeeIds,
          onClose: viewMode.back,
          onSaveTemplate: async (input) => {
            setWorkflowLoading(true);
            try {
              const savedTemplate = await saveWorkflowTemplate(input);
              await refreshWorkflowTemplates();
              const linkPid = workflowConfigPrdProjectId?.trim() ?? "";
              if (linkPid) {
                try {
                  await addProjectPrdWorkflow(linkPid, savedTemplate.id);
                } catch (err) {
                  message.error(`模板已保存，但关联到 Workspace 失败：${toUiErrorMessage(err)}`);
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
              setWorkflowGraphsByWorkflowId((prev) => {
                if (!(workflowId in prev)) return prev;
                const next = { ...prev };
                delete next[workflowId];
                return next;
              });
              setWorkflowGraphStatusByWorkflowId((prev) => {
                if (!(workflowId in prev)) return prev;
                const next = { ...prev };
                delete next[workflowId];
                return next;
              });
              setMonitorDrawerTarget((prev) =>
                prev?.type === "team" && prev.workflowId === workflowId ? null : prev,
              );
            } catch (error) {
              const messageText = toUiErrorMessage(error);
              message.error(`删除团队失败：${messageText}`);
            } finally {
              setWorkflowLoading(false);
            }
          },
          initialWorkflowId: workflowConfigInitialWorkflowId,
        },
        mcpHubProps: {
          repositoryPath: authorPanelRepositoryPath,
        },
        skillsHubProps: {
          repositoryPath: authorPanelRepositoryPath,
        },
        assistantsPanelProps: {
          activeProjectId: activeProjectId ?? null,
          activeProjectName: activeProject?.name ?? null,
          activeRepositoryPath:
            activeRepositoryId != null
              ? repositories.find((item) => item.id === activeRepositoryId)?.path ?? null
              : null,
          workflowTemplates,
          onActivateAssistant: activateAssistant,
        },
        automationPanelProps: {
          repositories,
          activeRepositoryId,
          employees,
          workflowTemplates,
          workflowGraphsByWorkflowId,
        },
        artifactsPanelProps: {
          repositories,
          activeRepositoryId,
          onOpenRepositoryFile: (repository, relativePath) => {
            openRepositoryFileByEvent({
              repositoryId: repository.id,
              repositoryPath: repository.path,
              relativePath,
              line: null,
            });
          },
        },
        repositoryPath: activeRepository?.path ?? null,
        workflowStudioAction: undefined,
      }}
      sessionsStructureKey={sessionsStructureKey}
      claudeSessionsProps={{
        sessions,
        activeSessionId,
        onReloadFullDiskTranscript: reloadFullDiskTranscript,
        onLoadMoreTranscriptFromDisk: loadMoreTranscriptFromDisk,
        onCompactSessionHistory: compactSessionHistory,
        omcBatchPipelineActive: Boolean(omcBatchRuntime?.active),
        activeRepository: activeRepository ?? undefined,
        repositories,
        activeRepositoryId,
        workspaceMode,
        activeProject,
        projects,
        activeWorkspaceFocus,
        onSelectRepository: handlePickedActiveRepositoryForCurrentPane,
        onUpdateSessionModel: updateSessionModel,
        onUpdateSessionConnectionKind: updateSessionConnectionKind,
        onUpdateSessionUltracode: updateSessionUltracodeOverride,
        onUpdateRepositoryExecutionEngine: handleUpdateRepositoryExecutionEngine,
        onUpdateEmployeeExecutionEngine: handleUpdateEmployeeExecutionEngine,
        codexAvailable,
        cursorAvailable,
        geminiAvailable,
        opencodeAvailable,
        qoderAvailable,
        onOpenExecutionEnvironment: handleOpenExecutionEnvironment,
        onExecuteSession: handleComposerExecute,
        onResumeSessionFromMonitorDrawer: resumeSessionFromMonitorDrawer,
        onPrepareSessionForMonitorDrawer: ensureSessionForMonitorDrawer,
        onDispatchExecutionEnvironment: handleDispatchExecutionEnvironment,
        onDispatchSessionFeedbackLoop: handleDispatchSessionFeedbackLoop,
        onSendMessage: handleSendMessageWithAtMention,
        onCancelSession: cancelSession,
        onCloseSession: handleCloseSession,
        onSwitchSession: jumpToSessionWithRepository,
        onNewSession: handleManualNewRepositorySession,
        onNewProjectSession: handleManualNewProjectSession,
        onEnsureRepositorySession: (repository) => {
          void ensureRepositoryMainSession(repository);
        },
        onEnsureProjectSession: (project) => {
          void ensureProjectMainSession(project);
        },
        repositoryMainBindings: repositoryMainSessionBindings,
        onAppendSystemMessage: appendSystemMessage,
        onAppendUserMessage: appendUserMessage,
        onNotifyOmcEmployeeDirectBatchTaskDone: notifyOmcEmployeeDirectBatchTaskDone,
        onPrepareFreshOmcEmployeeWorkerForDirectBatch: prepareFreshOmcEmployeeWorkerForDirectBatch,
        onRefreshHistorySessions: handleRefreshHistorySessions,
        onDeleteHistorySession: handleDeleteHistorySession,
        onOpenHistorySessionInInspector: handleOpenHistorySessionInInspector,
        onRestoreHistorySessionAsMain: handleRestoreHistorySessionAsMain,
        onRespondToQuestion: respondToQuestion,
        onDismissQuestion: dismissQuestion,
        onRespondToPermission: respondToPermission,
        onToggleTodo: toggleTodo,
        onRestoreTodosFromTranscript: restoreTodosFromTranscript,
        onRestorePendingPermissionFromTranscript: restorePendingPermissionFromTranscript,
        onClearFollowups: clearFollowups,
        onClearRevertItems: clearRevertItems,
        onSendFollowup: sendFollowup,
        onRestoreRevert: restoreRevert,
        paneCount,
        paneChangeInFlight,
        extraPanes,
        primaryPaneRuntimeOverride,
        onUpdatePaneRuntimeOverride: handleUpdatePaneRuntimeOverride,
        onChangePaneCount: handleChangePaneCount,
        onPaneRepositorySelect: handlePaneRepositorySelect,
        onPaneProjectNewSession: handlePaneProjectNewSession,
        onNewPaneSession: handleNewPaneSession,
        onToggleSidebar: () => setCollapsed((c) => !c),
        onToggleTerminal: handleToggleTerminal,
        onCollapseTerminal: handleCollapseTerminal,
        onCloseTerminalPanel: handleCloseTerminalPanel,
        onSearch: openFilenameSearchPalette,
        onSearchForRepository: openFilenameSearchPaletteForRepository,
        collapsed,
        rightCollapsed: effectiveRightCollapsed,
        terminalCollapsed,
        terminalPanelMounted,
        onOpenWorkflowConfig: openWorkflowConfigFromSidebar,
        onOpenBuiltinAssistant: openBuiltinAssistant,
        onActivateAssistant: activateAssistant,
        onOpenAssistantsHub: openAssistantsFromSidebar,
        onOpenRepositoryScheduledTasks: scheduledTasksRepository
          ? openActiveScheduledTasksOverlay
          : undefined,
        employees,
        mentionEmployees,
        composerProjectRoleTagOptions,
        composerProjectRepositoryMentionOptions,
        composerHideEmployeesInAtMode,
        workflowTasks,
        taskPendingEmployeesByTaskId,
        workflowTemplates,
        workflowGraphsByWorkflowId,
        workflowGraphStatusByWorkflowId,
        onOpenTaskDetail: (taskId) => {
          setMonitorDrawerTarget({ type: "task", taskId });
        },
        resolveTaskListOmcInvokeConcurrency,
        onDecideWorkflowTask: handleDecideWorkflowTask,
        onStopSessionConversationTask: handleStopSessionConversationTask,
      }}
      cockpitEmpty={projects.length === 0 && floatingRepositories.length === 0}
      cockpitOnboardingProps={{
        onCreateWorkspace: () => setWorkspaceCreateRequest((value) => value + 1),
        onImportStandaloneRepo: () => setStandaloneRepoAddRequest((value) => value + 1),
      }}
      workspaceWelcomeFullscreen={workspaceWelcomeFullscreen}
      workspaceWelcomeProps={{
        onAddWorkspace: () => setWorkspaceCreateRequest((value) => value + 1),
        onAddStandaloneRepo: () => setStandaloneRepoAddRequest((value) => value + 1),
      }}
      cockpitSurfaceActiveProjectId={activeProjectId ?? null}
      cockpitSurfaceActiveProjectName={activeProject?.name ?? null}
      cockpitSurfaceHasInitialTarget={Boolean(
        assistantInitialTarget?.projectId || assistantInitialTarget?.repositoryId,
      )}
      cockpitSurfaceInitialAssistantId={cockpitSurfaceInitialAssistantId}
      cockpitSurfaceResumeAssistantId={cockpitResumeAssistantId}
      cockpitSurfaceOpenRequestKey={assistantOpenRequestKey}
      scheduledTasksOverlay={scheduledTasksOverlay}
      onCloseScheduledTasksOverlay={closeScheduledTasksOverlay}
      scheduledTasksOverlayEmployees={employees}
      scheduledTasksOverlayWorkflowTemplates={workflowTemplates}
      scheduledTasksOverlayWorkflowGraphsByWorkflowId={workflowGraphsByWorkflowId}
      onCockpitActiveAssistantIdChange={(assistantId) => {
        setCockpitActiveAssistantId(assistantId);
        if (assistantId) setCockpitResumeAssistantId(assistantId);
      }}
      onClearCockpitInitialAssistant={() => setCockpitSurfaceInitialAssistantId(null)}
      commandPaletteProps={{
        open: searchOpen,
        onClose: () => {
          setSearchOpen(false);
          setSearchRepositoryPathOverride(undefined);
        },
        repositoryPath: searchRepositoryPathOverride ?? activeRepository?.path,
        repositoryId: searchRepositoryPathOverride
          ? (repositories.find((r) => r.path === searchRepositoryPathOverride)?.id ?? null)
          : (activeRepository?.id ?? null),
        searchMode,
        initialScopeDir: searchInitialScopeDir,
        onSearchModeChange: setSearchMode,
        onOpenInApp: (relativePath, options) => {
          // 多屏 per-pane 搜索时用 override 仓库；ref 取值避免 onClose 同周期清空后 closure 过期。
          const overridePath = searchRepositoryPathOverrideRef.current;
          const targetRepo = overridePath
            ? repositories.find((r) => r.path === overridePath) ?? activeRepository
            : activeRepository;
          if (!targetRepo) return;
          openRepositoryFileByEvent({
            repositoryId: targetRepo.id,
            repositoryPath: targetRepo.path,
            relativePath,
            line: options?.line ?? null,
          });
        },
      }}
      mcpHubProps={{
        repositoryPath: authorPanelRepositoryPath,
        onClose: () => viewMode.back(),
      }}
      skillsHubProps={{
        repositoryPath: authorPanelRepositoryPath,
        onClose: () => viewMode.back(),
      }}
      historyTranscriptDrawerProps={{
        open: inspectorHistorySessionId !== null,
        sessionId: inspectorHistorySessionId,
        onClose: () => setInspectorHistorySessionId(null),
        transcriptSourceSessions: sessions,
        onReloadFullDiskTranscript: reloadFullDiskTranscript,
        onLoadMoreTranscriptFromDisk: loadMoreTranscriptFromDisk,
        onCompactSessionHistory: compactSessionHistory,
        onCancelSession: cancelSession,
        onOpenTaskDetail: (taskId) => {
          setMonitorDrawerTarget({ type: "task", taskId });
        },
        onOpenHistorySessionInInspector: handleOpenHistorySessionInInspector,
        onRestoreSession: handleRestoreHistorySessionAsMain,
        canRestoreSession: canRestoreHistorySessionForDrawer,
        onResumeSession: resumeSessionFromMonitorDrawer,
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
        onLoadMoreTranscriptFromDisk: loadMoreTranscriptFromDisk,
        onCompactSessionHistory: compactSessionHistory,
        onCancelSession: cancelSession,
        onOpenTaskDetail: (taskId) => {
          setMonitorDrawerTarget({ type: "task", taskId });
        },
        onResumeSession: resumeSessionFromMonitorDrawer,
      }}
    />
    </Suspense>
    <RepositoryRunCommandModal repositories={repositories} />
    </>
  );
}
