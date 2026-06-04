import { App as AntdApp, Layout, Spin, Tooltip } from "antd";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { isMultiRepoProject } from "../utils/workspaceMode";
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
import { GitPanelWorkspaceSelector } from "./GitPanel/GitPanelWorkspaceSelector";
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
import { LeftSidebarBottomTabSwitcher } from "./LeftSidebar/LeftSidebarBottomTabSwitcher";
import { ExpandIcon } from "./LeftSidebar/SidebarIcons";
import { SystemResourceInline } from "./LeftSidebar/SystemResourceInline";
import type { LeftSidebarProps } from "./LeftSidebar/types";
import { useProjectRepositorySidebarState } from "./LeftSidebar/useProjectRepositorySidebarState";
import { useRepositoryAssociateModalController } from "./LeftSidebar/useRepositoryAssociateModalController";
import { useProjectSddModeModalController } from "./LeftSidebar/useProjectSddModeModalController";
import { useRepositorySddModeModalController } from "./LeftSidebar/useRepositorySddModeModalController";
import { useSidebarScheduledTasksMap } from "./LeftSidebar/useSidebarScheduledTasksMap";
import { useSidebarWorkspaceTodoCounts } from "../hooks/useSidebarWorkspaceTodoCounts";
import { useSidebarRequirementUnsplitMap } from "./LeftSidebar/useSidebarRequirementUnsplitMap";
import { useSidebarExecutableTasksMap } from "./LeftSidebar/useSidebarExecutableTasksMap";
import { useSidebarTrellisReadyMap } from "./LeftSidebar/useSidebarTrellisReadyMap";
import { useClaudeProcessWorkspaceLabelCache } from "../hooks/useClaudeProcessWorkspaceLabelCache";
import { useSystemResourceSessions } from "./LeftSidebar/useSystemResourceSessions";
import { useSidebarRunningMainSessionIndicators } from "./LeftSidebar/useSidebarRunningMainSessionIndicators";
import { notifySplitTodoCountUpdated } from "../utils/notifySplitTodoCountUpdated";
import "./GitPanel/index.css";

