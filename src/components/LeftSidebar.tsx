import { App as AntdApp, Layout, Spin } from "antd";
import { HoverHint } from "./shared/HoverHint";
import {
  lazy,
  Suspense,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ProjectItem, Repository } from "../types";
import { repositoryFolderBasename } from "../utils/repositoryType";
import {
  globalWorkspaceToTreeSelection,
  resolveGitPanelRepositoryEntries,
  resolveWorkspaceRepositoryTreeSelectionView,
  type WorkspaceRepositoryTreeSelection,
} from "../utils/workspaceRepositoryTreeSelect";
import { normalizeSessionRepositoryPath } from "../utils/sessionHistoryScope";
import { resolveTrellisBootstrapPath } from "../utils/trellisBootstrapPath";
import { resolveRepositoryForSession } from "../utils/repositoryMainSessionBinding";
import { isMultiRepoProject, shouldRevealWorkspaceListOnRestore } from "../utils/workspaceMode";
import {
  resolveClaudeProjectSkillsScopePath,
  resolveScheduledTasksRepository,
} from "../utils/workspaceSelectionState";
import { runWhenIdle } from "../utils/deferIdle";
import { MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX } from "../constants/mainLayoutWidths";
import { DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION } from "../constants/workspaceBootstrapAddons";
import { cancelClaudeExecution } from "../services/claude";
import { stopClaudeMainSession } from "../services/stopClaudeMainSession";
import {
  projectMainSessionBindingKey,
  resolveBoundMainSessionId,
  resolveMainOwnerAgentNameForRepositoryPath,
  resolveRepositoryMainSessionId,
} from "../utils/repositoryMainSessionBinding";
import { endClaudeProcessRow } from "./LeftSidebar/endClaudeProcessRow";
import { pickFolder } from "../services/repository";
import {
  pathIsAccessibleDirectoryCached,
  readPathAccessibilityCache,
} from "../utils/pathAccessibilityCache";
import {
  OPEN_WORKSPACE_ERROR,
  openWorkspaceWithStoredPreference,
} from "../services/openWorkspaceWithPreference";
import { TaskCardsNav } from "./TaskCardsNav";
import { ActiveRepositoryFilesPanel } from "./LeftSidebar/ActiveRepositoryFilesPanel";
import { LeftSidebarTopbar } from "./LeftSidebar/LeftSidebarTopbar";
import { LeftSidebarHubQuickEntries } from "./LeftSidebar/LeftSidebarHubQuickEntries";
import { ProjectRepositoryList } from "./LeftSidebar/ProjectRepositoryList";
import { SidebarWorkspaceTodoAddModal } from "./LeftSidebar/SidebarWorkspaceTodoAddModal";
import { SidebarGlobalWorkspaceTodoAddModal } from "./LeftSidebar/SidebarGlobalWorkspaceTodoAddModal";
import { GitPanelWorkspaceSelector } from "./GitPanel/GitPanelWorkspaceSelector";
import type { GitPanelOpenFileOptions } from "./GitPanel/types";
import {
  readLeftFilesExplorerCollapsedFromStorage,
  writeLeftFilesExplorerCollapsedToStorage,
  readLeftWorkspaceListCollapsedFromStorage,
  writeLeftWorkspaceListCollapsedToStorage,
  readLeftMonitorPanelCollapsedFromStorage,
  writeLeftMonitorPanelCollapsedToStorage,
  readLeftBottomTabFromStorage,
  writeLeftBottomTabToStorage,
  type LeftBottomTab,
} from "./LeftSidebar/sidebarStorage";
import { ProjectNameModals } from "./LeftSidebar/ProjectNameModals";
import { RepositoryAssociateModal } from "./LeftSidebar/RepositoryAssociateModal";
import { RepositorySddModeModal } from "./LeftSidebar/RepositorySddModeModal";
import { WorkspaceSddModeModal } from "./LeftSidebar/WorkspaceSddModeModal";
import { LeftSidebarBottomTabPanes } from "./LeftSidebar/LeftSidebarBottomTabPanes";
import { LeftSidebarBottomTabSwitcher } from "./LeftSidebar/LeftSidebarBottomTabSwitcher";
import { RightRailRepoPanelPanes } from "./LeftSidebar/RightRailRepoPanelPanes";
import {
  deriveRepoPanelRenderState,
} from "./LeftSidebar/repoPanelPlacement";
import { ExpandIcon } from "./LeftSidebar/SidebarIcons";
import { SystemResourceInline } from "./LeftSidebar/SystemResourceInline";
import type { LeftSidebarProps } from "./LeftSidebar/types";
import { useProjectRepositorySidebarState } from "./LeftSidebar/useProjectRepositorySidebarState";
import { useRepositoryAssociateModalController } from "./LeftSidebar/useRepositoryAssociateModalController";
import { useProjectSddModeModalController } from "./LeftSidebar/useProjectSddModeModalController";
import { useRepositorySddModeModalController } from "./LeftSidebar/useRepositorySddModeModalController";
import { useSidebarScheduledTasksMap } from "./LeftSidebar/useSidebarScheduledTasksMap";
import { useWorkspaceTodoCountsBootstrap } from "../hooks/useWorkspaceTodoCountsBootstrap";
import { useWorkspaceInspectorPanelsDefault } from "../hooks/useWorkspaceInspectorPanelsDefault";
import { useSidebarRequirementUnsplitMap } from "./LeftSidebar/useSidebarRequirementUnsplitMap";
import { useSidebarExecutableTasksMap } from "./LeftSidebar/useSidebarExecutableTasksMap";
import { useSidebarTrellisReadyMap } from "./LeftSidebar/useSidebarTrellisReadyMap";
import { useClaudeProcessWorkspaceLabelCache } from "../hooks/useClaudeProcessWorkspaceLabelCache";
import { useSystemResourceSessions } from "./LeftSidebar/useSystemResourceSessions";
import { useSidebarRunningMainSessionIndicators } from "./LeftSidebar/useSidebarRunningMainSessionIndicators";
import {
  LeftSidebarMonitorPanelSlot,
  preloadLeftSidebarMonitorPanel,
} from "./LeftSidebar/LeftSidebarMonitorPanelSlot";
import { useChromePanelHoverHandlers } from "../hooks/useChromePanelHoverHandlers";
import { useMonitorSidebarFingerprints } from "../hooks/useMonitorSessionsForOverview";
import { notifySplitTodoCountUpdated } from "../utils/notifySplitTodoCountUpdated";
import "./GitPanel/index.css";
import "./LeftSidebar/leftSidebarListPerformance.css";
const GitPanelLazy = lazy(() => import("./GitPanel").then((module) => ({ default: module.GitPanel })));
const AppSettingsModalLazy = lazy(() =>
  import("./AppSettingsModal").then((module) => ({ default: module.AppSettingsModal })),
);

const gitPanelChunk = import("./GitPanel");

