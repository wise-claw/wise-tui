import type { MutableRefObject } from "react";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Typography } from "antd";
import { DeferredHoverTooltip } from "../shared/DeferredHoverTooltip";
import { LEFT_SIDEBAR_SCROLLING_CLASS } from "../../constants/leftSidebarScrollPerformance";
import { useScrollEndClass } from "../../hooks/useScrollEndClass";
import { useRepositoryRunCommandRowPinnedMap } from "../../hooks/useRepositoryRunCommandRowPinned";
import type { RepositoryRunCommandRowPinnedMap } from "../../services/repositoryRunCommandRowActionPreference";
import { setWorkspacePointerActive } from "../../stores/chromePanelHoverStore";
import type { ReconcileProjectMode } from "../../constants/reconcileProjectMode";
import type { Repository, StandaloneRepo, TaskMode, Workspace } from "../../types";
import {
  sumProjectScheduledTasksEnabled,
  sumProjectScheduledTasksTotal,
  type SidebarScheduledTasksSummary,
} from "./useSidebarScheduledTasksMap";
import { resolveWorkspaceMode, type WorkspaceFocus } from "../../utils/workspaceMode";
import { parseOpenAppConfigureMenuKey } from "../../utils/openAppScope";
import { buildProjectMoreMenuItems } from "./sidebarMoreMenuItems";
import { SidebarMoreMenuDropdown } from "./SidebarMoreMenuDropdown";
import { openWorkspaceTodosFromSidebarMenu } from "../../utils/openWorkspaceTodosFromSidebar";
import { workspaceTodosAnchorKey } from "../../utils/workspaceTodosAnchorKey";
import {
  ExpandIcon,
  MoreIcon,
  PlusIcon,
  ProjectIcon,
  WorkspaceRemindersIcon,
} from "./SidebarIcons";
import {
  FloatingRepositoryRow,
  OpenInEditorAction,
  OpenInTerminalAction,
  ProjectRepositoryRows,
  RepositoryTrellisAction,
  SidebarExecutableTasksAction,
  SidebarRequirementAction,
  SidebarScheduledTasksAction,
  SidebarWorkspaceRemindersAction,
} from "./repositoryRows";
import { RunningMainSessionDot } from "./RunningMainSessionDot";
import { projectRowPropsEqual } from "./projectRowPropsEqual";
import { projectRepositoryListPropsEqual } from "./projectRepositoryListPropsEqual";

const EMPTY_PROJECT_REPOS: Repository[] = [];

function resolveActiveRepositoryIdInProject(
  project: Workspace,
  activeRepositoryId: number | null,
): number | null {
  if (activeRepositoryId == null) return null;
  return project.repositoryIds.includes(activeRepositoryId) ? activeRepositoryId : null;
}

