import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { emit, listen } from "@tauri-apps/api/event";
import { safeUnlisten } from "./utils/safeTauriUnlisten";
import { Modal, message } from "antd";
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
import { resolveSessionExecutionEngine } from "./utils/sessionExecutionEngine";
import { useAgentRegistryCodexAvailable } from "./hooks/useAgentRegistryCodexAvailable";
import { useCcWorkflowStudioWorkspace } from "./hooks/useCcWorkflowStudioWorkspace";
import {
  authorView,
  cockpitView,
  mcpHubInspectTool,
  skillsHubInspectTool,
  codeGraphInspectTool,
  inspectView,
  useViewMode,
} from "./hooks/useViewMode";
import type { AuthorPane } from "./types/viewMode";
import type { PaneCount, PaneSlot } from "./constants/mainLayoutWidths";
import { useClaudeSessions, type ClaudeTurnCompletePayload } from "./hooks/useClaudeSessions";
import { useRepositoryList } from "./hooks/useRepositoryList";
import { openRepositoryRemoteInBrowser } from "./services/openRepositoryRemote";
import { openInFinder } from "./services/repository";
import { tryOpenWorkspaceInDefaultTerminal } from "./services/openWorkspaceWithTerminalPreference";
import { triggerCodeGraphProjectSearch, triggerCodeGraphReindex } from "./services/codeKnowledgeGraph";
import { AppWorkspaceLayout } from "./components/AppWorkspaceLayout";
import { RepositoryRunCommandModal } from "./components/RunCommand";
import { openRepositoryRunCommandModal } from "./stores/repositoryRunCommandModalStore";
import {
  setRepositoryRunCommandConfigureHandler,
  startRepositoryRunCommand,
  stopRepositoryRunCommand,
} from "./stores/repositoryRunCommandRuntimeStore";
import { useMacTerminalDetectionBootstrap } from "./hooks/useMacTerminalDetectionBootstrap";
import type { ScheduledTasksOverlayTarget } from "./components/RepositoryScheduledTasksModal";
import { DEFAULT_PRD_SPLIT_ASSISTANT_ID } from "./services/assistantPromptLayers";
import {
  readAuthorPaneFromSettings,
  readAuthorPaneFromStorage,
  resolveAuthorNavPane,
} from "./components/AuthorPanel";
import { reloadAppWindow } from "./services/window";
import { wiseMascotShow } from "./services/wiseMascot";
import { getTaskTemplate, setTaskTemplate } from "./services/projectState";
import { ensureCrepeToolbarTitleHintsInstalled } from "./utils/crepeToolbarTitles";
import {
  WORKFLOW_UI_EVENT_OPEN_ASSISTANT,
  WORKFLOW_UI_EVENT_OPEN_REPOSITORY_FILE,
  WORKFLOW_UI_EVENT_OPEN_TASK_SPLIT_PANEL,
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
} from "./services/releaseClaudeHostProcessesForWorkspaceScope";
import {
  dispatchAtMentionPromptToRepos,
  planAtMentionDispatch,
} from "./services/atMentionDispatch";
import { resolveProjectMainSessionAnchor } from "./utils/projectSessionAnchor";
import { resolveTrellisBootstrapPath } from "./utils/trellisBootstrapPath";
import { deferAfterPaint } from "./components/GitPanel/gitPanelUtils";
import { resolveSidebarSelectionTarget } from "./utils/sidebarSelectionTarget";
import {
  findOwnerProjectForRepositoryId,
  isMultiRepoProject,
  shouldSidebarRepositorySelectOnlyUpdateFocus,
} from "./utils/workspaceMode";
import { employeeInProjectScope, shouldHideEmployeeUi } from "./utils/projectRepositoryRoles";
import { buildProjectRoleTagOptions, buildProjectRepositoryMentionOptions } from "./utils/projectRoleTagOptions";
import {
  resolveTeamPanelEmployeeMonitorItems,
  filterRepositoryMemberMonitorItemsBySelection,
  useMonitorOverview,
} from "./hooks/useMonitorOverview";
import { useSessionConversationTasks } from "./hooks/useSessionConversationTasks";
import { useIntervalSyncedState } from "./hooks/useIntervalSyncedState";
import { useLeftSidebarHubQuickEntries } from "./hooks/useLeftSidebarHubQuickEntries";
import { useScheduledClaudeTaskRunner } from "./hooks/useScheduledClaudeTaskRunner";
import { MONITOR_SESSIONS_SYNC_INTERVAL_MS } from "./constants/monitorUi";
import { invalidateWorkflowRunCacheForRepository } from "./hooks/useWorkflowRun";
import { deleteAppSetting, getAppSetting, setAppSetting } from "./services/appSettingsStore";
import { loadWiseDefaultConfig } from "./services/wiseDefaultConfigStore";
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
import { resolveClaudeSpawnExtrasForSession } from "./services/claudeSpawnExtras";
import {
  countRunningClaudeSessionsInProjectRepository,
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
  REPOSITORY_MAIN_SESSION_BINDING_STORAGE_KEY,
  resolveRepositoryForSession,
  resolveBoundMainSessionId,
  resolveMainOwnerAgentNameForRepositoryPath,
  resolveSessionFromBindingValue,
  isProjectMainSessionBindingKey,
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
import { ensureSessionBoundToActiveMission } from "./services/mission/sessionBinding";
import { isCodeGraphIndexBenignUserAbortError } from "./types/codeKnowledgeGraph";
import { dispatchTrellisBootstrapComplete } from "./constants/trellisUiEvents";

// ── 侧栏「图谱操作 → 生成检索」：等后台索引事件后再弹窗汇总 ──

type SidebarReindexOutcome =
  | { kind: "ok"; repositoryId: number; totalNodes: number; totalEdges: number }
  | { kind: "err"; repositoryId: number; error: string; benign: boolean };

type SidebarReindexBatchState = {
  pending: Set<number>;
  outcomes: SidebarReindexOutcome[];
  unlistenComplete: () => void;
  unlistenError: () => void;
};

const MULTI_PANE_LAYOUT_STATE_STORAGE_KEY = "wise.mainLayout.multiPaneState.v1";

interface PersistedMultiPaneSlotV1 {
  slotId?: string;
  sessionId?: string | null;
  repositoryId?: number | null;
}

interface PersistedMultiPaneStateV1 {
  version: 1;
  paneCount: PaneCount;
  extraPanes: PersistedMultiPaneSlotV1[];
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
    });
  }
  return out;
}

function presentSidebarCodeGraphReindexModal(repositories: Repository[], outcomes: SidebarReindexOutcome[]): void {
  if (outcomes.length === 0) return;
  const repoLabel = (id: number) => repositories.find((r) => r.id === id)?.name ?? `仓库 #${id}`;
  const ok = outcomes.filter((o): o is Extract<SidebarReindexOutcome, { kind: "ok" }> => o.kind === "ok");
  const bad = outcomes.filter(
    (o): o is Extract<SidebarReindexOutcome, { kind: "err" }> => o.kind === "err" && !o.benign,
  );
  const benignErrs = outcomes.filter((o) => o.kind === "err" && o.benign);

  if (ok.length === 0 && bad.length === 0) {
    Modal.info({
      title: "代码图谱检索",
      content: "检索已结束（已取消或状态已重置）。",
    });
    return;
  }

  if (bad.length === 0) {
    let body = ok
      .map(
        (o) =>
          `「${repoLabel(o.repositoryId)}」节点 ${o.totalNodes.toLocaleString()}，边 ${o.totalEdges.toLocaleString()}`,
      )
      .join("\n");
    if (benignErrs.length > 0) {
      body += `\n\n${benignErrs.map((o) => `「${repoLabel(o.repositoryId)}」已取消或状态已重置`).join("\n")}`;
    }
    Modal.success({
      title: ok.length > 1 ? "代码图谱检索已全部完成" : "代码图谱检索已完成",
      content: <div style={{ whiteSpace: "pre-line" }}>{body}</div>,
    });
    return;
  }

  const okPart =
    ok.length > 0
      ? `成功（${ok.length}）\n${ok
          .map(
            (o) =>
              `「${repoLabel(o.repositoryId)}」节点 ${o.totalNodes.toLocaleString()}，边 ${o.totalEdges.toLocaleString()}`,
          )
          .join("\n")}`
      : "";
  const badPart = `失败（${bad.length}）\n${bad.map((o) => `「${repoLabel(o.repositoryId)}」${o.error}`).join("\n")}`;
  const benignPart =
    benignErrs.length > 0
      ? `\n\n已取消或已重置（${benignErrs.length}）\n${benignErrs.map((o) => `「${repoLabel(o.repositoryId)}」`).join("\n")}`
      : "";
  const content = [okPart, badPart, benignPart].filter((s) => s.length > 0).join("\n\n");

  if (ok.length > 0) {
    Modal.warning({
      title: "代码图谱检索部分完成",
      content: <div style={{ whiteSpace: "pre-line" }}>{content}</div>,
    });
  } else {
    Modal.error({
      title: "代码图谱检索失败",
      content: <div style={{ whiteSpace: "pre-line" }}>{content}</div>,
    });
  }
}