export function LeftSidebar({
  dark,
  collapsed,
  siderWidth = MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX,
  parked = false,
  projects,
  activeProjectId,
  activeWorkspaceFocus = "repository",
  repositories,
  activeRepositoryId,
  authorDisabled,
  authorDisabledTooltip,
  onOpenAuthor,
  leftSidebarHubQuickEntryIds = [],
  showLeftSidebarMonitorPanel = true,
  mcpHubActive = false,
  onOpenMcpHub,
  skillsHubActive = false,
  onOpenSkillsHub,
  automationHubActive = false,
  onOpenAutomationHub,
  assistantsHubActive = false,
  onOpenAssistantsHub,
  claudePluginsHubActive = false,
  onOpenClaudePluginsHub,
  workspaceCreateRequest,
  standaloneRepoAddRequest,
  onProjectSelect,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  pinnedProjectIds,
  onTogglePinProject,
  onReconcileProject,
  onBootstrapTrellisForProject,
  onBootstrapTrellisForRepository,
  onAddFloatingRepository,
  onAddRepositoryToProject,
  onPromoteFloatingRepositoryToProject,
  floatingRepositories = [],
  onRemoveRepository,
  onDetachRepositoryFromProject,
  onUpdateRepositorySddMode,
  onUpdateProjectSddMode,
  onUpdateRepositoryOpenAppId,
  onUpdateProjectOpenAppId,
  onNewPaneSessionForRepository,
  onNewPaneSessionForProject,
  onReorderRepositoriesInProject,
  onMoveRepositoryToProject,
  onRepositorySelect,
  onOpenInFinder,
  onOpenProjectInFinder,
  onOpenInTerminal,
  onOpenProjectInTerminal,
  onOpenRepositoryInBrowser,
  onOpenScheduledTasksForRepository: onOpenScheduledTasksForRepositoryProp,
  onOpenScheduledTasksForProject: onOpenScheduledTasksForProjectProp,
  onCreateProjectTask,
  onCreateRepositoryTask,
  onOpenWorkspaceRequirements,
  onOpenRepositoryRequirements: onOpenRepositoryRequirementsProp,
  onOpenPromptsProject,
  onOpenProjectTrellis,
  onOpenPromptsRepository,
  onOpenRepositoryMainOwner,
  onConfigureRepositoryMainSessionRun,
  onStartRepositoryRunCommand,
  onStopRepositoryRunCommand,
  sessions,
  sessionsStructureKey,
  sessionsLiveRef,
  monitorPanelSessions,
  repositoryMainSessionBindings,
  activeSessionId,
  onSelectSession: _onSelectSession,
  sessionConversationTaskItems,
  onStopSessionConversationTask,
  executionEnvironmentDispatchHistoryDays,
  onExecutionEnvironmentDispatchHistoryDaysChange,
  executionEnvironmentDispatchHistoryDaysSaving = false,
  employees: _employees = [],
  employeeTaskCounts: _employeeTaskCounts = [],
  workflowTemplates: _workflowTemplates = [],
  workflowGraphsByWorkflowId: _workflowGraphsByWorkflowId = {},
  onMoveEmployee: _onMoveEmployee,
  onCancelSessionFromMonitor,
  onOpenTaskDetailFromMonitor,
  onReloadFullDiskTranscript,
  onRefreshHistorySessions,
  projectId,
  employeeMonitorItems = [],
  repositoryMemberMonitorItems = [],
  teamMonitorItems = [],
  monitorActiveTarget,
  onOpenTeamMonitorDetail,
  onOpenEmployeeConfig,
  onOpenWorkflowConfig,
  onStopEmployeeMonitor,
  onStopTeamMonitor,
  hideEmployeeUi = false,
  onOpenOmcBatchInvocationDetail,
  onCancelOmcDirectBatchInvocation,
  onCompactSessionHistory,
  historyDrawerSessionId,
  onHistoryDrawerSessionIdChange,
  onRestoreHistorySessionAsMain,
  onCreateTerminalEmployeeSession,
  onResumeSession,
  onPrepareSessionForMonitorDrawer,
  activeRepositoryPath,
  activeRepositoryName,
  onOpenActiveRepositoryFile,
  gitPanelPlacement = "left",
  filesPanelPlacement = "left",
  repoPanelRightRailAvailable = true,
  onRepositoryRepoPanelChange,
  taskCardsNavProps,
}: LeftSidebarProps) {
  const { message, modal } = AntdApp.useApp();
  const chromePanelHoverHandlers = useChromePanelHoverHandlers("left");

  const openPathInPreferredEditor = useCallback(
    (
      path: string | null | undefined,
      emptyMessage: string,
      scopeOpenAppId?: string | null,
    ) => {
      const trimmed = path?.trim() ?? "";
      if (!trimmed) {
        message.warning(emptyMessage);
        return;
      }
      void openWorkspaceWithStoredPreference(trimmed, undefined, scopeOpenAppId).catch((err: unknown) => {
        const code = err instanceof Error ? err.message : "";
        if (code === OPEN_WORKSPACE_ERROR.NOT_CONFIGURED) {
          message.warning("未配置可用的编辑器或命令，请在中栏顶部「打开方式」中选择");
        } else if (code === OPEN_WORKSPACE_ERROR.EMPTY_PATH) {
          message.warning(emptyMessage);
        } else if (code === OPEN_WORKSPACE_ERROR.NO_TARGET) {
          message.warning("未找到可用的打开方式");
        } else {
          message.error("编辑器打开失败");
          console.error(err);
        }
      });
    },
    [message],
  );

  const openRepositoryInPreferredEditor = useCallback(
    (repository: Repository) => {
      openPathInPreferredEditor(repository.path, "仓库路径为空", repository.openAppId);
    },
    [openPathInPreferredEditor],
  );

  const openProjectInPreferredEditor = useCallback(
    (project: ProjectItem) => {
      const path = resolveTrellisBootstrapPath({
        scope: "project",
        project,
        repositories,
        projects,
      });
      openPathInPreferredEditor(
        path,
        "无法解析工作区目录，请先配置工作区根目录或关联仓库",
        project.openAppId,
      );
    },
    [openPathInPreferredEditor, projects, repositories],
  );

  const handleConfigureRepositoryOpenApp = useCallback(
    (repository: Repository, openAppId: string | null) => {
      if (!onUpdateRepositoryOpenAppId) return;
      void Promise.resolve(onUpdateRepositoryOpenAppId(repository.id, openAppId)).catch(
        (err: unknown) => {
          message.error(err instanceof Error ? err.message : "打开方式配置失败");
        },
      );
    },
    [message, onUpdateRepositoryOpenAppId],
  );

  const handleConfigureProjectOpenApp = useCallback(
    (project: ProjectItem, openAppId: string | null) => {
      if (!onUpdateProjectOpenAppId) return;
      void Promise.resolve(onUpdateProjectOpenAppId(project.id, openAppId)).catch((err: unknown) => {
        message.error(err instanceof Error ? err.message : "打开方式配置失败");
      });
    },
    [message, onUpdateProjectOpenAppId],
  );

  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [globalWorkspaceTodoAddOpen, setGlobalWorkspaceTodoAddOpen] = useState(false);
  const [createProjectRootPath, setCreateProjectRootPath] = useState("");
  const [createProjectSubmitting, setCreateProjectSubmitting] = useState(false);
  const [workspaceBootstrapSelection, setWorkspaceBootstrapSelection] = useState(
    () => ({ ...DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION }),
  );
  const [projectNameInput, setProjectNameInput] = useState("");
  const [editProject, setEditProject] = useState<ProjectItem | null>(null);
  /** 待升格为新项目的游离 repo（菜单触发后弹出输入项目名 modal）。 */
  const [promotingFloatingRepo, setPromotingFloatingRepo] = useState<Repository | null>(null);
  const [promotingFloatingRepoName, setPromotingFloatingRepoName] = useState("");
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [repositoryFileTreeSearch, setRepositoryFileTreeSearch] = useState("");
  /** 左下 Git/文件 Tab 目录选择器上下文：仅切换面板目录，不联动全局工作区/会话。 */
  const [repoPanelTreeSelection, setRepoPanelTreeSelection] =
    useState<WorkspaceRepositoryTreeSelection | null>(null);
  const lastSyncedGlobalSelectionKeyRef = useRef<string | null>(null);
  const sessionsLatestRef = sessionsLiveRef;
  const [filesExplorerSectionCollapsed, setFilesExplorerSectionCollapsed] = useState(
    readLeftFilesExplorerCollapsedFromStorage,
  );
  const [workspaceListSectionCollapsed, setWorkspaceListSectionCollapsed] = useState(
    readLeftWorkspaceListCollapsedFromStorage,
  );
  const [monitorPanelSectionCollapsed, setMonitorPanelSectionCollapsed] = useState(
    readLeftMonitorPanelCollapsedFromStorage,
  );
  const [leftBottomTab, setLeftBottomTab] = useState<LeftBottomTab>(readLeftBottomTabFromStorage);
  const repoPanelRenderState = useMemo(
    () =>
      deriveRepoPanelRenderState(
        gitPanelPlacement,
        filesPanelPlacement,
        leftBottomTab,
        { rightRailAvailable: repoPanelRightRailAvailable },
      ),
    [filesPanelPlacement, gitPanelPlacement, leftBottomTab, repoPanelRightRailAvailable],
  );
  const [bottomTabPanelsReady, setBottomTabPanelsReady] = useState(false);
  const [monitorPanelMounted, setMonitorPanelMounted] = useState(false);
  const { monitorSessionsFingerprint, transcriptSessionsFingerprint } = useMonitorSidebarFingerprints(
    monitorPanelSessions ?? sessions,
    sessions,
    showLeftSidebarMonitorPanel,
  );

  useEffect(() => {
    if (!showLeftSidebarMonitorPanel) {
      return;
    }
    preloadLeftSidebarMonitorPanel();
    const cancel = runWhenIdle(() => setMonitorPanelMounted(true), { timeoutMs: 500 });
    return cancel;
  }, [showLeftSidebarMonitorPanel]);

  useEffect(() => {
    void gitPanelChunk;
    const cancel = runWhenIdle(() => setBottomTabPanelsReady(true), { timeoutMs: 400 });
    return cancel;
  }, []);
  const expandedFilesPanelOnMountRef = useRef(false);
  const projectRepositoryState = useProjectRepositorySidebarState({
    projects,
    repositories,
    activeProjectId,
    activeRepositoryId,
    activeWorkspaceFocus,
    onMoveRepositoryToProject,
  });
  const restoreWorkspaceListVisibilityRef = useRef(false);
  const claudeProcessLabelCache = useClaudeProcessWorkspaceLabelCache();
  const systemResourceSessions = useSystemResourceSessions({
    sessionsRef: sessionsLiveRef,
    sessionsStructureKey,
    onCancelSessionFromMonitor,
    onReloadFullDiskTranscript,
  });

  const claudeLabelSyncFingerprintRef = useRef("");
  useEffect(() => {
    const processPart = systemResourceSessions.systemSummary.claudeProcesses
      .map((p) => `${p.pid}:${p.sessionId ?? ""}`)
      .join("|");
    const fp = `${sessions.length}|${activeSessionId ?? ""}|${processPart}`;
    if (fp === claudeLabelSyncFingerprintRef.current) return;
    claudeLabelSyncFingerprintRef.current = fp;
    const snapshot = {
      projects,
      repositories,
      bindings: repositoryMainSessionBindings,
      sessions: sessionsLatestRef.current,
      claudeProcesses: systemResourceSessions.systemSummary.claudeProcesses,
    };
    const cancel = runWhenIdle(
      () => claudeProcessLabelCache.syncFromRuntime(snapshot),
      { timeoutMs: 120 },
    );
    return cancel;
  }, [
    activeSessionId,
    claudeProcessLabelCache,
    projects,
    repositories,
    repositoryMainSessionBindings,
    sessions.length,
    systemResourceSessions.systemSummary.claudeProcesses,
  ]);
  const { runningByProjectId, runningByRepositoryId } = useSidebarRunningMainSessionIndicators({
    projects,
    repositories,
    sessionsRef: sessionsLiveRef,
    sessionsStructureKey,
    repositoryMainSessionBindings,
    claudeProcesses: systemResourceSessions.systemSummary.claudeProcesses,
    registryRunningClaudeSessionIds: systemResourceSessions.claudeRegistryRunningIds,
  });

  const handleStopBoundMainSession = useCallback(
    async (boundSessionId: string | null | undefined) => {
      const id = boundSessionId?.trim();
      if (!id) {
        message.warning("未绑定主会话");
        return;
      }
      const session = sessionsLiveRef.current.find((item) => item.id === id);
      if (!session) {
        message.warning("未找到绑定主会话");
        return;
      }
      try {
        await stopClaudeMainSession({
          session,
          claudeProcesses: systemResourceSessions.systemSummary.claudeProcesses,
          onCancelTabSession: onCancelSessionFromMonitor,
        });
      } catch (err: unknown) {
        message.error(err instanceof Error ? err.message : "结束失败");
      }
    },
    [
      message,
      onCancelSessionFromMonitor,
      sessionsLiveRef,
      systemResourceSessions.systemSummary.claudeProcesses,
    ],
  );

  const handleStopProjectMainSession = useCallback(
    (projectId: string) => {
      const boundSessionId = resolveBoundMainSessionId(
        projectMainSessionBindingKey(projectId),
        repositoryMainSessionBindings,
        sessionsLiveRef.current,
        null,
      );
      void handleStopBoundMainSession(boundSessionId);
    },
    [handleStopBoundMainSession, repositoryMainSessionBindings, sessionsLiveRef],
  );

  const handleStopRepositoryMainSession = useCallback(
    (repository: Repository) => {
      const boundSessionId = resolveRepositoryMainSessionId(
        repository.path,
        repositoryMainSessionBindings,
        sessionsLiveRef.current,
        resolveMainOwnerAgentNameForRepositoryPath(repositories, repository.path),
      );
      void handleStopBoundMainSession(boundSessionId);
    },
    [handleStopBoundMainSession, repositories, repositoryMainSessionBindings, sessionsLiveRef],
  );

  const finishClaudeProcessPopoverEnd = useCallback(() => {
    systemResourceSessions.setClaudeCountPopoverOpen(false);
    systemResourceSessions.setSystemSessionDrawerId(null);
  }, [message, systemResourceSessions]);

  const failClaudeProcessPopoverEnd = useCallback(
    (err: unknown) => {
      message.error(err instanceof Error ? err.message : "结束失败");
    },
    [message],
  );

  const endClaudeProcessPopoverRow = useCallback(
    async (rowSessionId: string) => {
      const rowSession = systemResourceSessions.matchedSystemInlineSessions.find(
        (s) => s.id === rowSessionId,
      );
      await endClaudeProcessRow({
        rowSessionId,
        rowSession,
        onCancelTabSession: onCancelSessionFromMonitor,
      });
    },
    [onCancelSessionFromMonitor, systemResourceSessions.matchedSystemInlineSessions],
  );

  const handleBatchEndClaudeProcessRows = useCallback(
    async (sessionIds: string[]) => {
      const uniqueIds = [...new Set(sessionIds.map((id) => id.trim()).filter(Boolean))];
      if (uniqueIds.length === 0) {
        return;
      }
      const results = await Promise.allSettled(
        uniqueIds.map((rowSessionId) => endClaudeProcessPopoverRow(rowSessionId)),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      systemResourceSessions.setClaudeCountPopoverOpen(false);
      systemResourceSessions.setSystemSessionDrawerId(null);
      systemResourceSessions.setClaudeSystemSessionSearch("");
      if (failed === 0) {
      } else if (failed < uniqueIds.length) {
        message.warning(
          `已请求结束 ${uniqueIds.length - failed} 个进程，${failed} 个失败`,
        );
      } else {
        message.error("批量结束失败");
      }
    },
    [endClaudeProcessPopoverRow, message, systemResourceSessions],
  );

  const repositoryAssociateModal = useRepositoryAssociateModalController({
    projects,
    onAddFloatingRepository,
    onAddRepositoryToProject,
  });
  const { openAddFloatingRepositoryModal, openAddRepositoryModal } = repositoryAssociateModal;
  const repositorySddModeModal = useRepositorySddModeModalController({
    onUpdateRepositorySddMode,
  });
  const projectSddModeModal = useProjectSddModeModalController({
    projects,
    repositories,
    onUpdateProjectSddMode,
  });
  const { showWorkspaceTodosPanel: workspaceTodosEnabled } = useWorkspaceInspectorPanelsDefault();
  useWorkspaceTodoCountsBootstrap(projects, floatingRepositories, workspaceTodosEnabled);
  const { byId: scheduledTasksByRepoId } = useSidebarScheduledTasksMap(
    repositories,
  );
  const {
    projectUnsplitById: requirementUnsplitByProjectId,
    repositoryUnsplitById: requirementUnsplitByRepoId,
  } = useSidebarRequirementUnsplitMap(projects, repositories);
  const {
    projectExecutableById: executableTasksByProjectId,
    repositoryExecutableById: executableTasksByRepoId,
  } = useSidebarExecutableTasksMap(projects, repositories, activeProjectId);
  const { projectTrellisReadyById, repositoryTrellisReadyById } = useSidebarTrellisReadyMap(
    projects,
    repositories,
  );
  const openScheduledTasksForRepository = useCallback(
    (repository: Repository) => {
      onOpenScheduledTasksForRepositoryProp?.(repository);
    },
    [onOpenScheduledTasksForRepositoryProp],
  );

  const openScheduledTasksForProject = useCallback(
    (project: ProjectItem) => {
      if (onOpenScheduledTasksForProjectProp) {
        onOpenScheduledTasksForProjectProp(project);
        return;
      }
      const target = resolveScheduledTasksRepository({
        activeRepository: null,
        activeProject: project,
        activeWorkspaceFocus: "project",
        repositories,
        scheduledTasksByRepoId,
      });
      if (target) openScheduledTasksForRepository(target);
    },
    [
      onOpenScheduledTasksForProjectProp,
      openScheduledTasksForRepository,
      repositories,
      scheduledTasksByRepoId,
    ],
  );

  const dispatchOpenExecutableTasksDrawer = useCallback(() => {
    notifySplitTodoCountUpdated({ openTaskDrawer: true, source: "trellis" });
  }, []);

  const openFloatingRepositoryTrellis = useCallback(
    (repository: Repository) => {
      onOpenProjectTrellis?.({
        id: `repo:${repository.id}`,
        name: repositoryFolderBasename(repository),
        repositoryIds: [repository.id],
        createdAt: 0,
        updatedAt: 0,
        rootPath: repository.path,
        sddMode: "wise_trellis",
      });
    },
    [onOpenProjectTrellis],
  );

  const openExecutableTasksForProject = useCallback(
    async (project: ProjectItem) => {
      await Promise.resolve(onCreateProjectTask(project, "chat"));
      dispatchOpenExecutableTasksDrawer();
    },
    [dispatchOpenExecutableTasksDrawer, onCreateProjectTask],
  );

  const openExecutableTasksForRepository = useCallback(
    async (repository: Repository) => {
      await Promise.resolve(onCreateRepositoryTask(repository, "chat"));
      dispatchOpenExecutableTasksDrawer();
    },
    [dispatchOpenExecutableTasksDrawer, onCreateRepositoryTask],
  );

  const handleFilesExplorerSectionCollapsedChange = useCallback((next: boolean) => {
    setFilesExplorerSectionCollapsed(next);
    writeLeftFilesExplorerCollapsedToStorage(next);
  }, []);

  const handleWorkspaceListSectionCollapsedChange = useCallback((next: boolean) => {
    setWorkspaceListSectionCollapsed(next);
    writeLeftWorkspaceListCollapsedToStorage(next);
  }, []);

  useEffect(() => {
    if (restoreWorkspaceListVisibilityRef.current) return;
    if (projects.length === 0) return;
    const shouldReveal = shouldRevealWorkspaceListOnRestore(projects, {
      activeProjectId,
      activeRepositoryId,
      activeWorkspaceFocus,
    });
    if (!shouldReveal) return;
    restoreWorkspaceListVisibilityRef.current = true;
    if (workspaceListSectionCollapsed) {
      handleWorkspaceListSectionCollapsedChange(false);
    }
  }, [
    activeProjectId,
    activeRepositoryId,
    activeWorkspaceFocus,
    handleWorkspaceListSectionCollapsedChange,
    projects,
    workspaceListSectionCollapsed,
  ]);

  const handleMonitorPanelSectionCollapsedChange = useCallback((next: boolean) => {
    setMonitorPanelSectionCollapsed(next);
    writeLeftMonitorPanelCollapsedToStorage(next);
  }, []);

  const handleLeftBottomTabChange = useCallback(
    (tab: LeftBottomTab) => {
      startTransition(() => {
        setLeftBottomTab(tab);
        writeLeftBottomTabToStorage(tab);
        if (tab === "files" && filesExplorerSectionCollapsed) {
          handleFilesExplorerSectionCollapsedChange(false);
        }
      });
    },
    [filesExplorerSectionCollapsed, handleFilesExplorerSectionCollapsedChange],
  );

  useEffect(() => {
    if (expandedFilesPanelOnMountRef.current) return;
    const needsFiles =
      repoPanelRenderState.showFilesOnLeft || repoPanelRenderState.showFilesOnRight;
    if (!needsFiles || !filesExplorerSectionCollapsed) return;
    expandedFilesPanelOnMountRef.current = true;
    handleFilesExplorerSectionCollapsedChange(false);
  }, [
    repoPanelRenderState.showFilesOnLeft,
    repoPanelRenderState.showFilesOnRight,
    filesExplorerSectionCollapsed,
    handleFilesExplorerSectionCollapsedChange,
  ]);

  const repoPanelTabSwitcher = useMemo(
    () => (
      <LeftSidebarBottomTabSwitcher
        activeTab={leftBottomTab}
        onChange={handleLeftBottomTabChange}
      />
    ),
    [handleLeftBottomTabChange, leftBottomTab],
  );

  const globalWorkspaceTreeSelection = useMemo(
    () =>
      globalWorkspaceToTreeSelection({
        activeWorkspaceFocus,
        activeProjectId,
        activeRepositoryId,
      }),
    [activeWorkspaceFocus, activeProjectId, activeRepositoryId],
  );

  const activeSessionRepositoryPath = useMemo(() => {
    if (!activeSessionId) return "";
    const raw = sessionsLatestRef.current
      .find((s) => s.id === activeSessionId)
      ?.repositoryPath?.trim();
    if (!raw) return "";
    return normalizeSessionRepositoryPath(raw);
  }, [activeSessionId]);

  const sessionDerivedTreeSelection = useMemo((): WorkspaceRepositoryTreeSelection | null => {
    if (!activeSessionRepositoryPath) return null;
    const liveSession = activeSessionId
      ? (sessionsLatestRef.current.find((s) => s.id === activeSessionId) ?? null)
      : null;
    if (!liveSession?.repositoryPath?.trim()) return null;
    const repo = resolveRepositoryForSession({
      session: liveSession,
      repositories,
      bindings: repositoryMainSessionBindings,
      sessions: sessionsLatestRef.current,
      preferredRepositoryId: activeRepositoryId ?? undefined,
    });
    if (repo) return { kind: "repository", repositoryId: repo.id };
    return null;
  }, [
    activeSessionId,
    activeSessionRepositoryPath,
    repositories,
    repositoryMainSessionBindings,
    activeRepositoryId,
  ]);

  const repoPanelTreeSelectionSource = useMemo((): WorkspaceRepositoryTreeSelection | null => {
    // 侧栏选中具体仓库时，Git/文件树默认对齐该仓库（含多仓工作区成员仓）。
    if (activeWorkspaceFocus === "repository" && activeRepositoryId != null) {
      return { kind: "repository", repositoryId: activeRepositoryId };
    }
    // 多仓工作区 + 工作区焦点：Git 面板保持工作区级多仓视图。
    if (
      (repoPanelRenderState.showGitOnLeft || repoPanelRenderState.showGitOnRight) &&
      activeProjectId
    ) {
      const project = projects.find((item) => item.id === activeProjectId) ?? null;
      if (project && isMultiRepoProject(project, projects)) {
        return { kind: "project", projectId: project.id };
      }
    }
    return globalWorkspaceTreeSelection ?? sessionDerivedTreeSelection ?? null;
  }, [
    repoPanelRenderState.showGitOnLeft,
    repoPanelRenderState.showGitOnRight,
    activeProjectId,
    activeRepositoryId,
    activeWorkspaceFocus,
    projects,
    globalWorkspaceTreeSelection,
    sessionDerivedTreeSelection,
  ]);

  const globalSelectionSyncKey = useMemo(() => {
    const selection = repoPanelTreeSelectionSource;
    if (!selection) return null;
    return selection.kind === "project"
      ? `project:${selection.projectId}`
      : `repo:${selection.repositoryId}`;
  }, [repoPanelTreeSelectionSource]);

  const repoPanelTreeSelectionSourceRef = useRef(repoPanelTreeSelectionSource);
  repoPanelTreeSelectionSourceRef.current = repoPanelTreeSelectionSource;

  useEffect(() => {
    if (!globalSelectionSyncKey) return;
    if (globalSelectionSyncKey === lastSyncedGlobalSelectionKeyRef.current) return;
    lastSyncedGlobalSelectionKeyRef.current = globalSelectionSyncKey;
    const next = repoPanelTreeSelectionSourceRef.current;
    startTransition(() => {
      setRepoPanelTreeSelection((prev) => {
        if (!next && !prev) return prev;
        if (!next || !prev) return next;
        if (prev.kind === "project" && next.kind === "project" && prev.projectId === next.projectId) {
          return prev;
        }
        if (
          prev.kind === "repository" &&
          next.kind === "repository" &&
          prev.repositoryId === next.repositoryId
        ) {
          return prev;
        }
        return next;
      });
    });
  }, [globalSelectionSyncKey]);

  const repoPanelTreeView = useMemo(() => {
    if (!repoPanelTreeSelection) return null;
    return resolveWorkspaceRepositoryTreeSelectionView(
      repoPanelTreeSelection,
      projects,
      repositories,
    );
  }, [repoPanelTreeSelection, projects, repositories]);

  const repoPanelRepositoryPath =
    repoPanelTreeView?.path.trim() ||
    activeSessionRepositoryPath ||
    (activeRepositoryPath?.trim() ? normalizeSessionRepositoryPath(activeRepositoryPath) : "");
  const activeSessionRepositoryName = useMemo(() => {
    if (!activeSessionId) return "";
    return sessionsLatestRef.current.find((s) => s.id === activeSessionId)?.repositoryName?.trim() ?? "";
  }, [activeSessionId]);

  const repoPanelRepositoryName =
    repoPanelTreeView?.label.trim() ||
    activeRepositoryName?.trim() ||
    activeSessionRepositoryName ||
    repositoryFolderBasename({ path: repoPanelRepositoryPath, name: activeRepositoryName ?? "" });
  const [accessibleRepoPanelPath, setAccessibleRepoPanelPath] = useState(repoPanelRepositoryPath);

  useEffect(() => {
    const candidate = repoPanelRepositoryPath.trim();
    if (!candidate) return;
    setAccessibleRepoPanelPath((prev) => (prev === candidate ? prev : candidate));
  }, [repoPanelRepositoryPath]);

  useEffect(() => {
    let cancelled = false;
    const candidate = repoPanelRepositoryPath.trim();
    if (!candidate) {
      setAccessibleRepoPanelPath("");
      return;
    }
    const cachedAccessible = readPathAccessibilityCache(candidate);
    if (cachedAccessible === true) {
      setAccessibleRepoPanelPath(candidate);
      return;
    }
    const cancelIdle = runWhenIdle(() => {
      if (cancelled) return;
      void (async () => {
        if (cachedAccessible !== false && (await pathIsAccessibleDirectoryCached(candidate))) {
          if (!cancelled) setAccessibleRepoPanelPath(candidate);
          return;
        }
      const projectIdForFallback =
        repoPanelTreeView?.activeProjectId ?? activeProjectId ?? null;
      const project = projectIdForFallback
        ? (projects.find((item) => item.id === projectIdForFallback) ?? null)
        : null;
      if (project) {
        const repoById = new Map(repositories.map((repo) => [repo.id, repo] as const));
        for (const repoId of project.repositoryIds ?? []) {
          const memberPath = repoById.get(repoId)?.path?.trim() ?? "";
          if (memberPath && (await pathIsAccessibleDirectoryCached(memberPath))) {
            if (!cancelled) setAccessibleRepoPanelPath(memberPath);
            return;
          }
        }
      }
      if (
        activeSessionRepositoryPath &&
        activeSessionRepositoryPath !== candidate &&
        (await pathIsAccessibleDirectoryCached(activeSessionRepositoryPath))
      ) {
        if (!cancelled) setAccessibleRepoPanelPath(activeSessionRepositoryPath);
        return;
      }
      if (!cancelled) setAccessibleRepoPanelPath(candidate);
      })();
    }, { timeoutMs: 1200 });
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [
    repoPanelRepositoryPath,
    repoPanelTreeView?.activeProjectId,
    activeProjectId,
    projects,
    repositories,
    activeSessionRepositoryPath,
  ]);

  const effectiveRepoPanelPath = accessibleRepoPanelPath.trim() || repoPanelRepositoryPath.trim();

  const claudeToolsScopePath = useMemo(() => {
    const project = activeProjectId
      ? (projects.find((item) => item.id === activeProjectId) ?? null)
      : null;
    const repository =
      activeRepositoryId != null
        ? (repositories.find((item) => item.id === activeRepositoryId) ?? null)
        : null;
    const skillsAnchor = resolveClaudeProjectSkillsScopePath({
      activeWorkspaceFocus,
      activeProject: project,
      activeRepository: repository,
      repositories,
    });
    if (skillsAnchor) return skillsAnchor;
    return effectiveRepoPanelPath.trim() || activeRepositoryPath?.trim() || "";
  }, [
    activeProjectId,
    activeRepositoryId,
    activeWorkspaceFocus,
    projects,
    repositories,
    effectiveRepoPanelPath,
    activeRepositoryPath,
  ]);

  const showLeftRepoPanel = Boolean(
    effectiveRepoPanelPath &&
      (gitPanelPlacement === "left" || filesPanelPlacement === "left"),
  );
  const showRepoPanel = Boolean(effectiveRepoPanelPath);

  const handleOpenExplorerFile = useCallback(
    (relativePath: string, options?: GitPanelOpenFileOptions) => {
      const root = effectiveRepoPanelPath.trim();
      if (!root) {
        message.warning("请先选择工作区或仓库");
        return;
      }
      onOpenActiveRepositoryFile?.(relativePath, {
        ...options,
        fromFileTree: true,
        fileRootPath: options?.fileRootPath?.trim() || root,
      });
    },
    [effectiveRepoPanelPath, message, onOpenActiveRepositoryFile],
  );

  const gitPanelRepositoryEntries = useMemo(
    () =>
      resolveGitPanelRepositoryEntries({
        treeSelection: repoPanelTreeSelection,
        projects,
        repositories,
        fallbackPath: effectiveRepoPanelPath,
        fallbackName: repoPanelRepositoryName,
        fallbackRepositoryId: repoPanelTreeView?.activeRepositoryId ?? activeRepositoryId,
      }),
    [
      repoPanelTreeSelection,
      projects,
      repositories,
      effectiveRepoPanelPath,
      repoPanelRepositoryName,
      repoPanelTreeView?.activeRepositoryId,
      activeRepositoryId,
    ],
  );

  const gitPanelContextTitle = useMemo(() => {
    if (repoPanelTreeView?.label.trim()) return repoPanelTreeView.label.trim();
    if (repoPanelTreeSelection?.kind === "project") {
      const project = projects.find((item) => item.id === repoPanelTreeSelection.projectId);
      return project?.name?.trim() || "变更";
    }
    return "变更";
  }, [repoPanelTreeSelection, repoPanelTreeView?.label, projects]);

  const repoPanelWorkspaceSelectorProps = useMemo(
    () => ({
      projects,
      repositories,
      directoryOnly: true as const,
      treeSelection: repoPanelTreeSelection,
      activeProjectId: repoPanelTreeView?.activeProjectId ?? activeProjectId,
      activeRepositoryId: repoPanelTreeView?.activeRepositoryId ?? activeRepositoryId,
      activeWorkspaceFocus: repoPanelTreeView?.activeWorkspaceFocus ?? activeWorkspaceFocus,
      onRepositorySelect: (repositoryId: number) => {
        startTransition(() => {
          setRepoPanelTreeSelection({ kind: "repository", repositoryId });
        });
      },
      onProjectSelect: (projectId: string) => {
        startTransition(() => {
          setRepoPanelTreeSelection({ kind: "project", projectId });
        });
      },
    }),
    [
      projects,
      repositories,
      repoPanelTreeSelection,
      repoPanelTreeView,
      activeProjectId,
      activeRepositoryId,
      activeWorkspaceFocus,
    ],
  );

  useEffect(() => {
    setRepositoryFileTreeSearch("");
  }, [effectiveRepoPanelPath]);

  /**
   * 侧栏工作区/仓库点击需要立即驱动左下 Git/文件树目录同步，
   * 不能仅依赖全局 active* 变化（同 key 点击时不会触发）。
   */
  const handleProjectSelectAndSyncRepoPanel = useCallback(
    (projectId: string) => {
      startTransition(() => {
        setRepoPanelTreeSelection({ kind: "project", projectId });
        onProjectSelect(projectId);
      });
    },
    [onProjectSelect],
  );

  const handleRepositorySelectAndSyncRepoPanel = useCallback(
    (repositoryId: number | null) => {
      startTransition(() => {
        if (repositoryId == null) {
          setRepoPanelTreeSelection(null);
          onRepositorySelect(null);
          return;
        }
        setRepoPanelTreeSelection({ kind: "repository", repositoryId });
        onRepositorySelect(repositoryId);
      });
    },
    [onRepositorySelect],
  );

  const lastHandledWorkspaceCreateRequestRef = useRef(0);
  const lastHandledStandaloneRepoAddRequestRef = useRef(0);

  useEffect(() => {
    if (!workspaceCreateRequest) return;
    if (workspaceCreateRequest <= lastHandledWorkspaceCreateRequestRef.current) return;
    lastHandledWorkspaceCreateRequestRef.current = workspaceCreateRequest;
    setProjectNameInput("");
    setCreateProjectRootPath("");
    setWorkspaceBootstrapSelection({ ...DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION });
    setCreateProjectOpen(true);
  }, [workspaceCreateRequest]);

  useEffect(() => {
    if (!standaloneRepoAddRequest || !onAddFloatingRepository) return;
    if (standaloneRepoAddRequest <= lastHandledStandaloneRepoAddRequestRef.current) return;
    lastHandledStandaloneRepoAddRequestRef.current = standaloneRepoAddRequest;
    openAddFloatingRepositoryModal();
  }, [onAddFloatingRepository, openAddFloatingRepositoryModal, standaloneRepoAddRequest]);

  async function submitCreateProject() {
    const name = projectNameInput.trim();
    if (!name) {
      message.warning("工作区名称不能为空");
      return;
    }
    if (!createProjectRootPath.trim()) {
      message.warning("请先选择工作区根目录");
      return;
    }
    if (createProjectSubmitting) return;
    setCreateProjectSubmitting(true);
    try {
      await Promise.resolve(
        onCreateProject(name, {
          bootstrap: workspaceBootstrapSelection,
          rootPath: createProjectRootPath.trim(),
        }),
      );
      setProjectNameInput("");
      setCreateProjectRootPath("");
      setCreateProjectOpen(false);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCreateProjectSubmitting(false);
    }
  }

  function submitUpdateProject() {
    if (!editProject) return;
    const name = projectNameInput.trim();
    if (!name) {
      message.warning("工作区名称不能为空");
      return;
    }
    onUpdateProject(editProject.id, name);
    setEditProject(null);
    setProjectNameInput("");
  }

  function submitPromoteFloatingRepository() {
    if (!promotingFloatingRepo) return;
    const trimmed = promotingFloatingRepoName.trim();
    if (!trimmed) {
      message.warning("请输入工作区名称");
      return;
    }
    if (!onPromoteFloatingRepositoryToProject) {
      message.warning("当前环境未启用「升格为工作区」");
      return;
    }
    const repoId = promotingFloatingRepo.id;
    setPromotingFloatingRepo(null);
    setPromotingFloatingRepoName("");
    void Promise.resolve(onPromoteFloatingRepositoryToProject(repoId, trimmed)).catch(
      (err: unknown) => {
        message.error("升格为工作区失败");
        console.error(err);
      },
    );
  }

  const leftTabSwitcherPrefix = repoPanelRenderState.leftTabMode ? repoPanelTabSwitcher : null;

  const leftSidebarGitBottomPane = useMemo(
    () => (
      <Suspense
        fallback={
          <div className="app-file-editor-loading">
            <Spin size="small" />
          </div>
        }
      >
        <GitPanelLazy
          headerPrefix={
            workspaceListSectionCollapsed ? undefined : leftTabSwitcherPrefix ?? undefined
          }
          repositoryPath={effectiveRepoPanelPath}
          repositoryName={repoPanelRepositoryName}
          repositoryEntries={gitPanelRepositoryEntries}
          multiRepoContextTitle={gitPanelContextTitle}
          onOpenFile={handleOpenExplorerFile}
          lazyMount
          {...repoPanelWorkspaceSelectorProps}
        />
      </Suspense>
    ),
    [
      effectiveRepoPanelPath,
      gitPanelContextTitle,
      gitPanelRepositoryEntries,
      handleOpenExplorerFile,
      leftTabSwitcherPrefix,
      repoPanelRepositoryName,
      repoPanelWorkspaceSelectorProps,
      workspaceListSectionCollapsed,
    ],
  );

  const leftSidebarFilesBottomPane = useMemo(
    () => (
      <ActiveRepositoryFilesPanel
        headerPrefix={leftTabSwitcherPrefix ?? undefined}
        activeRepositoryPath={effectiveRepoPanelPath}
        activeRepositoryName={repoPanelRepositoryName}
        search={repositoryFileTreeSearch}
        onSearchChange={setRepositoryFileTreeSearch}
        onOpenFile={handleOpenExplorerFile}
        sectionCollapsed={filesExplorerSectionCollapsed}
        onSectionCollapsedChange={handleFilesExplorerSectionCollapsedChange}
        workspaceSelector={repoPanelWorkspaceSelectorProps}
      />
    ),
    [
      effectiveRepoPanelPath,
      filesExplorerSectionCollapsed,
      handleFilesExplorerSectionCollapsedChange,
      handleOpenExplorerFile,
      leftTabSwitcherPrefix,
      repoPanelRepositoryName,
      repoPanelWorkspaceSelectorProps,
      repositoryFileTreeSearch,
    ],
  );

  const rightSidebarGitBottomPane = useMemo(
    () => (
      <div className="app-right-panel-git-explorer">
        <Suspense
          fallback={
            <div className="app-file-editor-loading">
              <Spin size="small" />
            </div>
          }
        >
          <GitPanelLazy
            repositoryPath={effectiveRepoPanelPath}
            repositoryName={repoPanelRepositoryName}
            repositoryEntries={gitPanelRepositoryEntries}
            multiRepoContextTitle={gitPanelContextTitle}
            onOpenFile={handleOpenExplorerFile}
            lazyMount
            {...repoPanelWorkspaceSelectorProps}
          />
        </Suspense>
      </div>
    ),
    [
      effectiveRepoPanelPath,
      gitPanelContextTitle,
      gitPanelRepositoryEntries,
      handleOpenExplorerFile,
      repoPanelRepositoryName,
      repoPanelWorkspaceSelectorProps,
    ],
  );

  const rightSidebarFilesBottomPane = useMemo(
    () => (
      <ActiveRepositoryFilesPanel
        activeRepositoryPath={effectiveRepoPanelPath}
        activeRepositoryName={repoPanelRepositoryName}
        search={repositoryFileTreeSearch}
        onSearchChange={setRepositoryFileTreeSearch}
        onOpenFile={handleOpenExplorerFile}
        sectionCollapsed={filesExplorerSectionCollapsed}
        onSectionCollapsedChange={handleFilesExplorerSectionCollapsedChange}
        workspaceSelector={repoPanelWorkspaceSelectorProps}
        variant="right-rail"
      />
    ),
    [
      effectiveRepoPanelPath,
      filesExplorerSectionCollapsed,
      handleFilesExplorerSectionCollapsedChange,
      handleOpenExplorerFile,
      repoPanelRepositoryName,
      repoPanelWorkspaceSelectorProps,
      repositoryFileTreeSearch,
    ],
  );

  const rightRepositoryRepoPanel = useMemo(() => {
    if (!showRepoPanel || !repoPanelRenderState.usesRightRail) return null;
    if (!repoPanelRenderState.showGitOnRight && !repoPanelRenderState.showFilesOnRight) {
      return null;
    }
    if (repoPanelRenderState.rightTabMode) {
      return (
        <div className="app-right-repo-panel">
          <div className="app-right-repo-panel-tabs">{repoPanelTabSwitcher}</div>
          <RightRailRepoPanelPanes
            showGit={repoPanelRenderState.showGitOnRight}
            showFiles={repoPanelRenderState.showFilesOnRight}
            gitPane={rightSidebarGitBottomPane}
            filesPane={rightSidebarFilesBottomPane}
          />
        </div>
      );
    }
    return (
      <div className="app-right-repo-panel app-right-repo-panel--split">
        {repoPanelRenderState.showGitOnRight ? rightSidebarGitBottomPane : null}
        {repoPanelRenderState.showFilesOnRight ? rightSidebarFilesBottomPane : null}
      </div>
    );
  }, [
    repoPanelRenderState.rightTabMode,
    repoPanelRenderState.showFilesOnRight,
    repoPanelRenderState.showGitOnRight,
    repoPanelRenderState.usesRightRail,
    repoPanelTabSwitcher,
    rightSidebarFilesBottomPane,
    rightSidebarGitBottomPane,
    showRepoPanel,
  ]);

  useEffect(() => {
    if (!onRepositoryRepoPanelChange) return;
    onRepositoryRepoPanelChange(rightRepositoryRepoPanel);
    return () => {
      onRepositoryRepoPanelChange(null);
    };
  }, [onRepositoryRepoPanelChange, rightRepositoryRepoPanel]);

  return (
    <Layout.Sider
      width={siderWidth}
      collapsedWidth={0}
      collapsed={collapsed || parked}
      className={`app-left-sidebar${parked ? " app-left-sidebar--parked" : ""}`}
      theme={dark ? "dark" : "light"}
      onMouseEnter={chromePanelHoverHandlers.onMouseEnter}
      onMouseLeave={chromePanelHoverHandlers.onMouseLeave}
    >
      <LeftSidebarTopbar
        authorDisabled={authorDisabled}
        authorTooltip={authorDisabledTooltip}
        activeRepositoryPath={claudeToolsScopePath || activeRepositoryPath}
        activeRepositoryId={activeRepositoryId}
        onOpenAuthor={onOpenAuthor}
      />

      {taskCardsNavProps ? (
        <TaskCardsNav {...taskCardsNavProps} />
      ) : null}

      <LeftSidebarHubQuickEntries
        enabledEntryIds={leftSidebarHubQuickEntryIds}
        mcpHubActive={mcpHubActive}
        skillsHubActive={skillsHubActive}
        automationHubActive={automationHubActive}
        assistantsHubActive={assistantsHubActive}
        claudePluginsHubActive={claudePluginsHubActive}
        onOpenMcpHub={onOpenMcpHub}
        onOpenSkillsHub={onOpenSkillsHub}
        onOpenAutomationHub={onOpenAutomationHub}
        onOpenAssistantsHub={onOpenAssistantsHub}
        onOpenClaudePluginsHub={onOpenClaudePluginsHub}
      />

      <div
        className="app-left-sidebar-project-and-files"
        data-has-files-explorer={showRepoPanel ? "true" : "false"}
        data-files-explorer-section-collapsed={
          showRepoPanel && filesExplorerSectionCollapsed ? "true" : undefined
        }
        data-workspace-list-section-collapsed={
          showRepoPanel && workspaceListSectionCollapsed ? "true" : undefined
        }
        data-monitor-panel-section-collapsed={
          showLeftSidebarMonitorPanel && monitorPanelSectionCollapsed ? "true" : undefined
        }
      >
        <SidebarWorkspaceTodoAddModal enabled={workspaceTodosEnabled} />
        <SidebarGlobalWorkspaceTodoAddModal
          enabled={workspaceTodosEnabled}
          open={globalWorkspaceTodoAddOpen}
          onClose={() => setGlobalWorkspaceTodoAddOpen(false)}
          projects={projects}
          repositoriesById={projectRepositoryState.repositoriesById}
          floatingRepositories={floatingRepositories}
          activeProjectId={activeProjectId}
          activeRepositoryId={activeRepositoryId}
        />
        <ProjectRepositoryList
          projects={projects}
          repositoriesById={projectRepositoryState.repositoriesById}
          floatingRepositories={floatingRepositories}
          activeProjectId={activeProjectId}
          activeWorkspaceFocus={activeWorkspaceFocus}
          activeRepositoryId={activeRepositoryId}
          pinnedProjectIds={pinnedProjectIds}
          expandedProjects={projectRepositoryState.expandedProjects}
          projectDropTargetId={projectRepositoryState.projectDropTargetId}
          repoSidebarDragRef={projectRepositoryState.repoSidebarDragRef}
          onProjectSelect={handleProjectSelectAndSyncRepoPanel}
          onRepositorySelect={handleRepositorySelectAndSyncRepoPanel}
          onCreateProjectClick={() => {
            setProjectNameInput("");
            setCreateProjectRootPath("");
            setWorkspaceBootstrapSelection({ ...DEFAULT_WORKSPACE_BOOTSTRAP_SELECTION });
            setCreateProjectOpen(true);
          }}
          onAddFloatingRepositoryClick={
            onAddFloatingRepository ? openAddFloatingRepositoryModal : undefined
          }
          onAddRepositoryToProjectClick={
            onAddRepositoryToProject ? openAddRepositoryModal : undefined
          }
          onReconcileProject={onReconcileProject}
          onBootstrapTrellisForProject={onBootstrapTrellisForProject}
          onBootstrapTrellisForRepository={onBootstrapTrellisForRepository}
          projectTrellisReadyById={projectTrellisReadyById}
          repositoryTrellisReadyById={repositoryTrellisReadyById}
          onToggleProjectExpand={projectRepositoryState.toggleProjectExpand}
          onTogglePinProject={onTogglePinProject}
          onRenameProject={(project) => {
            setEditProject(project);
            setProjectNameInput(project.name);
          }}
          onDeleteProject={(project) => {
            modal.confirm({
              title: "确认删除项目？",
              content: `工作区「${project.name}」将被删除，但仓库本身不会被移除。`,
              okText: "删除",
              okType: "danger",
              cancelText: "取消",
              onOk: async () => {
                try {
                  await onDeleteProject(project.id);
                } catch (err: unknown) {
                  const detail = err instanceof Error ? err.message : String(err);
                  message.error(`删除工作区失败：${detail}`);
                  throw err;
                }
              },
            });
          }}
          onOpenPromptsProject={onOpenPromptsProject}
          onOpenProjectTrellis={onOpenProjectTrellis}
          onOpenFloatingRepositoryTrellis={onOpenProjectTrellis ? openFloatingRepositoryTrellis : undefined}
          onCreateProjectTask={onCreateProjectTask}
          onCreateRepositoryTask={onCreateRepositoryTask}
          onOpenWorkspaceRequirements={onOpenWorkspaceRequirements}
          onOpenRepositoryRequirements={
            onOpenRepositoryRequirementsProp ?? ((repository) => onCreateRepositoryTask(repository, "split"))
          }
          onOpenInFinder={onOpenInFinder}
          onOpenProjectInFinder={onOpenProjectInFinder}
          onOpenInTerminal={onOpenInTerminal}
          onOpenProjectInTerminal={onOpenProjectInTerminal}
          onOpenRepositoryInBrowser={onOpenRepositoryInBrowser}
          openRepositoryInPreferredEditor={openRepositoryInPreferredEditor}
          openProjectInPreferredEditor={openProjectInPreferredEditor}
          onOpenPromptsRepository={onOpenPromptsRepository}
          onOpenRepositoryMainOwner={onOpenRepositoryMainOwner}
          onConfigureRepositoryMainSessionRun={onConfigureRepositoryMainSessionRun}
          onStartRepositoryRunCommand={onStartRepositoryRunCommand}
          onStopRepositoryRunCommand={onStopRepositoryRunCommand}
          onConfigureRepositorySddMode={onUpdateRepositorySddMode ? repositorySddModeModal.open : undefined}
          onConfigureProjectSddMode={onUpdateProjectSddMode ? projectSddModeModal.open : undefined}
          onConfigureRepositoryOpenApp={
            onUpdateRepositoryOpenAppId ? handleConfigureRepositoryOpenApp : undefined
          }
          onConfigureProjectOpenApp={
            onUpdateProjectOpenAppId ? handleConfigureProjectOpenApp : undefined
          }
          onNewPaneSessionForRepository={onNewPaneSessionForRepository}
          onNewPaneSessionForProject={onNewPaneSessionForProject}
          onPromoteFloatingRepository={
            onPromoteFloatingRepositoryToProject
              ? (repo) => {
                  setPromotingFloatingRepo(repo);
                  setPromotingFloatingRepoName(repositoryFolderBasename(repo));
                }
              : undefined
          }
          onJoinFloatingRepository={undefined}
          onRemoveFloatingRepository={(repo) => {
            if (!onRemoveRepository) return;
            modal.confirm({
              title: "确认移除单仓？",
              content: `单仓「${repositoryFolderBasename(repo)}」将从 Wise 列表移除（不会删除磁盘文件，也不会动 .trellis）。`,
              okText: "移除",
              okType: "danger",
              cancelText: "取消",
              onOk: () => onRemoveRepository(repo),
            });
          }}
          onDetachRepositoryFromProject={onDetachRepositoryFromProject}
          onReorderRepositoriesInProject={onReorderRepositoriesInProject}
          onMoveRepositoryToProject={undefined}
          onMoveRepositoryToProjectWithExpand={projectRepositoryState.moveRepositoryWithExpand}
          onProjectDropTargetChange={projectRepositoryState.setProjectDropTargetId}
          onClearRepoSidebarDrag={projectRepositoryState.clearRepoSidebarDrag}
          onMoveRepositoryError={(text, err) => {
            message.error(text);
            console.error(err);
          }}
          scheduledTasksByRepoId={scheduledTasksByRepoId}
          requirementUnsplitByProjectId={requirementUnsplitByProjectId}
          requirementUnsplitByRepoId={requirementUnsplitByRepoId}
          executableTasksByProjectId={executableTasksByProjectId}
          executableTasksByRepoId={executableTasksByRepoId}
          workspaceTodosEnabled={workspaceTodosEnabled}
          onOpenGlobalWorkspaceTodoAdd={
            workspaceTodosEnabled ? () => setGlobalWorkspaceTodoAddOpen(true) : undefined
          }
          onOpenScheduledTasksForRepository={openScheduledTasksForRepository}
          onOpenScheduledTasksForProject={openScheduledTasksForProject}
          onOpenExecutableTasksForProject={openExecutableTasksForProject}
          onOpenExecutableTasksForRepository={openExecutableTasksForRepository}
          runningMainSessionByProjectId={runningByProjectId}
          runningMainSessionByRepositoryId={runningByRepositoryId}
          onStopProjectMainSession={handleStopProjectMainSession}
          onStopRepositoryMainSession={handleStopRepositoryMainSession}
          sectionCollapsed={showRepoPanel ? workspaceListSectionCollapsed : false}
          onSectionCollapsedChange={
            showRepoPanel ? handleWorkspaceListSectionCollapsedChange : undefined
          }
        />

        {monitorPanelMounted ? (
          <LeftSidebarMonitorPanelSlot
            visible={showLeftSidebarMonitorPanel}
            monitorPanelSectionCollapsed={monitorPanelSectionCollapsed}
            onMonitorPanelSectionCollapsedChange={handleMonitorPanelSectionCollapsedChange}
            monitorPanelSessions={monitorPanelSessions ?? sessions}
            transcriptSourceSessions={sessions}
            employeeMonitorItems={employeeMonitorItems}
            repositoryMemberMonitorItems={repositoryMemberMonitorItems}
            sessionConversationTaskItems={sessionConversationTaskItems}
            showSessionConversationTasks
            executionEnvironmentDispatchHistoryDays={executionEnvironmentDispatchHistoryDays}
            onExecutionEnvironmentDispatchHistoryDaysChange={
              onExecutionEnvironmentDispatchHistoryDaysChange
            }
            executionEnvironmentDispatchHistoryDaysSaving={executionEnvironmentDispatchHistoryDaysSaving}
            teamMonitorItems={teamMonitorItems}
            activeSessionId={activeSessionId}
            monitorActiveTarget={monitorActiveTarget}
            onOpenTeamMonitorDetail={onOpenTeamMonitorDetail}
            onOpenEmployeeConfig={onOpenEmployeeConfig}
            onOpenWorkflowConfig={onOpenWorkflowConfig}
            onStopEmployeeMonitor={onStopEmployeeMonitor}
            onStopTeamMonitor={onStopTeamMonitor}
            hideEmployeeUi={hideEmployeeUi}
            onCancelSessionFromMonitor={onCancelSessionFromMonitor}
            onOpenTaskDetailFromMonitor={onOpenTaskDetailFromMonitor}
            onOpenOmcBatchInvocationDetail={onOpenOmcBatchInvocationDetail}
            onCancelOmcDirectBatchInvocation={onCancelOmcDirectBatchInvocation}
            onStopSessionConversationTask={onStopSessionConversationTask}
            onReloadFullDiskTranscript={onReloadFullDiskTranscript}
            onRefreshHistorySessions={onRefreshHistorySessions}
            onCompactSessionHistory={onCompactSessionHistory}
            projectId={projectId}
            historyDrawerSessionId={historyDrawerSessionId}
            onHistoryDrawerSessionIdChange={onHistoryDrawerSessionIdChange}
            onRestoreHistorySessionAsMain={onRestoreHistorySessionAsMain}
            onCreateTerminalEmployeeSession={onCreateTerminalEmployeeSession}
            onResumeSession={onResumeSession}
            onPrepareSessionForMonitorDrawer={onPrepareSessionForMonitorDrawer}
            repositoryMainSessionBindings={repositoryMainSessionBindings}
            repositories={repositories}
            monitorSessionsFingerprint={monitorSessionsFingerprint}
            transcriptSessionsFingerprint={transcriptSessionsFingerprint}
          />
        ) : null}

        {showLeftRepoPanel ? (
          <div className="app-left-sidebar-bottom-tabs">
            {repoPanelRenderState.showGitOnLeft && workspaceListSectionCollapsed ? (
              <div className="app-left-sidebar-repo-panel-header">
                {repoPanelRenderState.leftTabMode ? repoPanelTabSwitcher : null}
                <div className="app-left-sidebar-repo-panel-header__selector">
                  <GitPanelWorkspaceSelector
                    {...repoPanelWorkspaceSelectorProps}
                    activeRepositoryPath={effectiveRepoPanelPath}
                  />
                </div>
                <HoverHint title="展开工作区列表">
                  <button
                    type="button"
                    className="app-left-sidebar-repo-panel-header__expand-icon"
                    aria-label="展开工作区列表"
                    onClick={() => handleWorkspaceListSectionCollapsedChange(false)}
                  >
                    <ExpandIcon expanded={false} />
                  </button>
                </HoverHint>
              </div>
            ) : null}
            <LeftSidebarBottomTabPanes
              showGit={repoPanelRenderState.showGitOnLeft}
              showFiles={repoPanelRenderState.showFilesOnLeft}
              panelsReady={bottomTabPanelsReady}
              gitPane={leftSidebarGitBottomPane}
              filesPane={leftSidebarFilesBottomPane}
            />
          </div>
        ) : null}
      </div>

      <SystemResourceInline
        systemSummary={systemResourceSessions.systemSummary}
        systemSummaryError={systemResourceSessions.systemSummaryError}
        popoverOpen={systemResourceSessions.claudeCountPopoverOpen}
        onPopoverOpenChange={(nextOpen) => {
          systemResourceSessions.setClaudeCountPopoverOpen(nextOpen);
          if (!nextOpen) systemResourceSessions.setClaudeSystemSessionSearch("");
        }}
        searchValue={systemResourceSessions.claudeSystemSessionSearch}
        onSearchChange={systemResourceSessions.setClaudeSystemSessionSearch}
        matchedSessions={systemResourceSessions.matchedSystemInlineSessions}
        allSessions={sessions}
        projects={projects}
        repositories={repositories}
        repositoryMainSessionBindings={repositoryMainSessionBindings}
        claudeProcesses={systemResourceSessions.systemSummary.claudeProcesses}
        claudeProcessLabelCache={claudeProcessLabelCache}
        claudeProcessCount={systemResourceSessions.systemSummary.claudeProcessCount}
        onSelectSession={(sessionId) => {
          systemResourceSessions.setClaudeCountPopoverOpen(false);
          systemResourceSessions.setClaudeSystemSessionSearch("");
          systemResourceSessions.setSystemSessionDrawerId(sessionId);
        }}
        onEndSession={(rowSessionId) => {
          void endClaudeProcessPopoverRow(rowSessionId).then(finishClaudeProcessPopoverEnd, failClaudeProcessPopoverEnd);
        }}
        onBatchEndSessions={handleBatchEndClaudeProcessRows}
        drawerTitle={systemResourceSessions.systemSessionDrawerTitle}
        drawerOpen={systemResourceSessions.systemSessionDrawerId !== null}
        onCloseDrawer={() => systemResourceSessions.setSystemSessionDrawerId(null)}
        drawerWidth={systemResourceSessions.systemSessionDrawerWidth}
        liveDrawerSession={systemResourceSessions.liveSystemDrawerSession}
        drawerRegistryOrphanSid={systemResourceSessions.drawerRegistryOrphanSid}
        drawerRegistryOrphanInfo={systemResourceSessions.drawerRegistryOrphanInfo}
        drawerHostProcess={systemResourceSessions.drawerHostProcess}
        canStopLiveDrawerSession={systemResourceSessions.canStopSystemDrawerSession}
        onCancelLiveDrawerSession={onCancelSessionFromMonitor}
        onCancelRegistryOrphanSession={(sid) => {
          void cancelClaudeExecution(sid).then(
            () => {
              systemResourceSessions.setSystemSessionDrawerId(null);
            },
            (err: unknown) => {
              message.error(err instanceof Error ? err.message : "终止失败");
            },
          );
        }}
        onOpenTaskDetailFromMonitor={onOpenTaskDetailFromMonitor}
      />

      <ProjectNameModals
        createOpen={createProjectOpen}
        createProjectRootPath={createProjectRootPath}
        createSubmitLoading={createProjectSubmitting}
        onPickCreateProjectRoot={async () => {
          const picked = await pickFolder();
          if (!picked) return;
          const previousBasename = repositoryFolderBasename(createProjectRootPath);
          const currentName = projectNameInput.trim();
          setCreateProjectRootPath(picked);
          if (!currentName || currentName === previousBasename) {
            setProjectNameInput(repositoryFolderBasename(picked));
          }
        }}
        workspaceBootstrapSelection={workspaceBootstrapSelection}
        onWorkspaceBootstrapSelectionChange={setWorkspaceBootstrapSelection}
        editProject={editProject}
        projectNameInput={projectNameInput}
        onProjectNameInputChange={setProjectNameInput}
        onCancelCreate={() => {
          if (createProjectSubmitting) return;
          setCreateProjectOpen(false);
          setProjectNameInput("");
          setCreateProjectRootPath("");
        }}
        onCancelEdit={() => {
          setEditProject(null);
          setProjectNameInput("");
        }}
        onSubmitCreate={submitCreateProject}
        onSubmitEdit={submitUpdateProject}
        promotingRepository={promotingFloatingRepo}
        promotingRepositoryName={promotingFloatingRepoName}
        onPromotingRepositoryNameChange={setPromotingFloatingRepoName}
        onCancelPromote={() => {
          setPromotingFloatingRepo(null);
          setPromotingFloatingRepoName("");
        }}
        onSubmitPromote={submitPromoteFloatingRepository}
      />
      <RepositoryAssociateModal
        open={repositoryAssociateModal.open}
        floatingMode={repositoryAssociateModal.floatingMode}
        acquireMode={repositoryAssociateModal.acquireMode}
        onAcquireModeChange={repositoryAssociateModal.setAcquireMode}
        parentPath={repositoryAssociateModal.parentPath}
        onParentPathChange={repositoryAssociateModal.setParentPath}
        onPickParentPath={repositoryAssociateModal.pickParentPath}
        folderName={repositoryAssociateModal.folderName}
        onFolderNameChange={repositoryAssociateModal.setFolderName}
        gitUrl={repositoryAssociateModal.gitUrl}
        onGitUrlChange={repositoryAssociateModal.setGitUrl}
        submitOkText={repositoryAssociateModal.submitOkText}
        associateSelectValue={repositoryAssociateModal.associateSelectValue}
        onAssociateSelectValueChange={repositoryAssociateModal.setAssociateSelectValue}
        onRepositoryTypeChange={repositoryAssociateModal.setRepositoryType}
        workspaceBootstrapSelection={repositoryAssociateModal.workspaceBootstrapSelection}
        onWorkspaceBootstrapSelectionChange={repositoryAssociateModal.setWorkspaceBootstrapSelection}
        iconDisplayName={repositoryAssociateModal.iconDisplayName}
        onIconDisplayNameChange={repositoryAssociateModal.setIconDisplayName}
        iconColor={repositoryAssociateModal.iconColor}
        onIconColorChange={repositoryAssociateModal.setIconColor}
        presets={repositoryAssociateModal.presets}
        selectOptions={repositoryAssociateModal.selectOptions}
        resolvePresetSelectValue={repositoryAssociateModal.resolvePresetSelectValue}
        onAddPreset={() => void repositoryAssociateModal.addPreset()}
        onCancel={repositoryAssociateModal.close}
        onSubmit={repositoryAssociateModal.submit}
      />
      <RepositorySddModeModal
        repository={repositorySddModeModal.repository}
        value={repositorySddModeModal.value}
        signals={repositorySddModeModal.signals}
        saving={repositorySddModeModal.saving}
        canSave={repositorySddModeModal.canSave}
        onValueChange={repositorySddModeModal.setValue}
        onCancel={repositorySddModeModal.cancel}
        onSubmit={() => void repositorySddModeModal.submit()}
      />
      <WorkspaceSddModeModal
        project={projectSddModeModal.project}
        value={projectSddModeModal.value}
        signals={projectSddModeModal.signals}
        saving={projectSddModeModal.saving}
        canSave={projectSddModeModal.canSave}
        onValueChange={projectSddModeModal.setValue}
        onCancel={projectSddModeModal.cancel}
        onSubmit={() => void projectSddModeModal.submit()}
      />
      {appSettingsOpen ? (
        <Suspense fallback={null}>
          <AppSettingsModalLazy open onClose={() => setAppSettingsOpen(false)} />
        </Suspense>
      ) : null}
    </Layout.Sider>
  );
}