export interface ProjectRepositoryListProps {
  projects: Workspace[];
  repositoriesById: Map<number, Repository>;
  floatingRepositories: StandaloneRepo[];
  activeProjectId: string | null;
  activeWorkspaceFocus?: WorkspaceFocus;
  activeRepositoryId: number | null;
  showRepositoryIconBadgesInWorkspaceList?: boolean;
  pinnedProjectIds: string[];
  expandedProjects: Set<string>;
  projectDropTargetId: string | null;
  repoSidebarDragRef: MutableRefObject<{ sourceProjectId: string; repositoryId: number } | null>;
  onProjectSelect: (projectId: Workspace["id"]) => void;
  onRepositorySelect: (id: number | null) => void;
  onCreateProjectClick: () => void;
  onAddFloatingRepositoryClick?: () => void;
  onAddRepositoryToProjectClick?: (projectId: Workspace["id"]) => void;
  onReconcileProject?: (projectId: string, mode: ReconcileProjectMode) => void | Promise<void>;
  onBootstrapTrellisForProject?: (project: Workspace) => void | Promise<void>;
  onBootstrapTrellisForRepository?: (repository: Repository) => void | Promise<void>;
  onToggleProjectExpand: (projectId: string) => void;
  onTogglePinProject: (projectId: string) => void;
  onRenameProject: (project: Workspace) => void;
  onDeleteProject: (project: Workspace) => void;
  onOpenPromptsProject?: (project: Workspace) => void;
  onOpenProjectTrellis?: (project: Workspace) => void;
  onOpenFloatingRepositoryTrellis?: (repository: Repository) => void;
  onCreateProjectTask: (project: Workspace, mode: TaskMode) => void;
  onCreateRepositoryTask: (repository: Repository, mode: TaskMode) => void;
  onOpenWorkspaceRequirements?: (project: Workspace) => void;
  onOpenRepositoryRequirements?: (repository: Repository) => void;
  onOpenInFinder: (repository: Repository) => void;
  onOpenProjectInFinder?: (project: Workspace) => void;
  onOpenInTerminal?: (repository: Repository) => void;
  onOpenProjectInTerminal?: (project: Workspace) => void;
  onOpenRepositoryInBrowser: (repository: Repository) => void;
  openRepositoryInPreferredEditor: (repository: Repository) => void;
  openProjectInPreferredEditor?: (project: Workspace) => void;
  onOpenPromptsRepository?: (project: Workspace, repository: Repository) => void;
  onOpenRepositoryMainOwner?: (repository: Repository) => void;
  onConfigureRepositoryMainSessionRun?: (repository: Repository) => void;
  onStartRepositoryRunCommand?: (repository: Repository) => void;
  onStopRepositoryRunCommand?: (repository: Repository) => void;
  onConfigureRepositorySddMode?: (repository: Repository) => void;
  onConfigureRepositoryIconBadge?: (repository: Repository) => void;
  onConfigureProjectSddMode?: (project: Workspace) => void;
  onConfigureRepositoryOpenApp?: (repository: Repository, openAppId: string | null) => void;
  onConfigureProjectOpenApp?: (project: Workspace, openAppId: string | null) => void;
  onNewPaneSessionForRepository?: (repository: Repository) => void;
  onNewPaneSessionForProject?: (project: Workspace) => void;
  onPromoteFloatingRepository?: (repository: StandaloneRepo) => void;
  onJoinFloatingRepository?: (repository: StandaloneRepo, projectId: string) => void;
  onRemoveFloatingRepository: (repository: StandaloneRepo) => void;
  onDetachRepositoryFromProject: (projectId: string, repositoryId: number) => void;
  onReorderRepositoriesInProject?: (projectId: string, repositoryIds: number[]) => void | Promise<void>;
  onMoveRepositoryToProject?: (targetProjectId: string, repositoryId: number) => void | Promise<void>;
  onMoveRepositoryToProjectWithExpand: (targetProjectId: string, repositoryId: number) => Promise<void>;
  onProjectDropTargetChange: (projectId: string | null | ((cur: string | null) => string | null)) => void;
  onClearRepoSidebarDrag: () => void;
  onMoveRepositoryError: (message: string, err: unknown) => void;
  projectTrellisReadyById?: Record<string, boolean>;
  repositoryTrellisReadyById?: Record<number, boolean>;
  scheduledTasksByRepoId?: Record<number, SidebarScheduledTasksSummary>;
  requirementUnsplitByProjectId?: Record<string, number>;
  requirementUnsplitByRepoId?: Record<number, number>;
  executableTasksByProjectId?: Record<string, number>;
  executableTasksByRepoId?: Record<number, number>;
  /** 默认配置关闭待办时隐藏侧栏菜单、徽章与 Popover。 */
  workspaceTodosEnabled?: boolean;
  /** 工作区标题栏：打开全局添加待办弹窗。 */
  onOpenGlobalWorkspaceTodoAdd?: () => void;
  onOpenScheduledTasksForRepository?: (repository: Repository) => void;
  onOpenScheduledTasksForProject?: (project: Workspace) => void;
  onOpenExecutableTasksForProject?: (project: Workspace) => void;
  onOpenExecutableTasksForRepository?: (repository: Repository) => void;
  runningMainSessionByProjectId?: Record<string, boolean>;
  runningMainSessionByRepositoryId?: Record<number, boolean>;
  onStopProjectMainSession?: (projectId: string) => void;
  onStopRepositoryMainSession?: (repository: Repository) => void;
  sectionCollapsed?: boolean;
  onSectionCollapsedChange?: (collapsed: boolean) => void;
}