// ── App ──

export default function App() {
  /**
   * 顶层 View 状态机（参见 .trellis/spec/guides/agent-harness-architecture.md §3）。
   *
   * 取代历史上的 6 个互斥布尔（promptsMode / mcpHubMode / skillsHubMode /
   * missionControlMode / codeKnowledgeGraphMode / ccWfStudioMode）。
   * P0 通过 `viewMode.legacy.*` 提供过渡期兼容；P1 后 AppWorkspaceLayout 自身
   * 从 `viewMode` 派生这些布尔，AppImpl 不再依赖 legacy 别名。
   */
  const viewMode = useViewMode();
  useMacTerminalDetectionBootstrap();
  /** 侧栏「查看检索」打开时为 true：图谱面板不在 idle 时自动 `triggerCodeGraphReindex`；顶栏入口为 false。 */
  const codeGraphSuppressIdleAutoReindex =
    viewMode.view.kind === "inspect" && viewMode.view.tool.kind === "code-graph"
      ? viewMode.view.tool.suppressIdleAutoReindex
      : false;
  /** 侧栏仓库/项目「图谱操作 → 查看检索」进入时为 true：仅当前仓 UI，不打开仓库下拉、不显示「全部仓库」关联入口。 */
  const codeGraphLockToEntryRepository =
    viewMode.view.kind === "inspect" && viewMode.view.tool.kind === "code-graph"
      ? viewMode.view.tool.lockToEntryRepository
      : false;
  /** 侧栏项目「查看检索」进入时为 true：代码图谱默认多仓关联合并视图（候选 ≥2 时）。 */
  const codeGraphDefaultProjectMultiRepo =
    viewMode.view.kind === "inspect" && viewMode.view.tool.kind === "code-graph"
      ? viewMode.view.tool.defaultProjectMultiRepo
      : false;
  const [lastAuthorPane, setLastAuthorPane] = useState(() => readAuthorPaneFromStorage());
  const [assistantInitialTarget, setAssistantInitialTarget] = useState<OpenAssistantDetail | null>(null);
  const [assistantOpenRequestKey, setAssistantOpenRequestKey] = useState(0);
  const [cockpitSurfaceInitialAssistantId, setCockpitSurfaceInitialAssistantId] = useState<string | null>(null);
  const [cockpitActiveAssistantId, setCockpitActiveAssistantId] = useState<string | null>(null);
  const [cockpitResumeAssistantId, setCockpitResumeAssistantId] = useState<string | null>(null);
  /** 点击返回时立刻撤掉需求拆分全屏叠层，避免等 viewMode 慢更新才消失 */
  const [prdSplitUiDismissed, setPrdSplitUiDismissed] = useState(false);
  const [scheduledTasksOverlay, setScheduledTasksOverlay] = useState<ScheduledTasksOverlayTarget | null>(null);
  const [authorTrellisProjectId, setAuthorTrellisProjectId] = useState<string | null>(null);
  const [workspaceCreateRequest, setWorkspaceCreateRequest] = useState(0);
  const [standaloneRepoAddRequest, setStandaloneRepoAddRequest] = useState(0);
  const [repositorySplitTemplate, setRepositorySplitTemplate] = useState("");
  const [projectSplitTemplate, setProjectSplitTemplate] = useState("");
  const [dark, _setDark] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [terminalCollapsed, setTerminalCollapsed] = useState(true);
  /** 中栏多屏模式屏数：1=单屏（关闭），2/4/6/8=多屏。 */
  const [paneCount, setPaneCount] = useState<PaneCount>(1);
  /** 多屏模式下额外窗格槽位（Pane 0 始终是 activeSession）。 */
  const [extraPanes, setExtraPanes] = useState<PaneSlot[]>([]);
  const paneLayoutHydratedRef = useRef(false);
  const [searchOpen, setSearchOpen] = useState(false);
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
      try {
        const raw = (await getAppSetting(MULTI_PANE_LAYOUT_STATE_STORAGE_KEY))?.trim();
        if (!raw || cancelled) return;
        const parsed = JSON.parse(raw) as Partial<PersistedMultiPaneStateV1>;
        const restoredPaneCount = normalizePersistedPaneCount(parsed.paneCount);
        const restoredExtraPanes = normalizePersistedExtraPanes(parsed.extraPanes, restoredPaneCount);
        if (cancelled) return;
        setPaneCount(restoredPaneCount);
        setExtraPanes(restoredExtraPanes);
      } catch {
        // 自愈：损坏 payload 自动清理，避免后续启动重复失败
        void deleteAppSetting(MULTI_PANE_LAYOUT_STATE_STORAGE_KEY);
      } finally {
        paneLayoutHydratedRef.current = true;
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
      })),
    };
    void setAppSetting(MULTI_PANE_LAYOUT_STATE_STORAGE_KEY, JSON.stringify(payload));
  }, [paneCount, extraPanes]);

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
    handleAddRepositoryPathToProject,
    handleAddFloatingRepository,
    handlePromoteFloatingRepositoryToProject,
    handleDetachRepositoryFromProject,
    handleRemoveRepository,
    handleUpdateRepositorySddMode,
    handleReorderRepositoriesInProject,
    handleReconcileProjectWorkspace,
    handleBootstrapTrellisAtPath,
    handleUpdateRepositoryMainOwnerAgent,
    handleUpdateRepositoryExecutionEngine,
    pinnedProjectIds,
    togglePinProject,
    floatingRepositories,
    standaloneRepos,
  } = useRepositoryList();

  // macOS dock menu: listen for repository switch requests from the dock context menu.
  const switchRepoRef = useRef(setActiveRepositoryWithOwner);
  switchRepoRef.current = setActiveRepositoryWithOwner;
  const dockQueryAppliedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<number>("dock-menu-switch-repository", (ev) => {
      if (cancelled) return;
      const repoId = ev.payload;
      switchRepoRef.current(repoId);
    }).then((u) => { if (!cancelled) unlisten = u; });
    return () => {
      cancelled = true;
      if (unlisten) safeUnlisten(unlisten);
    };
  }, []);

  // macOS dock menu: refresh when repository list changes.
  useEffect(() => {
    void emit("dock-menu-refresh");
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

  const sidebarCodeGraphReindexBatchRef = useRef<SidebarReindexBatchState | null>(null);
  const disposeSidebarCodeGraphReindexBatch = useCallback(() => {
    const b = sidebarCodeGraphReindexBatchRef.current;
    if (!b) return;
    try {
      safeUnlisten(b.unlistenComplete);
    } catch {
      /* noop */
    }
    try {
      safeUnlisten(b.unlistenError);
    } catch {
      /* noop */
    }
    sidebarCodeGraphReindexBatchRef.current = null;
  }, []);

  type SidebarAssocBatchState = {
    expectedKey: string;
    unlistenOk: () => void;
    unlistenErr: () => void;
  };
  const sidebarCodeGraphAssocBatchRef = useRef<SidebarAssocBatchState | null>(null);
  const disposeSidebarCodeGraphAssocBatch = useCallback(() => {
    const b = sidebarCodeGraphAssocBatchRef.current;
    if (!b) return;
    try {
      safeUnlisten(b.unlistenOk);
    } catch {
      /* noop */
    }
    try {
      safeUnlisten(b.unlistenErr);
    } catch {
      /* noop */
    }
    sidebarCodeGraphAssocBatchRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      disposeSidebarCodeGraphReindexBatch();
      disposeSidebarCodeGraphAssocBatch();
    };
  }, [disposeSidebarCodeGraphReindexBatch, disposeSidebarCodeGraphAssocBatch]);

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

  const claudeSpawnExtrasContextRef = useRef<
    ((session: ClaudeSession) => Promise<import("./services/claudeSpawnExtras").ClaudeSpawnCliExtras | null>) | null
  >(null);

  const resolveExecutionEngineRef = useRef<
    ((session: ClaudeSession) => import("./types").SessionExecutionEngine) | null
  >(null);

  const codexAvailable = useAgentRegistryCodexAvailable();

  useEffect(() => {
    resolveExecutionEngineRef.current = (session) =>
      resolveSessionExecutionEngine(session, repositoriesLatestRef.current, employeesLatestRef.current);
  });

  const handleUpdateEmployeeExecutionEngine = useCallback(
    async (employeeId: string, engine: import("./types").SessionExecutionEngine) => {
      const row = employees.find((e) => e.id === employeeId);
      if (!row) return;
      await updateEmployee({
        employeeId,
        name: row.name,
        agentType: row.agentType,
        enabled: row.enabled,
        repositoryIds: row.repositoryIds,
        projectIds: row.projectIds,
        executionEngine: engine,
      });
      setEmployees((prev) =>
        prev.map((e) => (e.id === employeeId ? { ...e, executionEngine: engine } : e)),
      );
    },
    [employees],
  );

  const advanceTeamAfterTurnRef = useRef<(p: ClaudeTurnCompletePayload) => void>(() => {});

  const moveDingTalkAutomationPendingSessionIdRef = useRef<(fromTabId: string, toClaudeSessionId: string) => void>(() => {});
  const moveWorkflowAutomationSessionIdRef = useRef<(fromTabId: string, toClaudeSessionId: string) => void>(() => {});
  /** 在 `sessionsLatestRef` 就绪后每帧赋值：DB 迁移 workflow 会话引用 + 刷新任务列表（见 `handleSessionTabIdMigrated`）。 */
  const postSessionTabMigrationRef = useRef<(fromTabId: string, toClaudeSessionId: string) => void>(() => {});

  const handleSessionTabIdMigrated = useCallback(
    (fromTabId: string, toClaudeSessionId: string) => {
      setExtraPanes((prev) => {
        let changed = false;
        const next = prev.map((slot) => {
          if (slot.sessionId === fromTabId) {
            changed = true;
            return { ...slot, sessionId: toClaudeSessionId };
          }
          return slot;
        });
        return changed ? next : prev;
      });
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
    sessionsLiveRef,
    activeSessionId,
    createSession,
    updateSessionModel,
    updateSessionConnectionKind,
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
    clearTodos,
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
    compactSessionHistory,
    releaseSessionHostProcess,
  } = useClaudeSessions({
    onClaudeTurnComplete: (p) => {
      advanceTeamAfterTurnRef.current(p);
    },
    beforeSpawnClaudeRef,
    claudeConcurrencyInvokeContextRef,
    claudeSpawnExtrasContextRef,
    resolveExecutionEngineRef,
    onClaudeSpawnBlocked: (blockedMessage) => {
      message.warning(blockedMessage);
    },
    companionSessionIds: paneCount > 1 ? extraPanes.filter((p) => p.sessionId).map((p) => p.sessionId!) : [],
    onSessionTabIdMigrated: handleSessionTabIdMigrated,
  });

  const sessionsLatestRef = useRef(sessions);
  sessionsLatestRef.current = sessions;

  const repositoriesLatestRef = useRef(repositories);
  repositoriesLatestRef.current = repositories;

  const repositoryMainBindingsLatestRef = useRef(repositoryMainSessionBindings);
  repositoryMainBindingsLatestRef.current = repositoryMainSessionBindings;

  const releaseSessionHostProcessRef = useRef(releaseSessionHostProcess);
  releaseSessionHostProcessRef.current = releaseSessionHostProcess;

  const bindRepositoryMainSession = useCallback(
    async (repositoryPath: string, sessionId: string) => {
      const key = normalizeRepositoryPathForMatch(repositoryPath);
      const nextId = sessionId.trim();
      if (!nextId) {
        return;
      }
      const prevRaw = repositoryMainBindingsLatestRef.current[key]?.trim();
      if (prevRaw && prevRaw !== nextId) {
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
          void releaseSessionHostProcessRef.current(prevSession.id);
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
      if (stopSessionConversationTask(item)) {
        void message.success("已结束子代理执行");
      }
    },
    [handleCancelOmcDirectBatchInvocation, stopSessionConversationTask],
  );

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
    executeTerminalSession,
    flushDingTalkAutomationReplyForTurn,
    repositoryMainSessionBindings,
    repositories,
    sessions,
    sessionsLiveRef,
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
  const sendMessageToSessionRef = useRef(sendMessageToSession);
  sendMessageToSessionRef.current = sendMessageToSession;

  useScheduledClaudeTaskRunner({
    repositoriesRef: repositoriesLatestRef,
    sessionsRef: sessionsLatestRef,
    bindingsRef: repositoryMainBindingsLatestRef,
    employeesRef: employeesLatestRef,
    workflowTemplatesRef: workflowTemplatesLatestRef,
    executeRef: handleComposerExecuteRef,
    sendMessageRef: sendMessageToSessionRef,
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

  const { omcInstalled } = useOmcPluginInstalled(true);
  const { employeeMonitorItems, repositoryMemberMonitorItems, teamMonitorItems } = useMonitorOverview({
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
  const sessionConversationTaskItems = useSessionConversationTasks(activeSessionId, sessions);
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
  const missionSessionBindingKeyRef = useRef("");
  useEffect(() => {
    const session = activeSessionId ? sessionsLatestRef.current.find((item) => item.id === activeSessionId) : null;
    const rootPath = activeProject?.rootPath?.trim() || session?.repositoryPath?.trim() || null;
    if (!session || !activeProject?.id || !rootPath) return;
    const key = `${session.id}:${activeProject.id}:${rootPath}`;
    if (missionSessionBindingKeyRef.current === key) return;
    missionSessionBindingKeyRef.current = key;
    void ensureSessionBoundToActiveMission({
      sessionId: session.id,
      projectId: activeProject.id,
      rootPath,
    })
      .then((result) => {
        if (!result.mission && missionSessionBindingKeyRef.current === key) {
          missionSessionBindingKeyRef.current = "";
        }
      })
      .catch((error) => {
        if (missionSessionBindingKeyRef.current === key) {
          missionSessionBindingKeyRef.current = "";
        }
        console.debug("ensureSessionBoundToActiveMission failed:", error);
      });
  }, [activeProject?.id, activeProject?.rootPath, activeSessionId, sessions]);

  const codeGraphSearchRepositoryIds = useMemo(() => {
    if (activeProject?.repositoryIds?.length) {
      return activeProject.repositoryIds;
    }
    return undefined;
  }, [activeProject?.repositoryIds]);
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
    setActiveRepositoryWithOwner(repo.id);
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
    setPrdSplitUiDismissed(false);
    viewMode.enter(view);
  }, [viewMode]);
  /** 侧栏点「工作区/仓库需求」后短暂屏蔽「选工作区 → 回聊天」，避免菜单点击落到行上把 Cockpit 顶掉。 */
  const suppressProjectSelectToChatRef = useRef(false);
  const openRequirementAssistant = useCallback((detail: OpenAssistantDetail) => {
    suppressProjectSelectToChatRef.current = true;
    flushSync(() => {
      setSearchOpen(false);
      setAssistantInitialTarget(detail);
      setCockpitSurfaceInitialAssistantId(DEFAULT_PRD_SPLIT_ASSISTANT_ID);
      setCockpitResumeAssistantId(DEFAULT_PRD_SPLIT_ASSISTANT_ID);
      setAssistantOpenRequestKey((value) => value + 1);
      setPrdSplitUiDismissed(false);
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
    enterCockpit(cockpitView(undefined, "automation"));
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
  const exitCockpit = useCallback(() => {
    flushSync(() => {
      setPrdSplitUiDismissed(true);
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

  /** 需求拆分助手：fixed 叠层盖住整窗（含左栏） */
  const cockpitPrdSplitFullscreen = useMemo(() => {
    if (prdSplitUiDismissed) return false;
    if (viewMode.view.kind !== "cockpit") return false;
    const activeId =
      cockpitActiveAssistantId?.trim() || cockpitSurfaceInitialAssistantId?.trim() || "";
    if (activeId === DEFAULT_PRD_SPLIT_ASSISTANT_ID) return true;
    if (
      !activeId &&
      Boolean(assistantInitialTarget?.projectId || assistantInitialTarget?.repositoryId)
    ) {
      return true;
    }
    return false;
  }, [
    prdSplitUiDismissed,
    viewMode.view.kind,
    cockpitActiveAssistantId,
    cockpitSurfaceInitialAssistantId,
    assistantInitialTarget?.projectId,
    assistantInitialTarget?.repositoryId,
  ]);
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

  useEffect(() => {
    if (!tabsHydrated || !activeRepository) return;
    void refreshDiskSessionsForRepository(activeRepository.path, activeRepository.name);
  }, [activeRepository, refreshDiskSessionsForRepository, tabsHydrated]);

  const {
    ccWfStudioSessionPath,
    onCloseCcWorkflowStudio,
  } = useCcWorkflowStudioWorkspace({
    sendMessageToSession,
    switchSession,
    sessionsLatestRef,
    activeSessionIdLatestRef,
    viewMode,
    activeRepositoryPath: activeRepository?.path,
  });

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
    compactLayoutMode,
    effectiveRightCollapsed,
    handlePaneRepositorySelect,
    handlePaneProjectNewSession,
    handleNewPaneSession,
    handleNewPaneSessionInNextSlot,
    handleNewPaneProjectSessionInNextSlot,
    handleChangePaneCount,
    handleToggleCompactLayoutMode,
    handleToggleRightPanel,
    handleSetRightPanelDefaultCollapsed,
    rightPanelDefaultCollapsed,
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
    paneCount,
    extraPanes,
    projects,
    repositories,
    repositoryMainSessionBindings,
    sessions,
    setActiveRepositoryId,
    setPaneCount,
    setExtraPanes,
  });

  const handleNewPaneSessionForRepository = useCallback(
    (repository: Repository) => {
      void handleNewPaneSessionInNextSlot(repository, repository.path);
    },
    [handleNewPaneSessionInNextSlot],
  );

  const handleNewPaneSessionForProject = useCallback(
    (project: ProjectItem) => {
      const rootPath = resolveTrellisBootstrapPath({
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
      // 仅当默认配置为「展开右栏」时，才在打开历史会话时自动展开右栏；默认收起时由左侧运行面板抽屉展示。
      if (!rightPanelDefaultCollapsed && effectiveRightCollapsed) {
        handleToggleRightPanel();
      }
    },
    [effectiveRightCollapsed, handleToggleRightPanel, rightPanelDefaultCollapsed],
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
      setInspectorHistorySessionId(null);
      message.success("已恢复为主会话");
    },
    [viewMode],
  );

  const handleAddWorktreeRepositoryToProject = useCallback(
    async (worktreePath: string) => {
      if (!activeProjectId) {
        message.warning("请先在侧栏选择或创建一个 Workspace");
        return;
      }
      const repositoryType = activeRepository?.repositoryType ?? "frontend";
      try {
        const result = await handleAddRepositoryPathToProject(activeProjectId, worktreePath, repositoryType);
        if (result === "already_in_project") {
          message.info("该 worktree 目录已在当前 Workspace 中");
        } else {
          message.success("已将 worktree 目录加入当前 Workspace");
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

  /** 绑定仓库主会话（不修改侧栏选中态）。 */
  function bindRepositoryMainSessionTarget(repository: Repository): string | null {
    const target = resolveSidebarSelectionTarget({ repository });
    const mainOwnerPick = resolveMainOwnerAgentNameForRepositoryPath(repositories, target.path);
    const boundId = resolveBoundMainSessionId(
      target.path,
      repositoryMainSessionBindings,
      sessions,
      mainOwnerPick,
    );
    if (boundId) {
      switchSessionIfNeeded(boundId);
      return boundId;
    }
    const latestForRepo = pickSessionForRepositorySidebarSelect(
      sessions,
      target.path,
      sessionOwnerHintsRef.current,
      { mainOwnerAgentName: mainOwnerPick },
    );
    if (latestForRepo) {
      switchSessionIfNeeded(latestForRepo.id);
      void bindRepositoryMainSession(target.path, latestForRepo.id);
      return latestForRepo.id;
    }
    return null;
  }

  /** 打开/恢复仓库主会话：先读绑定，再挑同路径最近会话；不自动新建。 */
  async function openRepositoryMainSession(
    repository: Repository,
    options?: { enterChat?: boolean },
  ): Promise<string | null> {
    setActiveRepositoryWithOwner(repository.id);
    if (shouldSidebarRepositorySelectOnlyUpdateFocus(repository, projects)) {
      if (options?.enterChat ?? true) {
        startTransition(() => {
          viewMode.enter({ kind: "chat" });
        });
      }
      return null;
    }
    if (options?.enterChat ?? true) {
      startTransition(() => {
        viewMode.enter({ kind: "chat" });
      });
    }
    return bindRepositoryMainSessionTarget(repository);
  }

  /** 新建主会话前结束仍占着本机 Claude 的上一活动标签（含其它仓库，避免「数量」累加）。 */
  async function releasePriorActiveSessionHostBeforeNewMain(
    priorActiveId: string | null | undefined,
    newSessionId: string,
  ): Promise<void> {
    const priorId = priorActiveId?.trim();
    const nextId = newSessionId.trim();
    if (!priorId || priorId === nextId) {
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
      releaseWiseTabSession: (sessionId: string) => releaseSessionHostProcessRef.current(sessionId),
      onCancelTabSession: (sessionId: string) => cancelSession(sessionId),
    };
    if (params.kind === "repository") {
      await releaseClaudeHostProcessesForRepositoryScope({
        repositoryPath: params.repositoryPath,
        ...releaseOpts,
      });
    } else {
      await releaseClaudeHostProcessesForProjectScope({
        project: params.project,
        repositories: repositoriesLatestRef.current,
        ...releaseOpts,
      });
    }
    await releasePriorActiveSessionHostBeforeNewMain(params.priorActiveId, params.newSessionId);
  }

  /** 手动「新建会话」：始终创建新标签并绑定为仓库主会话。 */
  async function handleManualNewRepositorySession(repository: Repository): Promise<string> {
    viewMode.enter({ kind: "chat" });
    const target = resolveSidebarSelectionTarget({ repository });
    const priorActiveId = activeSessionIdLatestRef.current;
    setActiveRepositoryWithOwner(repository.id);
    const id = await createSession(target.path, target.displayName);
    await releaseScopedClaudeHostsBeforeNewMain({
      kind: "repository",
      repositoryPath: target.path,
      newSessionId: id,
      priorActiveId,
    });
    await bindRepositoryMainSession(target.path, id);
    switchSession(id);
    return id;
  }

  /** 手动为 Workspace 新建项目主会话标签。 */
  async function handleManualNewProjectSession(project: ProjectItem): Promise<string | null> {
    const byId = new Map(repositories.map((repo) => [repo.id, repo]));
    const repos = project.repositoryIds
      .map((id) => byId.get(id))
      .filter((repo): repo is Repository => Boolean(repo));
    const anchor = resolveProjectMainSessionAnchor(project, repositories);
    if (!anchor.path) {
      message.warning("该 Workspace 缺少根目录，请先配置 rootPath");
      return null;
    }
    viewMode.enter({ kind: "chat" });
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
    const priorActiveId = activeSessionIdLatestRef.current;
    const id = await createSession(anchor.path, anchor.displayName);
    await releaseScopedClaudeHostsBeforeNewMain({
      kind: "project",
      project,
      newSessionId: id,
      priorActiveId,
    });
    await bindRepositoryMainSession(projectMainSessionBindingKey(project.id), id);
    switchSession(id);
    return id;
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

  const pendingSidebarSelectionTaskRef = useRef<(() => void) | null>(null);
  const pendingSidebarSelectionTokenRef = useRef<object | null>(null);
  const cancelPendingSidebarSelectionTask = useCallback(() => {
    pendingSidebarSelectionTaskRef.current?.();
    pendingSidebarSelectionTaskRef.current = null;
    pendingSidebarSelectionTokenRef.current = null;
  }, []);
  useEffect(() => cancelPendingSidebarSelectionTask, [cancelPendingSidebarSelectionTask]);

  const handleSidebarRepositorySelectLeavingMcpHub = useCallback(
    (repositoryId: number | null) => {
      cancelPendingSidebarSelectionTask();
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
      const leavingOverlay = viewMode.isCockpit || viewMode.isAuthor || viewMode.isInspect;
      // 选工作区时会把 activeRepositoryId 设为首个成员仓且 focus=project；点同一仓仍需切到 repository 焦点。
      if (
        !leavingOverlay &&
        viewMode.isChat &&
        activeRepositoryId === repositoryId &&
        activeWorkspaceFocus !== "project"
      ) {
        return;
      }
      flushSync(() => {
        setActiveRepositoryWithOwner(repository.id);
      });
      if (leavingOverlay) {
        startTransition(() => viewMode.back());
      } else if (!viewMode.isChat) {
        startTransition(() => viewMode.enter({ kind: "chat" }));
      }
      if (shouldSidebarRepositorySelectOnlyUpdateFocus(repository, projects)) {
        return;
      }
      const selectionTaskToken = {};
      const cancelSelectionTask = deferAfterPaint(() => {
        if (pendingSidebarSelectionTokenRef.current !== selectionTaskToken) {
          return;
        }
        pendingSidebarSelectionTaskRef.current = null;
        pendingSidebarSelectionTokenRef.current = null;
        bindRepositoryMainSessionTarget(repository);
      });
      pendingSidebarSelectionTaskRef.current = cancelSelectionTask;
      pendingSidebarSelectionTokenRef.current = selectionTaskToken;
    },
    [
      activeRepositoryId,
      activeWorkspaceFocus,
      cancelPendingSidebarSelectionTask,
      handleSidebarRepositorySelect,
      projects,
      repositories,
      setActiveRepositoryWithOwner,
      viewMode,
    ],
  );

  /** 侧栏「图谱操作 → 查看检索」：与顶栏图谱入口一致，先收敛其它 Hub 再打开覆盖层。 */
  const openCodeKnowledgeGraphAfterRepositorySelect = useCallback(
    (opts: {
      projectId: string | null;
      repositoryId: number;
      /** `repository`：从单个仓库菜单进入，图谱 UI 锁定为当前仓；`project`：从项目菜单进入，保留多仓关联能力 */
      graphEntryFrom?: "project" | "repository";
    }) => {
      const repo = repositories.find((r) => r.id === opts.repositoryId);
      if (!repo) {
        message.warning("未找到该仓库");
        return;
      }
      /** 双 rAF：先让右键菜单关闭并完成一帧绘制，再跑会话切换 / 挂载图谱，避免主线程长时间卡住。 */
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setSearchOpen(false);
          if (opts.projectId != null) {
            setActiveProjectId(opts.projectId);
          }
          const alreadyOnRepo = opts.repositoryId === activeRepositoryId;
          if (!alreadyOnRepo) {
            handleSidebarRepositorySelectLeavingMcpHub(opts.repositoryId);
          }
          startTransition(() => {
            viewMode.enter(
              inspectView(
                codeGraphInspectTool({
                  suppressIdleAutoReindex: true,
                  lockToEntryRepository: opts.graphEntryFrom === "repository",
                  defaultProjectMultiRepo: opts.graphEntryFrom === "project",
                }),
              ),
            );
          });
        });
      });
    },
    [repositories, activeRepositoryId, handleSidebarRepositorySelectLeavingMcpHub, setActiveProjectId],
  );

  const handleCodeGraphGenerateRepositoryIds = useCallback(
    async (repositoryIds: number[]) => {
      const valid = repositoryIds.filter((id) => repositories.some((r) => r.id === id));
      if (valid.length === 0) {
        message.warning("没有可检索的仓库");
        return;
      }

      disposeSidebarCodeGraphReindexBatch();

      const pending = new Set(valid);
      const outcomes: SidebarReindexOutcome[] = [];

      const maybeFinish = () => {
        const batch = sidebarCodeGraphReindexBatchRef.current;
        if (!batch || batch.pending.size > 0) return;
        const snapshot = [...batch.outcomes];
        disposeSidebarCodeGraphReindexBatch();
        presentSidebarCodeGraphReindexModal(repositories, snapshot);
      };

      const unlistenComplete = await listen("code-graph-index-complete", (event) => {
        const batch = sidebarCodeGraphReindexBatchRef.current;
        if (!batch) return;
        const idRaw = (event.payload as { repositoryId?: unknown } | undefined)?.repositoryId;
        const id = typeof idRaw === "number" && Number.isFinite(idRaw) ? idRaw : Number.NaN;
        if (!Number.isFinite(id) || !batch.pending.has(id)) return;
        batch.pending.delete(id);
        const p = event.payload as { totalNodes?: unknown; totalEdges?: unknown };
        const totalNodes =
          typeof p.totalNodes === "number" && Number.isFinite(p.totalNodes) ? p.totalNodes : 0;
        const totalEdges =
          typeof p.totalEdges === "number" && Number.isFinite(p.totalEdges) ? p.totalEdges : 0;
        batch.outcomes.push({ kind: "ok", repositoryId: id, totalNodes, totalEdges });
        maybeFinish();
      });

      const unlistenError = await listen("code-graph-index-error", (event) => {
        const batch = sidebarCodeGraphReindexBatchRef.current;
        if (!batch) return;
        const idRaw = (event.payload as { repositoryId?: unknown } | undefined)?.repositoryId;
        const id = typeof idRaw === "number" && Number.isFinite(idRaw) ? idRaw : Number.NaN;
        if (!Number.isFinite(id) || !batch.pending.has(id)) return;
        batch.pending.delete(id);
        const errMsg = String((event.payload as { error?: unknown } | undefined)?.error ?? "索引失败");
        const benign = isCodeGraphIndexBenignUserAbortError(errMsg);
        batch.outcomes.push({ kind: "err", repositoryId: id, error: errMsg, benign });
        maybeFinish();
      });

      sidebarCodeGraphReindexBatchRef.current = {
        pending,
        outcomes,
        unlistenComplete,
        unlistenError,
      };

      try {
        await Promise.all(valid.map((repositoryId) => triggerCodeGraphReindex({ repositoryId })));
        message.info(
          valid.length > 1
            ? `已开始后台检索 ${valid.length} 个代码仓库（GitNexus analyze + 图谱导入），完成后将自动刷新。`
            : "已开始后台检索代码仓库（GitNexus analyze + 图谱导入），完成后将自动刷新。",
        );
      } catch (e) {
        disposeSidebarCodeGraphReindexBatch();
        console.warn("[sidebar] triggerCodeGraphReindex failed", e);
        message.error("提交代码图谱检索失败");
      }
    },
    [repositories, disposeSidebarCodeGraphReindexBatch],
  );

  /** 项目级：多仓时启动项目检索（各仓索引 + GitNexus 仓库组 + 前后端 API 关联）；单仓仍仅走本机检索。 */
  const handleCodeGraphGenerateProject = useCallback(
    async (project: ProjectItem) => {
      const valid = project.repositoryIds.filter((id) => repositories.some((r) => r.id === id));
      if (valid.length === 0) {
        message.warning("没有可检索的仓库");
        return;
      }
      if (valid.length === 1) {
        await handleCodeGraphGenerateRepositoryIds([valid[0]!]);
        return;
      }

      disposeSidebarCodeGraphAssocBatch();
      const expectedKey = [...valid].sort((a, b) => a - b).join(",");
      const idsMatchPayload = (raw: unknown) => {
        const ids = Array.isArray(raw)
          ? raw.filter((x): x is number => typeof x === "number" && Number.isFinite(x))
          : [];
        if (ids.length === 0) return false;
        return [...ids].sort((a, b) => a - b).join(",") === expectedKey;
      };

      const unlistenOk = await listen("code-graph-project-search-complete", (ev) => {
        const batch = sidebarCodeGraphAssocBatchRef.current;
        if (!batch || batch.expectedKey !== expectedKey) return;
        const raw = (ev.payload as { repositoryIds?: unknown } | undefined)?.repositoryIds;
        if (!idsMatchPayload(raw)) return;
        disposeSidebarCodeGraphAssocBatch();
        const names = valid
          .map((id) => repositories.find((r) => r.id === id)?.name ?? `#${id}`)
          .join("、");
        const bridgeEdges = (ev.payload as { apiAssociation?: { bridgeEdges?: number } } | undefined)
          ?.apiAssociation?.bridgeEdges;
        Modal.success({
          title: "多仓检索已完成",
          content:
            typeof bridgeEdges === "number" && bridgeEdges > 0
              ? `已为 Workspace 内仓库 ${names} 完成索引与 GitNexus 仓库组同步，并关联 ${bridgeEdges} 条前后端 API 调用。`
              : `已为 Workspace 内仓库 ${names} 完成索引与 GitNexus 仓库组同步。可在「代码图谱」中查看多仓子图。`,
        });
      });

      const unlistenErr = await listen("code-graph-project-search-error", (ev) => {
        const batch = sidebarCodeGraphAssocBatchRef.current;
        if (!batch || batch.expectedKey !== expectedKey) return;
        const raw = (ev.payload as { repositoryIds?: unknown } | undefined)?.repositoryIds;
        if (raw !== undefined && !idsMatchPayload(raw)) return;
        disposeSidebarCodeGraphAssocBatch();
        const err = String((ev.payload as { error?: unknown } | undefined)?.error ?? "检索失败");
        Modal.error({ title: "多仓检索失败", content: err });
      });

      sidebarCodeGraphAssocBatchRef.current = {
        expectedKey,
        unlistenOk,
        unlistenErr,
      };

      try {
        await triggerCodeGraphProjectSearch(valid);
        message.info(
          "已开始多仓检索：各仓 GitNexus 分析、GitNexus 仓库组同步，并关联前端 src/api 与后端接口。",
        );
      } catch (e) {
        disposeSidebarCodeGraphAssocBatch();
        console.warn("[sidebar] triggerCodeGraphProjectSearch (project) failed", e);
        message.error("提交多仓检索失败");
      }
    },
    [repositories, handleCodeGraphGenerateRepositoryIds, disposeSidebarCodeGraphAssocBatch],
  );

  const bindProjectMainSessionTarget = useCallback(
    (project: ProjectItem): string | null => {
      const anchor = resolveProjectMainSessionAnchor(project, repositories);
      if (!anchor.path) {
        message.warning("该 Workspace 缺少根目录，请先配置 rootPath");
        return null;
      }
      const projectBindingKey = projectMainSessionBindingKey(project.id);
      const boundId = resolveBoundMainSessionId(
        projectBindingKey,
        repositoryMainSessionBindings,
        sessions,
        null,
      );
      if (boundId) {
        switchSessionIfNeeded(boundId);
        return boundId;
      }
      const latestForProject = pickProjectMainSessionForSidebarSelect(
        sessions,
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
    [repositories, repositoryMainSessionBindings, sessions, switchSessionIfNeeded],
  );

  /**
   * 进入应用：仓库与会话 hydrated 后，对 `useRepositoryList` 通过 lastSession 或首项策略
   * 选出的 `activeRepositoryId` 打开/恢复主会话（不再要求首项必须是 project，游离 repo 同样适用）。
   */
  useEffect(() => {
    if (repositoryListLoading || !tabsHydrated) return;
    if (startupFirstProjectRepoSessionAppliedRef.current) return;
    if (activeRepositoryId == null) return;
    if (!repositories.some((r) => r.id === activeRepositoryId)) return;
    startupFirstProjectRepoSessionAppliedRef.current = true;
    const startupRepo = repositories.find((r) => r.id === activeRepositoryId) ?? null;
    const ownerProject = startupRepo
      ? findOwnerProjectForRepositoryId(startupRepo.id, projects)
      : null;
    if (startupRepo && isMultiRepoProject(ownerProject, projects) && ownerProject) {
      setActiveRepositoryWithOwner(startupRepo.id);
      bindProjectMainSessionTarget(ownerProject);
    } else {
      handleSidebarRepositorySelect(activeRepositoryId);
    }
    // P1: Standalone Repo 启动时自动进 chat（宪法 §6：Standalone Repo 不进 cockpit）
    if (!ownerProject) {
      viewMode.enter({ kind: "chat" });
    }
  }, [
    activeRepositoryId,
    bindProjectMainSessionTarget,
    handleSidebarRepositorySelect,
    projects,
    repositories,
    repositoryListLoading,
    setActiveRepositoryWithOwner,
    tabsHydrated,
    viewMode,
  ]);

  const handleProjectSelectLeavingMcpHub = useCallback(
    (projectId: string) => {
      cancelPendingSidebarSelectionTask();
      if (suppressProjectSelectToChatRef.current) {
        return;
      }
      const project = projects.find((p) => p.id === projectId) ?? null;
      if (!project) {
        setActiveProjectId(projectId);
        return;
      }
      const leavingOverlay = viewMode.isAuthor || viewMode.isInspect || viewMode.isCockpit;
      if (
        !leavingOverlay &&
        viewMode.isChat &&
        activeProjectId === projectId &&
        activeWorkspaceFocus === "project"
      ) {
        return;
      }
      if (leavingOverlay) {
        startTransition(() => viewMode.back());
      }
      setAuthorTrellisProjectId(null);
      setActiveProjectId(projectId);
      startTransition(() => {
        viewMode.enter({ kind: "chat" });
      });
      const selectionTaskToken = {};
      const cancelSelectionTask = deferAfterPaint(() => {
        if (pendingSidebarSelectionTokenRef.current !== selectionTaskToken) {
          return;
        }
        pendingSidebarSelectionTaskRef.current = null;
        pendingSidebarSelectionTokenRef.current = null;
        bindProjectMainSessionTarget(project);
      });
      pendingSidebarSelectionTaskRef.current = cancelSelectionTask;
      pendingSidebarSelectionTokenRef.current = selectionTaskToken;
    },
    [
      activeProjectId,
      activeWorkspaceFocus,
      bindProjectMainSessionTarget,
      cancelPendingSidebarSelectionTask,
      projects,
      setActiveProjectId,
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
    setAuthorTrellisProjectId(null);
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

    return bindProjectMainSessionTarget(project);
  }

  async function handleRequestSpecAgentUpdate(project: ProjectItem, area: string) {
    const sessionId = await openProjectMainSession(project);
    if (!sessionId) return;
    const areaPath = `.trellis/spec/${area}/index.md`;
    executeSession(
      sessionId,
      [
        `Update the Trellis spec area: ${area}`,
        "",
        `Project: ${project.name}`,
        `Spec index: ${areaPath}`,
        "",
        "Read the current project code and the existing spec documents before editing.",
        "Update the spec through the project workspace, keep the change focused, and report what changed and why.",
        "Do not make unrelated product or UI changes.",
      ].join("\n"),
    );
  }

  function handleOpenInFinder(repository: Repository) {
    openInFinder(repository.path).catch((err) => {
      console.error("Failed to open in finder:", err);
    });
  }

  const handleOpenProjectInFinder = useCallback(
    (project: ProjectItem) => {
      const path = resolveTrellisBootstrapPath({
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
      const path = resolveTrellisBootstrapPath({
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
      openRequirementAssistant(
        activeProjectId
          ? { projectId: activeProjectId, requirementScope: "workspace" }
          : activeRepositoryId != null
            ? { repositoryId: activeRepositoryId, requirementScope: "repository" }
            : {},
      );
    }
    window.addEventListener(WORKFLOW_UI_EVENT_OPEN_TASK_SPLIT_PANEL, handleOpenTaskSplitPanel as EventListener);
    window.addEventListener(WORKFLOW_UI_EVENT_OPEN_ASSISTANT, handleOpenAssistantEvent as EventListener);
    return () => {
      window.removeEventListener(WORKFLOW_UI_EVENT_OPEN_TASK_SPLIT_PANEL, handleOpenTaskSplitPanel as EventListener);
      window.removeEventListener(WORKFLOW_UI_EVENT_OPEN_ASSISTANT, handleOpenAssistantEvent as EventListener);
    };
    function handleOpenAssistantEvent(event: Event) {
      const detail = (event as CustomEvent<OpenAssistantDetail>).detail ?? {};
      if (typeof detail.assistantId === "string" && detail.assistantId.trim()) {
        openBuiltinAssistant(detail.assistantId);
        return;
      }
      openRequirementAssistant(detail);
    }
  }, [activeProjectId, activeRepositoryId, openBuiltinAssistant, openRequirementAssistant]);

  useEffect(() => {
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
        setWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [updatedTask.id]: events }));
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

  return (
    <>
    <AppWorkspaceLayout
      dark={dark}
      collapsed={collapsed}
      viewMode={viewMode.view}
      ccWfStudioSessionPath={ccWfStudioSessionPath}
      onCloseCcWorkflowStudio={onCloseCcWorkflowStudio}
      onCloseTrellisInspector={viewMode.back}
      onCloseCockpitAutomationHub={viewMode.back}
      compactLayoutMode={compactLayoutMode}
      effectiveRightCollapsed={effectiveRightCollapsed}
      mainLayoutContentRef={mainLayoutContentRef}
      mainLayoutLeftWidthPx={mainLayoutLeftWidthPx}
      mainLayoutRightWidthPx={mainLayoutRightWidthPx}
      repositoryFileOpenRequest={repositoryFileOpenRequest}
      onConsumeRepositoryFileOpenRequest={() => setRepositoryFileOpenRequest(null)}
      onToggleCompactLayoutMode={handleToggleCompactLayoutMode}
      onLeftWidthChange={setMainLayoutLeftWidthPx}
      onRightWidthChange={setMainLayoutRightWidthPx}
      activeRepositoryPath={activeRepository?.path}
      leftSidebarProps={{
        projects,
        activeProjectId,
        activeWorkspaceFocus,
        repositories,
        activeRepositoryId,
        authorDisabled: !activeProjectId && activeRepositoryId != null,
        authorDisabledTooltip: "Standalone Repo 不支持 Author 配置；升格为 Workspace 后启用",
        onOpenAuthor: () => {
          if (!activeProjectId && activeRepositoryId != null) {
            message.warning("Standalone Repo 不支持 Author 配置；升格为 Workspace 后启用");
            return;
          }
          enterAuthorPane(lastAuthorPane);
        },
        leftSidebarHubQuickEntryIds: leftSidebarHubQuickEntries.enabledEntryIds,
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
        onBootstrapTrellisForProject: async (project) => {
          const targetPath = resolveTrellisBootstrapPath({
            scope: "project",
            project,
            repositories,
            projects,
          });
          if (!targetPath) {
            message.warning("无法解析 Trellis 初始化目录（请配置工作区根目录或关联仓库）");
            return;
          }
          const hide = message.loading({ content: "正在初始化 Trellis…", duration: 0 });
          try {
            const status = await handleBootstrapTrellisAtPath(targetPath);
            if (status === "skipped") {
              message.info("该工作区已存在 Trellis，已跳过");
            } else {
              message.success("Trellis 初始化完成");
            }
            await handleUpdateProjectSddMode(project.id, "wise_trellis");
            dispatchTrellisBootstrapComplete({ projectId: project.id });
          } catch (e) {
            message.error(e instanceof Error ? e.message : String(e));
          } finally {
            hide();
          }
        },
        onBootstrapTrellisForRepository: async (repository) => {
          const owningProject = projects.find((p) => p.repositoryIds.includes(repository.id));
          const targetPath = resolveTrellisBootstrapPath({
            scope: "repository",
            project: owningProject,
            repository,
            repositories,
            projects,
          });
          if (!targetPath) {
            message.warning("仓库路径为空");
            return;
          }
          const hide = message.loading({ content: "正在初始化 Trellis…", duration: 0 });
          try {
            const status = await handleBootstrapTrellisAtPath(targetPath);
            if (status === "skipped") {
              message.info("该仓库已存在 Trellis，已跳过");
            } else {
              message.success("仓库 Trellis 初始化完成");
            }
            dispatchTrellisBootstrapComplete({
              projectId: owningProject?.id,
              repositoryId: repository.id,
            });
          } catch (e) {
            message.error(e instanceof Error ? e.message : String(e));
          } finally {
            hide();
          }
        },
        onReconcileProject: async (projectId, mode: ReconcileProjectMode) => {
          try {
            const r = await handleReconcileProjectWorkspace(projectId, mode);
            const added = r.addedRepositoryPaths.length;
            const graphs =
              "refreshedWorkflowCount" in r && typeof r.refreshedWorkflowCount === "number"
                ? r.refreshedWorkflowCount
                : 0;
            if (mode === "repos_only") {
              message.success(
                added > 0 ? `已同步：新登记 ${added} 个仓库（未修改流程图）` : "已同步：未发现新的 Git 仓库",
              );
              return;
            }
            message.success(
              graphs > 0
                ? `已同步：新登记 ${added} 个仓库，已按模板重绘 ${graphs} 个团队流程图（草稿）`
                : added > 0
                  ? `已同步：新登记 ${added} 个仓库（无关联工作流或无可重绘阶段）`
                  : "已同步：未发现新的 Git 仓库",
            );
          } catch (e) {
            message.error(e instanceof Error ? e.message : String(e));
          }
        },
        onPromoteFloatingRepositoryToProject: handlePromoteFloatingRepositoryToProject,
        floatingRepositories,
        onRemoveRepository: handleRemoveRepository,
        onDetachRepositoryFromProject: handleDetachRepositoryFromProject,
        onUpdateRepositorySddMode: handleUpdateRepositorySddMode,
        onUpdateProjectSddMode: async (projectId, sddMode) => {
          await handleUpdateProjectSddMode(projectId, sddMode);
        },
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
        onOpenProjectTrellis: async (project) => {
          const targetPath = resolveTrellisBootstrapPath({
            scope: "project",
            project,
            repositories,
            projects,
          });
          if (!targetPath) {
            message.warning("无法打开 Trellis：请先关联仓库或配置工作区根目录");
            return;
          }
          const hide = message.loading({ content: "正在检查 Trellis…", duration: 0 });
          try {
            const status = await handleBootstrapTrellisAtPath(targetPath);
            if (status === "initialized") {
              message.success("Trellis 初始化完成");
            }
            const isStandaloneTrellisProject = project.id.startsWith("repo:");
            if (!isStandaloneTrellisProject) {
              await handleUpdateProjectSddMode(project.id, "wise_trellis");
            }
            dispatchTrellisBootstrapComplete({ projectId: project.id });
            setAuthorTrellisProjectId(project.id);
            if (isStandaloneTrellisProject) {
              const repositoryId = project.repositoryIds[0] ?? null;
              if (repositoryId !== null) {
                setActiveRepositoryWithOwner(repositoryId);
              }
            } else {
              setActiveProjectId(project.id);
            }
            viewMode.enter(authorView("workspaces"));
          } catch (e) {
            message.error(e instanceof Error ? e.message : String(e));
          } finally {
            hide();
          }
        },
        onOpenRepositoryMainOwner: (repository) => {
          void openEmployeeConfigForRepositoryOwner(repository);
        },
        onConfigureRepositoryMainSessionRun: openRepositoryRunCommandConfigure,
        onStartRepositoryRunCommand: handleStartRepositoryRunCommand,
        onStopRepositoryRunCommand: handleStopRepositoryRunCommand,
        sessions,
        repositoryMainSessionBindings,
        activeSessionId,
        onSelectSession: jumpToSessionLeavingMcpHub,
        sessionConversationTaskItems,
        onStopSessionConversationTask: handleStopSessionConversationTask,
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
              setWorkflowTaskEventsByTaskId((prev) => ({ ...prev, [updatedTask.id]: events }));
              setTaskPendingEmployeesByTaskId((prev) => ({ ...prev, [updatedTask.id]: pendingEmployees }));
            })
            .catch((error) => {
              console.error("Failed to end team workflow task:", error);
              message.error("结束团队任务失败");
            });
        },
        monitorClaudeConcurrency,
        onOpenOmcBatchInvocationDetail: handleOpenOmcBatchInvocationDetail,
        onCancelOmcDirectBatchInvocation: handleCancelOmcDirectBatchInvocation,
        onCompactSessionHistory: compactSessionHistory,
        hideEmployeeUi: shouldHideEmployeeUi(activeProject),
        historyDrawerSessionId: inspectorHistorySessionId,
        onHistoryDrawerSessionIdChange: setInspectorHistorySessionId,
        onRestoreHistorySessionAsMain: handleRestoreHistorySessionAsMain,
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
        activeRepositoryPath: activeRepository?.path,
        activeRepositoryName: activeRepository?.name,
        onCodeGraphGenerateProject: (project) => {
          void handleCodeGraphGenerateProject(project);
        },
        onCodeGraphViewProject: (project) => {
          const firstRepoId =
            project.repositoryIds.find((id) => repositories.some((r) => r.id === id)) ?? null;
          if (firstRepoId == null) {
            message.warning("该 Workspace 下暂无仓库");
            return;
          }
          openCodeKnowledgeGraphAfterRepositorySelect({
            projectId: project.id,
            repositoryId: firstRepoId,
            graphEntryFrom: "project",
          });
        },
        onCodeGraphGenerateRepository: (repository) => {
          void handleCodeGraphGenerateRepositoryIds([repository.id]);
        },
        onCodeGraphViewRepositoryInProject: (project, repository) => {
          openCodeKnowledgeGraphAfterRepositorySelect({
            projectId: project.id,
            repositoryId: repository.id,
            graphEntryFrom: "repository",
          });
        },
        onCodeGraphViewFloatingRepository: (repository) => {
          openCodeKnowledgeGraphAfterRepositorySelect({
            projectId: null,
            repositoryId: repository.id,
            graphEntryFrom: "repository",
          });
        },
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
          trellisWorkspaceId: authorTrellisProjectId,
          onCreateWorkspace: () => {
            setWorkspaceCreateRequest((value) => value + 1);
          },
          onAddStandaloneRepo: () => {
            setStandaloneRepoAddRequest((value) => value + 1);
          },
          onSelectWorkspace: handleProjectSelectLeavingMcpHub,
          onSelectStandaloneRepo: (repositoryId) => handleSidebarRepositorySelectLeavingMcpHub(repositoryId),
          onOpenProjectSession: async (project) => {
            await openProjectMainSession(project);
          },
          onRequestSpecAgentUpdate: handleRequestSpecAgentUpdate,
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
                  message.success("已关联到当前 Workspace");
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
              message.success("团队已删除");
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
          repositoryPath: activeRepository?.path ?? null,
        },
        skillsHubProps: {
          repositoryPath: activeRepository?.path ?? null,
        },
        assistantsPanelProps: {
          activeProjectId: activeProjectId ?? null,
          activeProjectName: activeProject?.name ?? null,
          onOpenAssistant: openBuiltinAssistant,
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
      claudeSessionsProps={{
        sessions,
        activeSessionId,
        onReloadFullDiskTranscript: reloadFullDiskTranscript,
        onCompactSessionHistory: compactSessionHistory,
        omcBatchPipelineActive: Boolean(omcBatchRuntime?.active),
        onAddWorktreeRepositoryToProject: handleAddWorktreeRepositoryToProject,
        activeRepository,
        repositories,
        activeRepositoryId,
        workspaceMode,
        activeProject,
        projects,
        activeWorkspaceFocus,
        onSelectRepository: setActiveRepositoryId,
        onUpdateSessionModel: updateSessionModel,
        onUpdateSessionConnectionKind: updateSessionConnectionKind,
        onUpdateRepositoryExecutionEngine: handleUpdateRepositoryExecutionEngine,
        onUpdateEmployeeExecutionEngine: handleUpdateEmployeeExecutionEngine,
        codexAvailable,
        onOpenExecutionEnvironment: handleOpenExecutionEnvironment,
        onExecuteSession: handleComposerExecute,
        onSendMessage: handleSendMessageWithAtMention,
        onCancelSession: cancelSession,
        onCloseSession: handleCloseSession,
        onSwitchSession: jumpToSessionWithRepository,
        onNewSession: (repository) => {
          void handleManualNewRepositorySession(repository);
        },
        onNewProjectSession: (project) => {
          void handleManualNewProjectSession(project);
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
        missionContext: {
          projectId: activeProjectId,
          rootPath: activeProject?.rootPath ?? activeRepository?.path ?? null,
        },
        onClearTodos: clearTodos,
        onToggleTodo: toggleTodo,
        onRestoreTodosFromTranscript: restoreTodosFromTranscript,
        onRestorePendingPermissionFromTranscript: restorePendingPermissionFromTranscript,
        onClearFollowups: clearFollowups,
        onClearRevertItems: clearRevertItems,
        onSendFollowup: sendFollowup,
        onRestoreRevert: restoreRevert,
        paneCount,
        extraPanes,
        onChangePaneCount: handleChangePaneCount,
        onPaneRepositorySelect: handlePaneRepositorySelect,
        onPaneProjectNewSession: handlePaneProjectNewSession,
        onNewPaneSession: handleNewPaneSession,
        onToggleSidebar: () => setCollapsed((c) => !c),
        onToggleRightPanel: handleToggleRightPanel,
        rightPanelDefaultCollapsed,
        onSetRightPanelDefaultCollapsed: handleSetRightPanelDefaultCollapsed,
        onToggleTerminal: () => setTerminalCollapsed((c) => !c),
        onSearch: () => setSearchOpen(true),
        collapsed,
        rightCollapsed: effectiveRightCollapsed,
        terminalCollapsed,
        onOpenWorkflowConfig: openWorkflowConfigFromSidebar,
        onOpenBuiltinAssistant: openBuiltinAssistant,
        onOpenRepositoryScheduledTasks: activeRepository
          ? () => openScheduledTasksForRepository(activeRepository)
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
        taskListConcurrentCapacity: monitorClaudeConcurrency
          ? Math.max(0, monitorClaudeConcurrency.limit - monitorClaudeConcurrency.activeCount)
          : undefined,
        resolveTaskListOmcInvokeConcurrency,
        onDecideWorkflowTask: handleDecideWorkflowTask,
      }}
      chatInspectorProps={{
        dark,
        collapsed: false,
        projectId: activeProjectId,
        siderWidth: mainLayoutRightWidthPx,
        monitorStats: null,
      }}
      cockpitInspectorProps={{
        dark,
        collapsed: effectiveRightCollapsed,
        siderWidth: mainLayoutRightWidthPx,
        activeProject,
        employeeMonitorItems,
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
      cockpitPrdSplitFullscreen={cockpitPrdSplitFullscreen}
      scheduledTasksOverlay={scheduledTasksOverlay}
      onCloseScheduledTasksOverlay={closeScheduledTasksOverlay}
      scheduledTasksOverlayEmployees={employees}
      scheduledTasksOverlayWorkflowTemplates={workflowTemplates}
      scheduledTasksOverlayWorkflowGraphsByWorkflowId={workflowGraphsByWorkflowId}
      onCockpitActiveAssistantIdChange={(assistantId) => {
        setCockpitActiveAssistantId(assistantId);
        if (assistantId) setCockpitResumeAssistantId(assistantId);
      }}
      commandPaletteProps={{
        open: searchOpen,
        onClose: () => setSearchOpen(false),
        repositoryPath: activeRepository?.path,
      }}
      mcpHubProps={{
        repositoryPath: activeRepository?.path ?? null,
        onClose: () => viewMode.back(),
      }}
      skillsHubProps={{
        repositoryPath: activeRepository?.path ?? null,
        onClose: () => viewMode.back(),
      }}
      codeKnowledgeGraphProps={{
        repositoryId: activeRepository?.id ?? null,
        repositories: repositories.map((r) => ({
          id: r.id,
          name: r.name,
          path: r.path,
          repositoryType: r.repositoryType,
        })),
        searchRepositoryIds: codeGraphLockToEntryRepository ? undefined : codeGraphSearchRepositoryIds,
        lockToEntryRepository: codeGraphLockToEntryRepository,
        defaultProjectMultiRepoAssociation: codeGraphDefaultProjectMultiRepo,
        onSelectRepository: setActiveRepositoryWithOwner,
        onClose: () => {
          viewMode.back();
        },
        onRemoveRepository: async (repoId) => {
          const repo = repositories.find((r) => r.id === repoId);
          if (repo) await handleRemoveRepository(repo);
        },
        onOpenAddRepository: () => void handleAddFloatingRepository("frontend"),
        suppressIdleAutoReindex: codeGraphSuppressIdleAutoReindex,
      }}
      prdTaskSplitPanelProps={{
        projects,
        repositories,
        activeProjectId,
        activeRepositoryId,
        initialProjectId: assistantInitialTarget?.projectId ?? null,
        initialRepositoryId: assistantInitialTarget?.repositoryId ?? null,
        initialRequirementScope: assistantInitialTarget?.requirementScope ?? null,
        onClose: exitCockpit,
        onOpenMainSession: exitCockpit,
        onOpenRuntimeLens: ({ rootPath, projectId }) => {
          viewMode.enter(inspectView({
            kind: "runtime-events",
            rootPath,
            projectId,
          }));
        },
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
        onCompactSessionHistory: compactSessionHistory,
        onCancelSession: cancelSession,
        onOpenTaskDetail: (taskId) => {
          setMonitorDrawerTarget({ type: "task", taskId });
        },
      }}
    />
    <RepositoryRunCommandModal repositories={repositories} />
    </>
  );
}
