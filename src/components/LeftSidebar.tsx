import { RobotOutlined } from "@ant-design/icons";
import { App as AntdApp, Layout } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { ProjectItem, Repository } from "../types";
import { repositoryFolderBasename } from "../utils/repositoryType";
import { MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX } from "../constants/mainLayoutWidths";
import { cancelClaudeExecution } from "../services/claude";
import { pickFolder } from "../services/repository";
import {
  OPEN_WORKSPACE_ERROR,
  openWorkspaceWithStoredPreference,
} from "../services/openWorkspaceWithPreference";
import { TaskCardsNav } from "./TaskCardsNav";
import { ActiveRepositoryFilesPanel } from "./LeftSidebar/ActiveRepositoryFilesPanel";
import { LeftSidebarTopbar } from "./LeftSidebar/LeftSidebarTopbar";
import { ProjectRepositoryList } from "./LeftSidebar/ProjectRepositoryList";
import {
  readLeftFilesExplorerCollapsedFromStorage,
  writeLeftFilesExplorerCollapsedToStorage,
} from "./LeftSidebar/sidebarStorage";
import { ProjectNameModals } from "./LeftSidebar/ProjectNameModals";
import { RepositoryAssociateModal } from "./LeftSidebar/RepositoryAssociateModal";
import { RepositorySddModeModal } from "./LeftSidebar/RepositorySddModeModal";
import { SystemResourceInline } from "./LeftSidebar/SystemResourceInline";
import type { LeftSidebarProps } from "./LeftSidebar/types";
import { useProjectRepositorySidebarState } from "./LeftSidebar/useProjectRepositorySidebarState";
import { useRepositoryAssociateModalController } from "./LeftSidebar/useRepositoryAssociateModalController";
import { useRepositorySddModeModalController } from "./LeftSidebar/useRepositorySddModeModalController";
import { useSystemResourceSessions } from "./LeftSidebar/useSystemResourceSessions";
import "./GitPanel/index.css";