function ProjectRepositoryListInner({
  projects,
  repositoriesById,
  floatingRepositories,
  activeProjectId,
  activeWorkspaceFocus = "repository",
  activeRepositoryId,
  showRepositoryIconBadgesInWorkspaceList = false,
  pinnedProjectIds,
  expandedProjects,
  projectDropTargetId,
  repoSidebarDragRef,
  onProjectSelect,
  onRepositorySelect,
  onCreateProjectClick,
  onAddFloatingRepositoryClick,
  onAddRepositoryToProjectClick,
  onReconcileProject,
  onBootstrapTrellisForProject,
  onBootstrapTrellisForRepository,
  onToggleProjectExpand,
  onTogglePinProject,
  onRenameProject,
  onDeleteProject,
  onOpenPromptsProject,
  onOpenProjectTrellis,
  onOpenFloatingRepositoryTrellis,
  onCreateProjectTask,
  onCreateRepositoryTask,
  onOpenWorkspaceRequirements,
  onOpenInFinder,
  onOpenProjectInFinder,
  onOpenInTerminal,
  onOpenProjectInTerminal,
  onOpenRepositoryInBrowser,
  openRepositoryInPreferredEditor,
  openProjectInPreferredEditor,
  onOpenPromptsRepository,
  onOpenRepositoryMainOwner,
  onConfigureRepositoryMainSessionRun,
  onStartRepositoryRunCommand,
  onStopRepositoryRunCommand,
  onConfigureRepositorySddMode,
  onConfigureRepositoryIconBadge,
  onConfigureProjectSddMode,
  onConfigureRepositoryOpenApp,
  onConfigureProjectOpenApp,
  onNewPaneSessionForRepository,
  onNewPaneSessionForProject,
  onPromoteFloatingRepository,
  onJoinFloatingRepository,
  onRemoveFloatingRepository,
  onDetachRepositoryFromProject,
  onReorderRepositoriesInProject,
  onMoveRepositoryToProject,
  onMoveRepositoryToProjectWithExpand,
  onProjectDropTargetChange,
  onClearRepoSidebarDrag,
  onMoveRepositoryError,
  projectTrellisReadyById = {},
  repositoryTrellisReadyById = {},
  scheduledTasksByRepoId = {},
  requirementUnsplitByProjectId = {},
  requirementUnsplitByRepoId = {},
  executableTasksByProjectId = {},
  executableTasksByRepoId = {},
  workspaceTodosEnabled = true,
  onOpenGlobalWorkspaceTodoAdd,
  onOpenScheduledTasksForRepository,
  onOpenScheduledTasksForProject,
  onOpenRepositoryRequirements,
  onOpenExecutableTasksForProject,
  onOpenExecutableTasksForRepository,
  runningMainSessionByProjectId = {},
  runningMainSessionByRepositoryId = {},
  onStopProjectMainSession,
  onStopRepositoryMainSession,
  sectionCollapsed = false,
  onSectionCollapsedChange,
}: ProjectRepositoryListProps) {
  const setSectionCollapsed = onSectionCollapsedChange;
  const repositoryListScrollRef = useRef<HTMLDivElement>(null);
  useScrollEndClass(
    repositoryListScrollRef,
    [LEFT_SIDEBAR_SCROLLING_CLASS, "app-repository-list--scrolling"],
    280,
    {
      relieveSidePanelPriority: true,
      relieveWorkspacePriority: true,
    },
  );

  const runCommandRowPinnedMap = useRepositoryRunCommandRowPinnedMap();

  const projectReposByProjectId = useMemo(() => {
    const map = new Map<string, Repository[]>();
    for (const project of projects) {
      map.set(
        project.id,
        project.repositoryIds
          .map((id) => repositoriesById.get(id))
          .filter((item): item is Repository => Boolean(item)),
      );
    }
    return map;
  }, [projects, repositoriesById]);

  const onWorkspaceListPointerEnter = useCallback(() => {
    setWorkspacePointerActive(true);
  }, []);
  const onWorkspaceListPointerLeave = useCallback(() => {
    setWorkspacePointerActive(false);
  }, []);

  useEffect(() => {
    return () => {
      setWorkspacePointerActive(false);
    };
  }, []);

  return (
    <>
      <div className="app-repository-header">
        <Typography.Text className="app-repository-header-title">
          工作区
        </Typography.Text>
        <div className="app-repository-header-actions">
          {workspaceTodosEnabled && onOpenGlobalWorkspaceTodoAdd ? (
            <DeferredHoverTooltip title="添加待办事项">
              <button
                className="app-repository-header-btn"
                aria-label="添加待办事项"
                onClick={onOpenGlobalWorkspaceTodoAdd}
              >
                <WorkspaceRemindersIcon />
              </button>
            </DeferredHoverTooltip>
          ) : null}
          {onAddFloatingRepositoryClick ? (
            <DeferredHoverTooltip title="添加单仓（不绑定工作区）">
              <button
                className="app-repository-header-btn"
                aria-label="添加单仓"
                onClick={onAddFloatingRepositoryClick}
              >
                <PlusIcon />
              </button>
            </DeferredHoverTooltip>
          ) : null}
          <DeferredHoverTooltip title="新建工作区">
            <button
              className="app-repository-header-btn"
              aria-label="新建工作区"
              onClick={onCreateProjectClick}
            >
              <ProjectIcon />
            </button>
          </DeferredHoverTooltip>
          {setSectionCollapsed ? (
            <DeferredHoverTooltip
              title={sectionCollapsed ? "展开工作区列表" : "收起工作区列表"}
            >
              <button
                type="button"
                className="app-repository-header-btn"
                aria-expanded={!sectionCollapsed}
                aria-label={sectionCollapsed ? "展开工作区列表" : "收起工作区列表"}
                onClick={() => setSectionCollapsed(!sectionCollapsed)}
              >
                <ExpandIcon expanded={!sectionCollapsed} />
              </button>
            </DeferredHoverTooltip>
          ) : null}
        </div>
      </div>

      {!sectionCollapsed ? (
      <div
        className={
          showRepositoryIconBadgesInWorkspaceList
            ? "app-repository-list"
            : "app-repository-list app-repository-list--hide-icon-badges"
        }
        ref={repositoryListScrollRef}
        onMouseEnter={onWorkspaceListPointerEnter}
        onMouseLeave={onWorkspaceListPointerLeave}
      >
        {floatingRepositories.length > 0 ? (
          <div className="app-repository-floating-group" aria-label="单仓">
            {floatingRepositories.map((repository) => (
              <FloatingRepositoryRow
                key={repository.id}
                repository={repository}
                isActiveRepository={repository.id === activeRepositoryId && !activeProjectId}
                joinableProjects={projects}
                onRepositorySelect={onRepositorySelect}
                onOpenTaskMode={onCreateRepositoryTask}
                onOpenInFinder={onOpenInFinder}
                onOpenInTerminal={onOpenInTerminal}
                onOpenRepositoryInBrowser={onOpenRepositoryInBrowser}
                onOpenRepositoryInEditor={openRepositoryInPreferredEditor}
                onConfigureRepositoryOpenApp={onConfigureRepositoryOpenApp}
                onOpenRepositoryMainOwner={onOpenRepositoryMainOwner}
                onConfigureRepositoryMainSessionRun={onConfigureRepositoryMainSessionRun}
                onStartRepositoryRunCommand={onStartRepositoryRunCommand}
                onStopRepositoryRunCommand={onStopRepositoryRunCommand}
                onConfigureSddMode={onConfigureRepositorySddMode}
                onConfigureRepositoryIconBadge={onConfigureRepositoryIconBadge}
                showRepositoryIconBadgesInWorkspaceList={showRepositoryIconBadgesInWorkspaceList}
                onNewPaneSession={onNewPaneSessionForRepository}
                onBootstrapTrellis={onBootstrapTrellisForRepository}
                onPromoteToNewProject={onPromoteFloatingRepository}
                onJoinExistingProject={onJoinFloatingRepository}
                onRemove={onRemoveFloatingRepository}
                trellisReady={repositoryTrellisReadyById[repository.id] === true}
                onOpenFloatingRepositoryTrellis={onOpenFloatingRepositoryTrellis}
                scheduledTasksTotalCount={scheduledTasksByRepoId[repository.id]?.total ?? 0}
                scheduledTasksEnabledCount={scheduledTasksByRepoId[repository.id]?.enabled ?? 0}
                requirementUnsplitCount={requirementUnsplitByRepoId[repository.id] ?? 0}
                executableTaskCount={executableTasksByRepoId[repository.id] ?? 0}
                workspaceTodosEnabled={workspaceTodosEnabled}
                onOpenScheduledTasks={onOpenScheduledTasksForRepository}
                onOpenRequirements={onOpenRepositoryRequirements}
                onOpenExecutableTasks={onOpenExecutableTasksForRepository}
                mainSessionRunning={runningMainSessionByRepositoryId[repository.id] === true}
                onStopMainSession={
                  onStopRepositoryMainSession
                    ? () => onStopRepositoryMainSession(repository)
                    : undefined
                }
                pinnedRunCommandRowActions={runCommandRowPinnedMap[repository.id] === true}
              />
            ))}
          </div>
        ) : null}
        {projects.map((project) => (
          <MemoProjectRow
            key={project.id}
            project={project}
            projectRepos={projectReposByProjectId.get(project.id) ?? EMPTY_PROJECT_REPOS}
            isActiveProject={project.id === activeProjectId && activeWorkspaceFocus === "project"}
            activeRepositoryId={activeRepositoryId}
            activeRepositoryIdInProject={resolveActiveRepositoryIdInProject(
              project,
              activeRepositoryId,
            )}
            showRepositoryIconBadgesInWorkspaceList={showRepositoryIconBadgesInWorkspaceList}
            activeWorkspaceFocus={activeWorkspaceFocus}
            isPinned={pinnedProjectIds.includes(project.id)}
            expanded={expandedProjects.has(project.id)}
            projectDropTargetId={projectDropTargetId}
            repoSidebarDragRef={repoSidebarDragRef}
            onProjectSelect={onProjectSelect}
            onRepositorySelect={onRepositorySelect}
            onToggleProjectExpand={onToggleProjectExpand}
            onTogglePinProject={onTogglePinProject}
            onRenameProject={onRenameProject}
            onDeleteProject={onDeleteProject}
            onOpenPromptsProject={onOpenPromptsProject}
            onOpenProjectTrellis={onOpenProjectTrellis}
            onAddRepositoryToProject={onAddRepositoryToProjectClick}
            onCreateProjectTask={onCreateProjectTask}
            onCreateRepositoryTask={onCreateRepositoryTask}
            onOpenWorkspaceRequirements={onOpenWorkspaceRequirements}
            onReconcileProject={onReconcileProject}
            onBootstrapTrellisForProject={onBootstrapTrellisForProject}
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
            onConfigureRepositorySddMode={onConfigureRepositorySddMode}
            onConfigureRepositoryIconBadge={onConfigureRepositoryIconBadge}
            onConfigureProjectSddMode={onConfigureProjectSddMode}
            onConfigureRepositoryOpenApp={onConfigureRepositoryOpenApp}
            onConfigureProjectOpenApp={onConfigureProjectOpenApp}
            onNewPaneSessionForRepository={onNewPaneSessionForRepository}
            onNewPaneSessionForProject={onNewPaneSessionForProject}
            onDetachRepositoryFromProject={onDetachRepositoryFromProject}
            onReorderRepositoriesInProject={onReorderRepositoriesInProject}
            onMoveRepositoryToProject={onMoveRepositoryToProject}
            onMoveRepositoryToProjectWithExpand={onMoveRepositoryToProjectWithExpand}
            onProjectDropTargetChange={onProjectDropTargetChange}
            onClearRepoSidebarDrag={onClearRepoSidebarDrag}
            onMoveRepositoryError={onMoveRepositoryError}
            projectTrellisReadyById={projectTrellisReadyById}
            repositoryTrellisReadyById={repositoryTrellisReadyById}
            scheduledTasksByRepoId={scheduledTasksByRepoId}
            requirementUnsplitByProjectId={requirementUnsplitByProjectId}
            requirementUnsplitByRepoId={requirementUnsplitByRepoId}
            onOpenScheduledTasksForRepository={onOpenScheduledTasksForRepository}
            onOpenScheduledTasksForProject={onOpenScheduledTasksForProject}
            onOpenRepositoryRequirements={onOpenRepositoryRequirements}
            executableTasksByProjectId={executableTasksByProjectId}
            executableTasksByRepoId={executableTasksByRepoId}
            workspaceTodosEnabled={workspaceTodosEnabled}
            onOpenExecutableTasksForProject={onOpenExecutableTasksForProject}
            onOpenExecutableTasksForRepository={onOpenExecutableTasksForRepository}
            mainSessionRunning={runningMainSessionByProjectId[project.id] === true}
            onStartRepositoryRunCommand={onStartRepositoryRunCommand}
            onStopRepositoryRunCommand={onStopRepositoryRunCommand}
            onStopProjectMainSession={onStopProjectMainSession}
            runningMainSessionByRepositoryId={runningMainSessionByRepositoryId}
            onStopRepositoryMainSession={onStopRepositoryMainSession}
            runCommandRowPinnedMap={runCommandRowPinnedMap}
          />
        ))}
        {projects.length === 0 && floatingRepositories.length === 0 && (
          <div className="app-repository-item app-repository-item--add" onClick={onCreateProjectClick}>
            <span className="app-repository-add-icon"><PlusIcon /></span>
            <span className="app-repository-add-text">新建工作区</span>
          </div>
        )}
      </div>
      ) : null}
    </>
  );
}

