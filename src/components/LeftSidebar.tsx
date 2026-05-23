import { App as AntdApp, Layout } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectItem, Repository } from "../types";
import { repositoryFolderBasename } from "../utils/repositoryType";
import { AppSettingsModal } from "./AppSettingsModal";
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
  OPEN_WORKSPACE_ERROR,
  openWorkspaceWithStoredPreference,
} from "../services/openWorkspaceWithPreference";
import { TaskCardsNav } from "./TaskCardsNav";
import { ActiveRepositoryFilesPanel } from "./LeftSidebar/ActiveRepositoryFilesPanel";
import { LeftSidebarTopbar } from "./LeftSidebar/LeftSidebarTopbar";
import { LeftSidebarHubQuickEntries } from "./LeftSidebar/LeftSidebarHubQuickEntries";
import { ProjectRepositoryList } from "./LeftSidebar/ProjectRepositoryList";
import {
  readLeftFilesExplorerCollapsedFromStorage,
  writeLeftFilesExplorerCollapsedToStorage,
} from "./LeftSidebar/sidebarStorage";
import { ProjectNameModals } from "./LeftSidebar/ProjectNameModals";
import { RepositoryAssociateModal } from "./LeftSidebar/RepositoryAssociateModal";
import { RepositorySddModeModal } from "./LeftSidebar/RepositorySddModeModal";
import { RepositoryScheduledTasksModal } from "./RepositoryScheduledTasksModal";
import { SystemResourceInline } from "./LeftSidebar/SystemResourceInline";
import type { LeftSidebarProps } from "./LeftSidebar/types";
import { useProjectRepositorySidebarState } from "./LeftSidebar/useProjectRepositorySidebarState";
import { useRepositoryAssociateModalController } from "./LeftSidebar/useRepositoryAssociateModalController";
import { useRepositorySddModeModalController } from "./LeftSidebar/useRepositorySddModeModalController";
import { useSidebarCodeGraphIndexMap } from "./LeftSidebar/useSidebarCodeGraphIndexMap";
import { useSidebarScheduledTasksMap } from "./LeftSidebar/useSidebarScheduledTasksMap";
import { useSidebarRequirementUnsplitMap } from "./LeftSidebar/useSidebarRequirementUnsplitMap";
import { useSidebarExecutableTasksMap } from "./LeftSidebar/useSidebarExecutableTasksMap";
import { useSidebarTrellisReadyMap } from "./LeftSidebar/useSidebarTrellisReadyMap";
import { useClaudeProcessWorkspaceLabelCache } from "../hooks/useClaudeProcessWorkspaceLabelCache";
import { useSystemResourceSessions } from "./LeftSidebar/useSystemResourceSessions";
import { useSidebarRunningMainSessionIndicators } from "./LeftSidebar/useSidebarRunningMainSessionIndicators";
import { WORKFLOW_UI_EVENT_SPLIT_TODO_COUNT_UPDATED } from "../constants/workflowUiEvents";
import type { SplitTodoCountUpdatedDetail } from "../constants/workflowUiEvents";
import "./GitPanel/index.css";

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
  onCodeGraphGenerateProject,
  onCodeGraphViewProject,
  onCodeGraphGenerateRepository,
  onCodeGraphViewRepositoryInProject,
  onCodeGraphViewFloatingRepository,
  onAddFloatingRepository,
  onAddRepositoryToProject,
  onPromoteFloatingRepositoryToProject,
  floatingRepositories = [],
  onRemoveRepository,
  onDetachRepositoryFromProject,
  onUpdateRepositorySddMode,
  onReorderRepositoriesInProject,
  onMoveRepositoryToProject,
  onRepositorySelect,
  onOpenInFinder,
  onCreateProjectTask,
  onCreateRepositoryTask,
  onOpenPromptsProject,
  onOpenProjectTrellis,
  onOpenPromptsRepository,
  onOpenRepositoryMainOwner,
  sessions,
  repositoryMainSessionBindings,
  activeSessionId: _activeSessionId,
  onSelectSession: _onSelectSession,
  employees = [],
  employeeTaskCounts: _employeeTaskCounts = [],
  workflowTemplates = [],
  workflowGraphsByWorkflowId = {},
  onMoveEmployee: _onMoveEmployee,
  onCancelSessionFromMonitor,
  onOpenTaskDetailFromMonitor,
  onReloadFullDiskTranscript,
  activeRepositoryPath,
  activeRepositoryName,
  onOpenActiveRepositoryFile,
  taskCardsNavProps,
}: LeftSidebarProps) {
  const { message, modal } = AntdApp.useApp();

  const openRepositoryInPreferredEditor = useCallback(
    (repository: Repository) => {
      void openWorkspaceWithStoredPreference(repository.path).catch((err: unknown) => {
        const code = err instanceof Error ? err.message : "";
        if (code === OPEN_WORKSPACE_ERROR.NOT_CONFIGURED) {
          message.warning("未配置可用的编辑器或命令，请在中栏顶部「打开方式」中选择");
        } else if (code === OPEN_WORKSPACE_ERROR.EMPTY_PATH) {
          message.warning("仓库路径为空");
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
  const [filesExplorerSectionCollapsed, setFilesExplorerSectionCollapsed] = useState(
    readLeftFilesExplorerCollapsedFromStorage,
  );
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
    onAddFloatingRepository,
    onAddRepositoryToProject,
  });
  const { openAddFloatingRepositoryModal, openAddRepositoryModal } = repositoryAssociateModal;
  const repositorySddModeModal = useRepositorySddModeModalController({
    onUpdateRepositorySddMode,
  });
  const codeGraphIndexStatusByRepoId = useSidebarCodeGraphIndexMap(
    useMemo(() => repositories.map((repository) => repository.id), [repositories]),
  );
  const { byId: scheduledTasksByRepoId, refresh: refreshScheduledTasksMap } = useSidebarScheduledTasksMap(
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
  const [scheduledTasksModalRepository, setScheduledTasksModalRepository] = useState<{
    path: string;
    name: string;
  } | null>(null);

  const openScheduledTasksForRepository = useCallback((repository: Repository) => {
    const path = repository.path?.trim();
    if (!path) return;
    setScheduledTasksModalRepository({
      path,
      name: repository.name?.trim() || repositoryFolderBasename(repository),
    });
  }, []);

  const openScheduledTasksForProject = useCallback(
    (project: ProjectItem) => {
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
    [openScheduledTasksForRepository, repositories, scheduledTasksByRepoId],
  );

  const dispatchOpenExecutableTasksDrawer = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent<SplitTodoCountUpdatedDetail>(WORKFLOW_UI_EVENT_SPLIT_TODO_COUNT_UPDATED, {
        detail: { openTaskDrawer: true, source: "trellis" },
      }),
    );
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

  useEffect(() => {
    setRepositoryFileTreeSearch("");
  }, [activeRepositoryPath]);

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
        data-has-files-explorer={activeRepositoryPath ? "true" : "false"}
        data-files-explorer-section-collapsed={
          activeRepositoryPath && filesExplorerSectionCollapsed ? "true" : undefined
        }
      >
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
          onProjectSelect={onProjectSelect}
          onRepositorySelect={onRepositorySelect}
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
          onCodeGraphGenerateProject={onCodeGraphGenerateProject}
          onCodeGraphViewProject={onCodeGraphViewProject}
          onCodeGraphGenerateRepository={onCodeGraphGenerateRepository}
          onCodeGraphViewRepositoryInProject={onCodeGraphViewRepositoryInProject}
          onCodeGraphViewFloatingRepository={onCodeGraphViewFloatingRepository}
          codeGraphIndexStatusByRepoId={codeGraphIndexStatusByRepoId}
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
          onOpenInFinder={onOpenInFinder}
          openRepositoryInPreferredEditor={openRepositoryInPreferredEditor}
          onOpenPromptsRepository={onOpenPromptsRepository}
          onOpenRepositoryMainOwner={onOpenRepositoryMainOwner}
          onConfigureRepositorySddMode={onUpdateRepositorySddMode ? repositorySddModeModal.open : undefined}
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
          onOpenScheduledTasksForRepository={openScheduledTasksForRepository}
          onOpenScheduledTasksForProject={openScheduledTasksForProject}
          onOpenRepositoryRequirements={(repository) => onCreateRepositoryTask(repository, "split")}
          onOpenExecutableTasksForProject={openExecutableTasksForProject}
          onOpenExecutableTasksForRepository={openExecutableTasksForRepository}
          runningMainSessionByProjectId={runningByProjectId}
          runningMainSessionByRepositoryId={runningByRepositoryId}
          onStopProjectMainSession={handleStopProjectMainSession}
          onStopRepositoryMainSession={handleStopRepositoryMainSession}
        />

        {activeRepositoryPath ? (
          <ActiveRepositoryFilesPanel
            activeRepositoryPath={activeRepositoryPath}
            activeRepositoryName={activeRepositoryName}
            search={repositoryFileTreeSearch}
            onSearchChange={setRepositoryFileTreeSearch}
            onOpenFile={onOpenActiveRepositoryFile}
            sectionCollapsed={filesExplorerSectionCollapsed}
            onSectionCollapsedChange={handleFilesExplorerSectionCollapsedChange}
          />
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
        associateSelectValue={repositoryAssociateModal.associateSelectValue}
        onAssociateSelectValueChange={repositoryAssociateModal.setAssociateSelectValue}
        onRepositoryTypeChange={repositoryAssociateModal.setRepositoryType}
        sddMode={repositoryAssociateModal.sddMode}
        onSddModeChange={repositoryAssociateModal.setSddMode}
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
      <RepositoryScheduledTasksModal
        open={scheduledTasksModalRepository != null}
        onClose={() => {
          setScheduledTasksModalRepository(null);
          void refreshScheduledTasksMap();
        }}
        repositoryPath={scheduledTasksModalRepository?.path ?? ""}
        repositoryDisplayName={scheduledTasksModalRepository?.name ?? ""}
        employees={employees}
        workflowTemplates={workflowTemplates}
        workflowGraphsByWorkflowId={workflowGraphsByWorkflowId}
      />
      <AppSettingsModal open={appSettingsOpen} onClose={() => setAppSettingsOpen(false)} />
    </Layout.Sider>
  );
}