export function LeftSidebar({
  dark,
  collapsed,
  parked = false,
  siderWidth = MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX,
  compactLayoutMode = false,
  onToggleCompactLayoutMode,
  projects,
  activeProjectId,
  repositories,
  activeRepositoryId,
  authorDisabled,
  authorDisabledTooltip,
  onOpenAuthor,
  assistantHubActive = false,
  onOpenAssistantHub,
  workspaceCreateRequest,
  standaloneRepoAddRequest,
  onProjectSelect,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  pinnedProjectIds,
  onTogglePinProject,
  onReconcileProject,
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
  activeSessionId: _activeSessionId,
  onSelectSession: _onSelectSession,
  employees: _employees = [],
  employeeTaskCounts: _employeeTaskCounts = [],
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
  const [embedTrellisForNewProject, setEmbedTrellisForNewProject] = useState(true);
  const [projectNameInput, setProjectNameInput] = useState("");
  const [editProject, setEditProject] = useState<ProjectItem | null>(null);
  /** 待升格为新项目的游离 repo（菜单触发后弹出输入项目名 modal）。 */
  const [promotingFloatingRepo, setPromotingFloatingRepo] = useState<Repository | null>(null);
  const [promotingFloatingRepoName, setPromotingFloatingRepoName] = useState("");
  const [repositoryFileTreeSearch, setRepositoryFileTreeSearch] = useState("");
  const [filesExplorerSectionCollapsed, setFilesExplorerSectionCollapsed] = useState(
    readLeftFilesExplorerCollapsedFromStorage,
  );
  const projectRepositoryState = useProjectRepositorySidebarState({
    projects,
    repositories,
    onMoveRepositoryToProject,
  });
  const systemResourceSessions = useSystemResourceSessions({
    sessions,
    onCancelSessionFromMonitor,
    onReloadFullDiskTranscript,
  });
  const repositoryAssociateModal = useRepositoryAssociateModalController({
    onAddRepositoryToProject,
    onAddFloatingRepository,
  });
  const { openAddFloatingRepositoryModal, openAddRepositoryModal } = repositoryAssociateModal;
  const repositorySddModeModal = useRepositorySddModeModalController({
    onUpdateRepositorySddMode,
  });

  const handleFilesExplorerSectionCollapsedChange = useCallback((next: boolean) => {
    setFilesExplorerSectionCollapsed(next);
    writeLeftFilesExplorerCollapsedToStorage(next);
  }, []);

  useEffect(() => {
    setRepositoryFileTreeSearch("");
  }, [activeRepositoryPath]);

  useEffect(() => {
    if (!workspaceCreateRequest) return;
    setProjectNameInput("");
    setCreateProjectRootPath("");
    setEmbedTrellisForNewProject(true);
    setCreateProjectOpen(true);
  }, [workspaceCreateRequest]);

  useEffect(() => {
    if (!standaloneRepoAddRequest || !onAddFloatingRepository) return;
    openAddFloatingRepositoryModal();
  }, [onAddFloatingRepository, openAddFloatingRepositoryModal, standaloneRepoAddRequest]);

  async function submitCreateProject() {
    const name = projectNameInput.trim();
    if (!name) {
      message.warning("Workspace 名称不能为空");
      return;
    }
    if (!createProjectRootPath.trim()) {
      message.warning("请先选择 Workspace 根目录");
      return;
    }
    if (createProjectSubmitting) return;
    setCreateProjectSubmitting(true);
    try {
      await Promise.resolve(
        onCreateProject(name, {
          embedTrellis: embedTrellisForNewProject,
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
      message.warning("Workspace 名称不能为空");
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
      message.warning("请输入 Workspace 名称");
      return;
    }
    if (!onPromoteFloatingRepositoryToProject) {
      message.warning("当前环境未启用「升格为 Workspace」");
      return;
    }
    const repoId = promotingFloatingRepo.id;
    setPromotingFloatingRepo(null);
    setPromotingFloatingRepoName("");
    void Promise.resolve(onPromoteFloatingRepositoryToProject(repoId, trimmed)).catch(
      (err: unknown) => {
        message.error("升格为 Workspace 失败");
        console.error(err);
      },
    );
  }

  return (
    <Layout.Sider
      width={siderWidth}
      collapsedWidth={0}
      collapsed={collapsed}
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

      <div
        className="app-left-sidebar-project-and-files"
        data-files-explorer-section-collapsed={
          activeRepositoryPath && filesExplorerSectionCollapsed ? "true" : undefined
        }
      >
        <ProjectRepositoryList
          projects={projects}
          repositoriesById={projectRepositoryState.repositoriesById}
          floatingRepositories={floatingRepositories}
          activeProjectId={activeProjectId}
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
            setEmbedTrellisForNewProject(true);
            setCreateProjectOpen(true);
          }}
          onAddFloatingRepositoryClick={
            onAddFloatingRepository ? openAddFloatingRepositoryModal : undefined
          }
          onAddRepositoryToProjectClick={
            onAddRepositoryToProject ? openAddRepositoryModal : undefined
          }
          onReconcileProject={onReconcileProject}
          onCodeGraphGenerateProject={onCodeGraphGenerateProject}
          onCodeGraphViewProject={onCodeGraphViewProject}
          onCodeGraphGenerateRepository={onCodeGraphGenerateRepository}
          onCodeGraphViewRepositoryInProject={onCodeGraphViewRepositoryInProject}
          onCodeGraphViewFloatingRepository={onCodeGraphViewFloatingRepository}
          onToggleProjectExpand={projectRepositoryState.toggleProjectExpand}
          onTogglePinProject={onTogglePinProject}
          onRenameProject={(project) => {
            setEditProject(project);
            setProjectNameInput(project.name);
          }}
          onDeleteProject={(project) => {
            modal.confirm({
              title: "确认删除项目？",
              content: `Workspace「${project.name}」将被删除，但仓库本身不会被移除。`,
              okText: "删除",
              okType: "danger",
              cancelText: "取消",
              onOk: () => onDeleteProject(project.id),
            });
          }}
          onOpenPromptsProject={onOpenPromptsProject}
          onOpenProjectTrellis={onOpenProjectTrellis}
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
              title: "确认移除 Standalone Repo？",
              content: `Standalone Repo「${repositoryFolderBasename(repo)}」将从 Wise 列表移除（不会删除磁盘文件，也不会动 .trellis）。`,
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
        />

        {onOpenAssistantHub ? (
          <div className="app-left-sidebar-assistant-entry">
            <button
              type="button"
              className={`app-left-sidebar-assistant-button${assistantHubActive ? " app-left-sidebar-assistant-button--active" : ""}`}
              onClick={onOpenAssistantHub}
              aria-label="打开助手"
            >
              <span className="app-left-sidebar-assistant-button__icon" aria-hidden>
                <RobotOutlined />
              </span>
              <span className="app-left-sidebar-assistant-button__label">助手</span>
            </button>
          </div>
        ) : null}

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
        claudeProcessCount={systemResourceSessions.systemSummary.claudeProcessCount}
        onSelectSession={(sessionId) => {
          systemResourceSessions.setClaudeCountPopoverOpen(false);
          systemResourceSessions.setClaudeSystemSessionSearch("");
          systemResourceSessions.setSystemSessionDrawerId(sessionId);
        }}
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
        embedTrellisForNewProject={embedTrellisForNewProject}
        onEmbedTrellisForNewProjectChange={setEmbedTrellisForNewProject}
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
    </Layout.Sider>
  );
}