function ProjectTrellisAction({ onOpen }: { onOpen: () => void }) {
  return <RepositoryTrellisAction variant="project" onOpen={onOpen} />;
}

interface ProjectRowProps {
  project: Workspace;
  projectRepos: Repository[];
  isActiveProject: boolean;
  activeRepositoryId: number | null;
  activeRepositoryIdInProject: number | null;
  showRepositoryIconBadgesInWorkspaceList?: boolean;
  activeWorkspaceFocus: WorkspaceFocus;
  isPinned: boolean;
  expanded: boolean;
  projectDropTargetId: string | null;
  repoSidebarDragRef: MutableRefObject<{ sourceProjectId: string; repositoryId: number } | null>;
  onProjectSelect: (projectId: Workspace["id"]) => void;
  onRepositorySelect: (id: number | null) => void;
  onToggleProjectExpand: (projectId: string) => void;
  onTogglePinProject: (projectId: string) => void;
  onRenameProject: (project: Workspace) => void;
  onDeleteProject: (project: Workspace) => void;
  onOpenPromptsProject?: (project: Workspace) => void;
  onOpenProjectTrellis?: (project: Workspace) => void;
  onAddRepositoryToProject?: (projectId: Workspace["id"]) => void;
  onCreateProjectTask: (project: Workspace, mode: TaskMode) => void;
  onCreateRepositoryTask: (repository: Repository, mode: TaskMode) => void;
  onOpenWorkspaceRequirements?: (project: Workspace) => void;
  onOpenRepositoryRequirements?: (repository: Repository) => void;
  onReconcileProject?: (projectId: string, mode: ReconcileProjectMode) => void | Promise<void>;
  onBootstrapTrellisForProject?: (project: Workspace) => void | Promise<void>;
  onOpenInFinder: (repository: Repository) => void;
  onOpenProjectInFinder?: (project: Workspace) => void;
  onOpenInTerminal?: (repository: Repository) => void;
  onOpenProjectInTerminal?: (project: Workspace) => void;
  onOpenRepositoryInBrowser: (repository: Repository) => void;
  openRepositoryInPreferredEditor: (repository: Repository) => void;
  openProjectInPreferredEditor?: (project: Workspace) => void;
  onOpenPromptsRepository?: (project: Workspace, repository: Repository) => void;
  onOpenRepositoryMainOwner?: (repository: Repository) => void;
  onConfigureRepositoryMainSessionRun?: (repository: Repository) => void;
  onStartRepositoryRunCommand?: (repository: Repository) => void;
  onStopRepositoryRunCommand?: (repository: Repository) => void;
  onConfigureRepositorySddMode?: (repository: Repository) => void;
  onConfigureRepositoryIconBadge?: (repository: Repository) => void;
  onConfigureProjectSddMode?: (project: Workspace) => void;
  onConfigureRepositoryOpenApp?: (repository: Repository, openAppId: string | null) => void;
  onConfigureProjectOpenApp?: (project: Workspace, openAppId: string | null) => void;
  onNewPaneSessionForRepository?: (repository: Repository) => void;
  onNewPaneSessionForProject?: (project: Workspace) => void;
  onDetachRepositoryFromProject: (projectId: string, repositoryId: number) => void;
  onReorderRepositoriesInProject?: (projectId: string, repositoryIds: number[]) => void | Promise<void>;
  onMoveRepositoryToProject?: (targetProjectId: string, repositoryId: number) => void | Promise<void>;
  onMoveRepositoryToProjectWithExpand: (targetProjectId: string, repositoryId: number) => Promise<void>;
  onProjectDropTargetChange: (projectId: string | null | ((cur: string | null) => string | null)) => void;
  onClearRepoSidebarDrag: () => void;
  onMoveRepositoryError: (message: string, err: unknown) => void;
  projectTrellisReadyById?: Record<string, boolean>;
  repositoryTrellisReadyById?: Record<number, boolean>;
  scheduledTasksByRepoId?: Record<number, SidebarScheduledTasksSummary>;
  requirementUnsplitByProjectId?: Record<string, number>;
  requirementUnsplitByRepoId?: Record<number, number>;
  executableTasksByProjectId?: Record<string, number>;
  executableTasksByRepoId?: Record<number, number>;
  /** 默认配置关闭待办时隐藏侧栏菜单、徽章与 Popover。 */
  workspaceTodosEnabled?: boolean;
  onOpenScheduledTasksForRepository?: (repository: Repository) => void;
  onOpenScheduledTasksForProject?: (project: Workspace) => void;
  onOpenExecutableTasksForProject?: (project: Workspace) => void;
  onOpenExecutableTasksForRepository?: (repository: Repository) => void;
  mainSessionRunning?: boolean;
  onStopProjectMainSession?: (projectId: string) => void;
  runningMainSessionByRepositoryId?: Record<number, boolean>;
  onStopRepositoryMainSession?: (repository: Repository) => void;
  runCommandRowPinnedMap?: RepositoryRunCommandRowPinnedMap;
}