const ProgressMonitorPanelLazy = lazy(() =>
  import("./ProgressMonitorPanel").then((module) => ({ default: module.ProgressMonitorPanel })),
);
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
  compactLayoutMode = false,
  onToggleCompactLayoutMode,
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
  monitorClaudeConcurrency = null,
  onOpenOmcBatchInvocationDetail,
  onCancelOmcDirectBatchInvocation,
  onCompactSessionHistory,
  historyDrawerSessionId,
  onHistoryDrawerSessionIdChange,
  onRestoreHistorySessionAsMain,
  onResumeSession,
  onPrepareSessionForMonitorDrawer,
  activeRepositoryPath,
  activeRepositoryName,
  onOpenActiveRepositoryFile,
  taskCardsNavProps,
}: LeftSidebarProps) {
  const { message, modal } = AntdApp.useApp();

  const openPathInPreferredEditor = useCallback(
    (path: string | null | undefined, emptyMessage: string) => {
      const trimmed = path?.trim() ?? "";
      if (!trimmed) {
        message.warning(emptyMessage);
        return;
      }
      void openWorkspaceWithStoredPreference(trimmed).catch((err: unknown) => {
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
      openPathInPreferredEditor(repository.path, "仓库路径为空");
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
      );
    },
    [openPathInPreferredEditor, projects, repositories],
  );
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
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
  const [monitorPanelMounted, setMonitorPanelMounted] = useState(false);

  useEffect(() => {
    if (!showLeftSidebarMonitorPanel) {
      setMonitorPanelMounted(false);
      return;
    }
    const cancel = runWhenIdle(() => setMonitorPanelMounted(true), { timeoutMs: 500 });
    return cancel;
  }, [showLeftSidebarMonitorPanel]);

  useEffect(() => {
    if (leftBottomTab === "git") {
      void gitPanelChunk;
    }
  }, [leftBottomTab]);
  const expandedFilesPanelOnMountRef = useRef(false);
  const projectRepositoryState = useProjectRepositorySidebarState({
    projects,
    repositories,
    onMoveRepositoryToProject,
  });
  const claudeProcessLabelCache = useClaudeProcessWorkspaceLabelCache();
  const systemResourceSessions = useSystemResourceSessions({
    sessions,
    onCancelSessionFromMonitor,
    onReloadFullDiskTranscript,
  });

  useEffect(() => {
    claudeProcessLabelCache.syncFromRuntime({
      projects,
      repositories,
      bindings: repositoryMainSessionBindings,
      sessions,
      claudeProcesses: systemResourceSessions.systemSummary.claudeProcesses,
    });
  }, [
    claudeProcessLabelCache,
    projects,
    repositories,
    repositoryMainSessionBindings,
    sessions,
    systemResourceSessions.systemSummary.claudeProcesses,
  ]);
  const { runningByProjectId, runningByRepositoryId } = useSidebarRunningMainSessionIndicators({
    projects,
    repositories,
    sessions,
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
      const session = sessions.find((item) => item.id === id);
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
        message.success("已请求结束该进程");
      } catch (err: unknown) {
        message.error(err instanceof Error ? err.message : "结束失败");
      }
    },
    [
      message,
      onCancelSessionFromMonitor,
      sessions,
      systemResourceSessions.systemSummary.claudeProcesses,
    ],
  );

  const handleStopProjectMainSession = useCallback(
    (projectId: string) => {
      const boundSessionId = resolveBoundMainSessionId(
        projectMainSessionBindingKey(projectId),
        repositoryMainSessionBindings,
        sessions,
        null,
      );
      void handleStopBoundMainSession(boundSessionId);
    },
    [handleStopBoundMainSession, repositoryMainSessionBindings, sessions],
  );

  const handleStopRepositoryMainSession = useCallback(
    (repository: Repository) => {
      const boundSessionId = resolveRepositoryMainSessionId(
        repository.path,
        repositoryMainSessionBindings,
        sessions,
        resolveMainOwnerAgentNameForRepositoryPath(repositories, repository.path),
      );
      void handleStopBoundMainSession(boundSessionId);
    },
    [handleStopBoundMainSession, repositories, repositoryMainSessionBindings, sessions],
  );

  const finishClaudeProcessPopoverEnd = useCallback(() => {
    message.success("已请求结束该进程");
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
        message.success(`已请求结束 ${uniqueIds.length} 个进程`);
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
  const { byProjectId: incompleteTodoCountByProjectId, byRepositoryId: incompleteTodoCountByRepositoryId } =
    useSidebarWorkspaceTodoCounts(projects, floatingRepositories);
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
      let target: Repository | undefined;
      for (const repositoryId of project.repositoryIds) {
        const repository = repositories.find((item) => item.id === repositoryId);
        if (repository && (scheduledTasksByRepoId[repositoryId]?.total ?? 0) > 0) {
          target = repository;
          break;
        }
      }
      if (!target) {
        const firstRepositoryId = project.repositoryIds[0];
        target = repositories.find((item) => item.id === firstRepositoryId);
      }
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

  const handleMonitorPanelSectionCollapsedChange = useCallback((next: boolean) => {
    setMonitorPanelSectionCollapsed(next);
    writeLeftMonitorPanelCollapsedToStorage(next);
  }, []);

  const handleLeftBottomTabChange = useCallback(
    (tab: LeftBottomTab) => {
      setLeftBottomTab(tab);
      writeLeftBottomTabToStorage(tab);
      if (tab === "files" && filesExplorerSectionCollapsed) {
        handleFilesExplorerSectionCollapsedChange(false);
      }
    },
    [filesExplorerSectionCollapsed, handleFilesExplorerSectionCollapsedChange],
  );

  useEffect(() => {
    if (expandedFilesPanelOnMountRef.current) return;
    if (leftBottomTab !== "files" || !filesExplorerSectionCollapsed) return;
    expandedFilesPanelOnMountRef.current = true;
    handleFilesExplorerSectionCollapsedChange(false);
  }, [leftBottomTab, filesExplorerSectionCollapsed, handleFilesExplorerSectionCollapsedChange]);

  const repoPanelTabSwitcher = useMemo(
    () => (
      <LeftSidebarBottomTabSwitcher
        activeTab={leftBottomTab}
        onChange={handleLeftBottomTabChange}
      />
    ),
    [leftBottomTab, handleLeftBottomTabChange],
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

  const activeSession = useMemo(
    () => (activeSessionId ? (sessions.find((s) => s.id === activeSessionId) ?? null) : null),
    [sessions, activeSessionId],
  );

  const activeSessionRepositoryPath = useMemo(() => {
    const raw = activeSession?.repositoryPath?.trim();
    if (!raw) return "";
    return normalizeSessionRepositoryPath(raw);
  }, [activeSession?.repositoryPath]);

  const sessionDerivedTreeSelection = useMemo((): WorkspaceRepositoryTreeSelection | null => {
    if (!activeSession?.repositoryPath?.trim()) return null;
    const repo = resolveRepositoryForSession({
      session: activeSession,
      repositories,
      bindings: repositoryMainSessionBindings,
      sessions,
      preferredRepositoryId: activeRepositoryId ?? undefined,
    });
    if (repo) return { kind: "repository", repositoryId: repo.id };
    return null;
  }, [activeSession, repositories, repositoryMainSessionBindings, sessions, activeRepositoryId]);

  const repoPanelTreeSelectionSource = useMemo((): WorkspaceRepositoryTreeSelection | null => {
    // 侧栏选中具体仓库时，Git/文件树默认对齐该仓库（含多仓工作区成员仓）。
    if (activeWorkspaceFocus === "repository" && activeRepositoryId != null) {
      return { kind: "repository", repositoryId: activeRepositoryId };
    }
    // 多仓工作区 + 工作区焦点：Git 面板保持工作区级多仓视图。
    if (leftBottomTab === "git" && activeProjectId) {
      const project = projects.find((item) => item.id === activeProjectId) ?? null;
      if (project && isMultiRepoProject(project, projects)) {
        return { kind: "project", projectId: project.id };
      }
    }
    return globalWorkspaceTreeSelection ?? sessionDerivedTreeSelection ?? null;
  }, [
    leftBottomTab,
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

  useEffect(() => {
    if (!globalSelectionSyncKey) return;
    if (globalSelectionSyncKey === lastSyncedGlobalSelectionKeyRef.current) return;
    lastSyncedGlobalSelectionKeyRef.current = globalSelectionSyncKey;
    setRepoPanelTreeSelection(repoPanelTreeSelectionSource);
  }, [globalSelectionSyncKey, repoPanelTreeSelectionSource]);

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
  const repoPanelRepositoryName =
    repoPanelTreeView?.label.trim() ||
    activeRepositoryName?.trim() ||
    activeSession?.repositoryName?.trim() ||
    repositoryFolderBasename({ path: repoPanelRepositoryPath, name: activeRepositoryName ?? "" });
  const [accessibleRepoPanelPath, setAccessibleRepoPanelPath] = useState(repoPanelRepositoryPath);

  useEffect(() => {
    const candidate = repoPanelRepositoryPath.trim();
    if (candidate) {
      setAccessibleRepoPanelPath(candidate);
    }
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
  const showRepoPanel = Boolean(effectiveRepoPanelPath);

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
        setRepoPanelTreeSelection({ kind: "repository", repositoryId });
      },
      onProjectSelect: (projectId: string) => {
        setRepoPanelTreeSelection({ kind: "project", projectId });
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
      setRepoPanelTreeSelection({ kind: "project", projectId });
      onProjectSelect(projectId);
    },
    [onProjectSelect],
  );

  const handleRepositorySelectAndSyncRepoPanel = useCallback(
    (repositoryId: number | null) => {
      if (repositoryId == null) {
        setRepoPanelTreeSelection(null);
        onRepositorySelect(null);
        return;
      }
      setRepoPanelTreeSelection({ kind: "repository", repositoryId });
      onRepositorySelect(repositoryId);
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

  return (
    <Layout.Sider
      width={siderWidth}
      collapsedWidth={0}
      collapsed={collapsed || parked}
      className={`app-left-sidebar${parked ? " app-left-sidebar--parked" : ""}`}
      theme={dark ? "dark" : "light"}
    >
      <LeftSidebarTopbar
        compactLayoutMode={compactLayoutMode}
        onToggleCompactLayoutMode={onToggleCompactLayoutMode}
        authorDisabled={authorDisabled}
        authorTooltip={authorDisabledTooltip}
        activeRepositoryPath={activeRepositoryPath}
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
        <SidebarWorkspaceTodoAddModal />
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
              onOk: () => onDeleteProject(project.id),
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
          incompleteTodoCountByProjectId={incompleteTodoCountByProjectId}
          incompleteTodoCountByRepositoryId={incompleteTodoCountByRepositoryId}
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

        {showLeftSidebarMonitorPanel && monitorPanelMounted ? (
          <div
            className={
              "app-left-sidebar-monitor-panel" +
              (monitorPanelSectionCollapsed ? " app-left-sidebar-monitor-panel--section-collapsed" : "")
            }
          >
            <Suspense fallback={null}>
            <ProgressMonitorPanelLazy
              sectionCollapsed={monitorPanelSectionCollapsed}
              onSectionCollapsedChange={handleMonitorPanelSectionCollapsedChange}
              employeeItems={employeeMonitorItems}
              repositoryMemberItems={repositoryMemberMonitorItems}
              sessionConversationTaskItems={
                sessionConversationTaskItems ? [...sessionConversationTaskItems] : []
              }
              showSessionConversationTasks
              executionEnvironmentDispatchHistoryDays={executionEnvironmentDispatchHistoryDays}
              onExecutionEnvironmentDispatchHistoryDaysChange={
                onExecutionEnvironmentDispatchHistoryDaysChange
              }
              executionEnvironmentDispatchHistoryDaysSaving={
                executionEnvironmentDispatchHistoryDaysSaving
              }
              teamItems={teamMonitorItems}
              sessions={sessions}
              activeTarget={monitorActiveTarget}
              onOpenTeamDetail={(workflowId) => onOpenTeamMonitorDetail?.(workflowId)}
              onOpenEmployeeConfig={onOpenEmployeeConfig}
              onOpenWorkflowConfig={onOpenWorkflowConfig}
              onStopEmployee={(employeeId) => onStopEmployeeMonitor?.(employeeId)}
              onStopTeam={(workflowId) => onStopTeamMonitor?.(workflowId)}
              hideEmployeeUi={hideEmployeeUi}
              claudeConcurrency={monitorClaudeConcurrency}
              onCancelSession={onCancelSessionFromMonitor}
              onOpenTaskDetail={onOpenTaskDetailFromMonitor}
              onOpenOmcBatchInvocationDetail={onOpenOmcBatchInvocationDetail}
              onCancelOmcDirectBatchInvocation={onCancelOmcDirectBatchInvocation}
              onStopSessionConversationTask={onStopSessionConversationTask}
              onReloadFullDiskTranscript={onReloadFullDiskTranscript}
              onCompactSessionHistory={onCompactSessionHistory}
              transcriptSourceSessions={sessions}
              projectId={projectId}
              historyDrawerSessionId={historyDrawerSessionId}
              onHistoryDrawerSessionIdChange={onHistoryDrawerSessionIdChange}
              onRestoreHistorySessionAsMain={onRestoreHistorySessionAsMain}
              onResumeSession={onResumeSession}
              onPrepareSessionForMonitorDrawer={onPrepareSessionForMonitorDrawer}
              repositoryMainBindings={repositoryMainSessionBindings}
              repositories={repositories}
            />
            </Suspense>
          </div>
        ) : null}

        {showRepoPanel ? (
          <div className="app-left-sidebar-bottom-tabs">
            {leftBottomTab === "files" && filesExplorerSectionCollapsed ? (
              <div className="app-left-sidebar-repo-panel-header">
                {repoPanelTabSwitcher}
                <div className="app-left-sidebar-repo-panel-header__selector">
                  <GitPanelWorkspaceSelector
                    {...repoPanelWorkspaceSelectorProps}
                    activeRepositoryPath={effectiveRepoPanelPath}
                  />
                </div>
                {workspaceListSectionCollapsed ? (
                  <Tooltip title="展开工作区列表" mouseEnterDelay={0.35}>
                    <button
                      type="button"
                      className="app-left-sidebar-repo-panel-header__expand-icon"
                      aria-label="展开工作区列表"
                      onClick={() => handleWorkspaceListSectionCollapsedChange(false)}
                    >
                      <ExpandIcon expanded={false} />
                    </button>
                  </Tooltip>
                ) : null}
                <Tooltip title="展开文件树" mouseEnterDelay={0.35}>
                  <button
                    type="button"
                    className="app-left-sidebar-repo-panel-header__expand-icon"
                    aria-label="展开文件树"
                    onClick={() => handleFilesExplorerSectionCollapsedChange(false)}
                  >
                    <ExpandIcon expanded={false} />
                  </button>
                </Tooltip>
              </div>
            ) : leftBottomTab === "git" && workspaceListSectionCollapsed ? (
              <div className="app-left-sidebar-repo-panel-header">
                {repoPanelTabSwitcher}
                <div className="app-left-sidebar-repo-panel-header__selector">
                  <GitPanelWorkspaceSelector
                    {...repoPanelWorkspaceSelectorProps}
                    activeRepositoryPath={effectiveRepoPanelPath}
                  />
                </div>
                <Tooltip title="展开工作区列表" mouseEnterDelay={0.35}>
                  <button
                    type="button"
                    className="app-left-sidebar-repo-panel-header__expand-icon"
                    aria-label="展开工作区列表"
                    onClick={() => handleWorkspaceListSectionCollapsedChange(false)}
                  >
                    <ExpandIcon expanded={false} />
                  </button>
                </Tooltip>
              </div>
            ) : null}
            <div className="app-left-sidebar-bottom-tab-content">
              {leftBottomTab === "git" ? (
                <Suspense
                  fallback={
                    <div className="app-file-editor-loading">
                      <Spin size="small" />
                    </div>
                  }
                >
                  <GitPanelLazy
                    headerPrefix={workspaceListSectionCollapsed ? undefined : repoPanelTabSwitcher}
                    repositoryPath={effectiveRepoPanelPath}
                    repositoryName={repoPanelRepositoryName}
                    repositoryEntries={gitPanelRepositoryEntries}
                    multiRepoContextTitle={gitPanelContextTitle}
                    onOpenFile={onOpenActiveRepositoryFile}
                    lazyMount
                    {...repoPanelWorkspaceSelectorProps}
                  />
                </Suspense>
              ) : (
                <ActiveRepositoryFilesPanel
                  headerPrefix={filesExplorerSectionCollapsed ? undefined : repoPanelTabSwitcher}
                  activeRepositoryPath={effectiveRepoPanelPath}
                  activeRepositoryName={repoPanelRepositoryName}
                  search={repositoryFileTreeSearch}
                  onSearchChange={setRepositoryFileTreeSearch}
                  onOpenFile={onOpenActiveRepositoryFile}
                  sectionCollapsed={filesExplorerSectionCollapsed}
                  onSectionCollapsedChange={handleFilesExplorerSectionCollapsedChange}
                  workspaceSelector={repoPanelWorkspaceSelectorProps}
                />
              )}
            </div>
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
              message.success("已请求终止该进程");
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
          if (picked) setCreateProjectRootPath(picked);
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