function ProjectRow({
  project,
  projectRepos,
  isActiveProject,
  activeRepositoryId,
  showRepositoryIconBadgesInWorkspaceList = false,
  activeWorkspaceFocus,
  isPinned,
  expanded,
  projectDropTargetId,
  repoSidebarDragRef,
  onProjectSelect,
  onRepositorySelect,
  onToggleProjectExpand,
  onTogglePinProject,
  onRenameProject,
  onDeleteProject,
  onOpenProjectTrellis,
  onAddRepositoryToProject,
  onCreateProjectTask,
  onCreateRepositoryTask,
  onOpenWorkspaceRequirements,
  onReconcileProject,
  onBootstrapTrellisForProject,
  onOpenInFinder,
  onOpenProjectInFinder,
  onOpenInTerminal,
  onOpenProjectInTerminal,
  onOpenRepositoryInBrowser,
  openRepositoryInPreferredEditor,
  openProjectInPreferredEditor,
  onOpenRepositoryMainOwner,
  onConfigureRepositoryMainSessionRun,
  onStartRepositoryRunCommand,
  onStopRepositoryRunCommand,
  onConfigureRepositorySddMode,
  onConfigureRepositoryIconBadge,
  onConfigureProjectSddMode,
  onConfigureRepositoryOpenApp,
  onConfigureProjectOpenApp,
  onNewPaneSessionForRepository,
  onNewPaneSessionForProject,
  onDetachRepositoryFromProject,
  onReorderRepositoriesInProject,
  onMoveRepositoryToProject,
  onMoveRepositoryToProjectWithExpand,
  onProjectDropTargetChange,
  onClearRepoSidebarDrag,
  onMoveRepositoryError,
  projectTrellisReadyById = {},
  repositoryTrellisReadyById = {},
  scheduledTasksByRepoId = {},
  requirementUnsplitByProjectId = {},
  requirementUnsplitByRepoId = {},
  executableTasksByProjectId = {},
  executableTasksByRepoId = {},
  workspaceTodosEnabled = true,
  onOpenScheduledTasksForRepository,
  onOpenScheduledTasksForProject,
  onOpenRepositoryRequirements,
  onOpenExecutableTasksForProject,
  onOpenExecutableTasksForRepository,
  mainSessionRunning = false,
  onStopProjectMainSession,
  runningMainSessionByRepositoryId = {},
  onStopRepositoryMainSession,
  runCommandRowPinnedMap = {},
}: ProjectRowProps) {
  const projectTrellisReady = projectTrellisReadyById[project.id] === true;
  const projectTrellisEnabled = project.sddMode !== "project_owned" || projectTrellisReady;
  const openWorkspaceRequirements = () => {
    if (onOpenWorkspaceRequirements) {
      onOpenWorkspaceRequirements(project);
      return;
    }
    onCreateProjectTask(project, "split");
  };
  const projectScheduledTasksEnabled = sumProjectScheduledTasksEnabled(
    project.repositoryIds,
    scheduledTasksByRepoId,
  );
  const projectScheduledTasksTotal = sumProjectScheduledTasksTotal(
    project.repositoryIds,
    scheduledTasksByRepoId,
  );
  const projectRequirementUnsplitCount = requirementUnsplitByProjectId[project.id] ?? 0;
  const projectExecutableTaskCount = executableTasksByProjectId[project.id] ?? 0;
  const projectMoreItems = buildProjectMoreMenuItems({
    isPinned,
    trellisEnabled: projectTrellisEnabled,
    trellisReady: projectTrellisReady,
    onAddRepositoryToProject: Boolean(onAddRepositoryToProject),
    onOpenProjectDirectory: Boolean(onOpenProjectInFinder),
    onOpenProjectInEditor: Boolean(openProjectInPreferredEditor),
    onOpenProjectInTerminal: Boolean(onOpenProjectInTerminal),
    onConfigureSddMode: Boolean(onConfigureProjectSddMode),
    onNewPaneSession: Boolean(onNewPaneSessionForProject),
    onOpenScheduledTasksForProject: Boolean(onOpenScheduledTasksForProject),
    onOpenExecutableTasksForProject: Boolean(onOpenExecutableTasksForProject),
    onReconcileProject: Boolean(onReconcileProject),
    onAddWorkspaceTodo: workspaceTodosEnabled,
    projectOpenAppId: project.openAppId,
  });

  return (
    <div
      className={`app-repository-row${projectDropTargetId === project.id ? " app-repository-row--project-drop" : ""}`}
      onDragOver={
        onMoveRepositoryToProject
          ? (e) => {
              const dragged = repoSidebarDragRef.current;
              if (!dragged || dragged.sourceProjectId === project.id) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              onProjectDropTargetChange(project.id);
            }
          : undefined
      }
      onDragLeave={
        onMoveRepositoryToProject
          ? (e) => {
              const related = e.relatedTarget as Node | null;
              if (related && (e.currentTarget as HTMLElement).contains(related)) return;
              onProjectDropTargetChange((cur) => (cur === project.id ? null : cur));
            }
          : undefined
      }
      onDrop={
        onMoveRepositoryToProject
          ? (e) => {
              e.preventDefault();
              const dragged = repoSidebarDragRef.current;
              onClearRepoSidebarDrag();
              if (!dragged || dragged.sourceProjectId === project.id) return;
              void onMoveRepositoryToProjectWithExpand(project.id, dragged.repositoryId).catch((err: unknown) => {
                onMoveRepositoryError("移动仓库到工作区失败", err);
              });
            }
          : undefined
      }
    >
      <div
        className={`app-repository-item app-repository-item--project${isActiveProject ? " app-repository-item--project-active" : ""}`}
        onClick={(e) => {
          if (e.defaultPrevented) return;
          const target = e.target as HTMLElement | null;
          if (
            target?.closest(".app-repository-row-actions") ||
            target?.closest(".app-repository-main-session-running-dot-wrap") ||
            target?.closest(".ant-dropdown-menu")
          ) {
            return;
          }
          onProjectSelect(project.id);
        }}
      >
        <span
          className="app-repository-expand"
          onClick={(e) => {
            e.stopPropagation();
            onToggleProjectExpand(project.id);
          }}
          aria-expanded={expanded}
          aria-label={expanded ? "收起工作区" : "展开工作区"}
        >
          <ExpandIcon expanded={expanded} />
        </span>
        <span className="app-repository-name-block">
          <span className="app-repository-name">{project.name}</span>
          {mainSessionRunning ? (
            <RunningMainSessionDot
              runningTitle="工作区主会话运行中"
              stopTitle="结束工作区主会话"
              onStop={
                onStopProjectMainSession ? () => onStopProjectMainSession(project.id) : undefined
              }
            />
          ) : null}
          {projectRepos.length > 0 ? (
            <span className="app-repository-meta" aria-label={`${projectRepos.length} 个仓库`}>
              {projectRepos.length}
            </span>
          ) : null}
          {isPinned ? (
            <DeferredHoverTooltip title="已置顶：工作区固定在列表顶部">
              <span className="app-repository-pin-hit" aria-label="已置顶：工作区固定在列表顶部">
                <span className="app-repository-pin" aria-hidden />
              </span>
            </DeferredHoverTooltip>
          ) : null}
        </span>
        <div className="app-repository-row-actions app-repository-row-actions--project">
          {projectTrellisEnabled && projectTrellisReady && onOpenProjectTrellis ? (
            <ProjectTrellisAction onOpen={() => onOpenProjectTrellis(project)} />
          ) : null}
          {projectTrellisEnabled ? (
            <SidebarRequirementAction
              variant="project"
              unsplitCount={projectRequirementUnsplitCount}
              onOpen={openWorkspaceRequirements}
            />
          ) : null}
          {onOpenScheduledTasksForProject ? (
            <SidebarScheduledTasksAction
              variant="project"
              totalCount={projectScheduledTasksTotal}
              enabledCount={projectScheduledTasksEnabled}
              onOpen={() => onOpenScheduledTasksForProject(project)}
            />
          ) : null}
          {projectTrellisEnabled && onOpenExecutableTasksForProject ? (
            <SidebarExecutableTasksAction
              variant="project"
              executableCount={projectExecutableTaskCount}
              onOpen={() => onOpenExecutableTasksForProject(project)}
            />
          ) : null}
          {openProjectInPreferredEditor ? (
            <OpenInEditorAction
              scopeOpenAppId={project.openAppId}
              onOpen={() => openProjectInPreferredEditor(project)}
            />
          ) : null}
          {onOpenProjectInTerminal ? (
            <OpenInTerminalAction onOpen={() => onOpenProjectInTerminal(project)} />
          ) : null}
          <SidebarWorkspaceRemindersAction
            enabled={workspaceTodosEnabled}
            variant="project"
            projectId={project.id}
            repositoryId={null}
          />
          <SidebarMoreMenuDropdown
            items={projectMoreItems}
            onMenuClick={({ key, domEvent }) => {
              domEvent?.preventDefault();
              domEvent?.stopPropagation();
              if (key === "add-workspace-todo") {
                if (!workspaceTodosEnabled) return;
                onProjectSelect(project.id);
                openWorkspaceTodosFromSidebarMenu({
                  projectId: project.id,
                  repositoryId: null,
                });
                return;
              }
              if (key === "pin") onTogglePinProject(project.id);
              if (key === "rename") onRenameProject(project);
              if (key === "open-directory") onOpenProjectInFinder?.(project);
              if (key === "editor") openProjectInPreferredEditor?.(project);
              if (key === "add-repository") onAddRepositoryToProject?.(project.id);
              if (key === "sdd-mode") onConfigureProjectSddMode?.(project);
              if (key === "new-session") onNewPaneSessionForProject?.(project);
              if (key === "open-terminal") onOpenProjectInTerminal?.(project);
              if (key === "scheduled-tasks") onOpenScheduledTasksForProject?.(project);
              if (key === "requirements" && projectTrellisEnabled) openWorkspaceRequirements();
              if (key === "executable-tasks" && projectTrellisEnabled) onOpenExecutableTasksForProject?.(project);
              if (key === "trellis-init") void Promise.resolve(onBootstrapTrellisForProject?.(project));
              if (key === "reconcile-repos") void Promise.resolve(onReconcileProject?.(project.id, "repos_only"));
              if (key === "reconcile-repos-graphs") {
                void Promise.resolve(onReconcileProject?.(project.id, "repos_and_graphs"));
              }
              if (key === "delete") onDeleteProject(project);
              if (typeof key === "string") {
                const openAppId = parseOpenAppConfigureMenuKey(key);
                if (openAppId !== undefined) onConfigureProjectOpenApp?.(project, openAppId);
              }
            }}
            trigger={["click"]}
            placement="bottomRight"
          >
            <button
              type="button"
              className="app-repository-action app-repository-action--more"
              aria-label="工作区更多操作"
              data-workspace-todos-anchor={
                workspaceTodosEnabled
                  ? workspaceTodosAnchorKey(project.id, null) ?? undefined
                  : undefined
              }
              onClick={(e) => e.stopPropagation()}
            >
              <MoreIcon />
            </button>
          </SidebarMoreMenuDropdown>
        </div>
      </div>

      {expanded && projectRepos.length > 0 ? (
        <div className="app-repository-sessions">
          <ProjectRepositoryRows
            project={project}
            projectRepos={projectRepos}
            activeRepositoryId={activeRepositoryId}
            activeWorkspaceFocus={activeWorkspaceFocus}
            onRepositorySelect={onRepositorySelect}
            onCreateRepositoryTask={onCreateRepositoryTask}
            onDetachRepositoryFromProject={onDetachRepositoryFromProject}
            onOpenInFinder={onOpenInFinder}
            onOpenInTerminal={onOpenInTerminal}
            onOpenRepositoryInBrowser={onOpenRepositoryInBrowser}
            openRepositoryInPreferredEditor={openRepositoryInPreferredEditor}
            onConfigureRepositoryOpenApp={onConfigureRepositoryOpenApp}
            onOpenRepositoryMainOwner={onOpenRepositoryMainOwner}
            onReorderRepositoriesInProject={onReorderRepositoriesInProject}
            onMoveRepositoryToProject={onMoveRepositoryToProjectWithExpand}
            onConfigureSddMode={onConfigureRepositorySddMode}
            onConfigureRepositoryIconBadge={onConfigureRepositoryIconBadge}
            showRepositoryIconBadgesInWorkspaceList={showRepositoryIconBadgesInWorkspaceList}
            onConfigureRepositoryMainSessionRun={onConfigureRepositoryMainSessionRun}
            onNewPaneSession={onNewPaneSessionForRepository}
            repoSidebarDragRef={repoSidebarDragRef}
            onRepoSidebarDragEnd={onClearRepoSidebarDrag}
            hideChatAction={
              resolveWorkspaceMode({
                activeProjectId: project.id,
                projects: [project],
              }) === "multi_repo"
            }
            repositoryTrellisReadyById={repositoryTrellisReadyById}
            scheduledTasksByRepoId={scheduledTasksByRepoId}
            requirementUnsplitByRepoId={requirementUnsplitByRepoId}
            executableTasksByRepoId={executableTasksByRepoId}
            workspaceTodosEnabled={workspaceTodosEnabled}
            onOpenScheduledTasks={onOpenScheduledTasksForRepository}
            onOpenRepositoryRequirements={onOpenRepositoryRequirements}
            onOpenRepositoryExecutableTasks={onOpenExecutableTasksForRepository}
            onStartRepositoryRunCommand={onStartRepositoryRunCommand}
            onStopRepositoryRunCommand={onStopRepositoryRunCommand}
            runningMainSessionByRepositoryId={runningMainSessionByRepositoryId}
            onStopRepositoryMainSession={onStopRepositoryMainSession}
            runCommandRowPinnedMap={runCommandRowPinnedMap}
          />
        </div>
      ) : null}
    </div>
  );
}

const MemoProjectRow = memo(ProjectRow, projectRowPropsEqual);

export const ProjectRepositoryList = memo(
  ProjectRepositoryListInner,
  projectRepositoryListPropsEqual,
);
