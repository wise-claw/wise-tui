import type { MutableRefObject } from "react";
import { Dropdown, Tooltip, Typography } from "antd";
import type { ReconcileProjectMode } from "../../constants/reconcileProjectMode";
import type { Repository, StandaloneRepo, TaskMode, Workspace } from "../../types";
import type { SidebarCodeGraphIndexStatus } from "./useSidebarCodeGraphIndexMap";
import {
  sumProjectScheduledTasksEnabled,
  sumProjectScheduledTasksTotal,
  type SidebarScheduledTasksSummary,
} from "./useSidebarScheduledTasksMap";
import { resolveWorkspaceMode } from "../../utils/workspaceMode";
import { buildProjectMoreMenuItems } from "./sidebarMoreMenuItems";
import {
  ExpandIcon,
  MoreIcon,
  PlusIcon,
  ProjectIcon,
  TrellisIcon,
} from "./SidebarIcons";
import {
  FloatingRepositoryRow,
  ProjectRepositoryRows,
  RepositoryCodeGraphAction,
  SidebarExecutableTasksAction,
  SidebarRequirementAction,
  SidebarScheduledTasksAction,
} from "./repositoryRows";

interface ProjectRepositoryListProps {
  projects: Workspace[];
  repositoriesById: Map<number, Repository>;
  floatingRepositories: StandaloneRepo[];
  activeProjectId: string | null;
  activeRepositoryId: number | null;
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
  onCodeGraphGenerateProject?: (project: Workspace) => void | Promise<void>;
  onCodeGraphViewProject?: (project: Workspace) => void;
  onCodeGraphGenerateRepository?: (repository: Repository) => void | Promise<void>;
  onCodeGraphViewRepositoryInProject?: (project: Workspace, repository: Repository) => void;
  onCodeGraphViewFloatingRepository?: (repository: Repository) => void;
  onToggleProjectExpand: (projectId: string) => void;
  onTogglePinProject: (projectId: string) => void;
  onRenameProject: (project: Workspace) => void;
  onDeleteProject: (project: Workspace) => void;
  onOpenPromptsProject?: (project: Workspace) => void;
  onOpenProjectTrellis?: (project: Workspace) => void;
  onCreateProjectTask: (project: Workspace, mode: TaskMode) => void;
  onCreateRepositoryTask: (repository: Repository, mode: TaskMode) => void;
  onOpenInFinder: (repository: Repository) => void;
  openRepositoryInPreferredEditor: (repository: Repository) => void;
  onOpenPromptsRepository?: (project: Workspace, repository: Repository) => void;
  onOpenRepositoryMainOwner?: (repository: Repository) => void;
  onConfigureRepositorySddMode?: (repository: Repository) => void;
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
  codeGraphIndexStatusByRepoId?: Record<number, SidebarCodeGraphIndexStatus>;
  scheduledTasksByRepoId?: Record<number, SidebarScheduledTasksSummary>;
  requirementUnsplitByProjectId?: Record<string, number>;
  requirementUnsplitByRepoId?: Record<number, number>;
  executableTasksByProjectId?: Record<string, number>;
  executableTasksByRepoId?: Record<number, number>;
  onOpenScheduledTasksForRepository?: (repository: Repository) => void;
  onOpenScheduledTasksForProject?: (project: Workspace) => void;
  onOpenRepositoryRequirements?: (repository: Repository) => void;
  onOpenExecutableTasksForProject?: (project: Workspace) => void;
  onOpenExecutableTasksForRepository?: (repository: Repository) => void;
}

export function ProjectRepositoryList({
  projects,
  repositoriesById,
  floatingRepositories,
  activeProjectId,
  activeRepositoryId,
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
  onCodeGraphGenerateProject,
  onCodeGraphViewProject,
  onCodeGraphGenerateRepository,
  onCodeGraphViewRepositoryInProject,
  onCodeGraphViewFloatingRepository,
  onToggleProjectExpand,
  onTogglePinProject,
  onRenameProject,
  onDeleteProject,
  onOpenPromptsProject,
  onOpenProjectTrellis,
  onCreateProjectTask,
  onCreateRepositoryTask,
  onOpenInFinder,
  openRepositoryInPreferredEditor,
  onOpenPromptsRepository,
  onOpenRepositoryMainOwner,
  onConfigureRepositorySddMode,
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
  codeGraphIndexStatusByRepoId = {},
  scheduledTasksByRepoId = {},
  requirementUnsplitByProjectId = {},
  requirementUnsplitByRepoId = {},
  executableTasksByProjectId = {},
  executableTasksByRepoId = {},
  onOpenScheduledTasksForRepository,
  onOpenScheduledTasksForProject,
  onOpenRepositoryRequirements,
  onOpenExecutableTasksForProject,
  onOpenExecutableTasksForRepository,
}: ProjectRepositoryListProps) {
  return (
    <>
      <div className="app-repository-header">
        <Typography.Text className="app-repository-header-title">
          Workspace
        </Typography.Text>
        <div className="app-repository-header-actions">
          {onAddFloatingRepositoryClick ? (
            <Tooltip title="添加 Standalone Repo（不绑定 Workspace）" mouseEnterDelay={0.3}>
              <button
                className="app-repository-header-btn"
                aria-label="添加 Standalone Repo"
                onClick={onAddFloatingRepositoryClick}
              >
                <PlusIcon />
              </button>
            </Tooltip>
          ) : null}
          <Tooltip title="新建 Workspace" mouseEnterDelay={0.3}>
            <button
              className="app-repository-header-btn"
              aria-label="新建 Workspace"
              onClick={onCreateProjectClick}
            >
              <ProjectIcon />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="app-repository-list">
        {floatingRepositories.length > 0 ? (
          <div className="app-repository-floating-group" aria-label="Standalone Repo">
            {floatingRepositories.map((repository) => (
              <FloatingRepositoryRow
                key={repository.id}
                repository={repository}
                isActiveRepository={repository.id === activeRepositoryId && !activeProjectId}
                joinableProjects={projects}
                onRepositorySelect={onRepositorySelect}
                onOpenTaskMode={onCreateRepositoryTask}
                onOpenInFinder={onOpenInFinder}
                onOpenRepositoryInEditor={openRepositoryInPreferredEditor}
                onOpenRepositoryMainOwner={onOpenRepositoryMainOwner}
                onConfigureSddMode={onConfigureRepositorySddMode}
                onCodeGraphGenerateRepository={onCodeGraphGenerateRepository}
                onCodeGraphViewFloatingRepository={onCodeGraphViewFloatingRepository}
                onPromoteToNewProject={onPromoteFloatingRepository}
                onJoinExistingProject={onJoinFloatingRepository}
                onRemove={onRemoveFloatingRepository}
                codeGraphIndexed={codeGraphIndexStatusByRepoId[repository.id] === "done"}
                scheduledTasksTotalCount={scheduledTasksByRepoId[repository.id]?.total ?? 0}
                scheduledTasksEnabledCount={scheduledTasksByRepoId[repository.id]?.enabled ?? 0}
                requirementUnsplitCount={requirementUnsplitByRepoId[repository.id] ?? 0}
                executableTaskCount={executableTasksByRepoId[repository.id] ?? 0}
                onOpenScheduledTasks={onOpenScheduledTasksForRepository}
                onOpenRequirements={onOpenRepositoryRequirements}
                onOpenExecutableTasks={onOpenExecutableTasksForRepository}
              />
            ))}
          </div>
        ) : null}
        {projects.map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            projectRepos={project.repositoryIds
              .map((id) => repositoriesById.get(id))
              .filter((item): item is Repository => Boolean(item))}
            isActiveProject={project.id === activeProjectId}
            activeRepositoryId={activeRepositoryId}
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
            onReconcileProject={onReconcileProject}
            onCodeGraphGenerateProject={onCodeGraphGenerateProject}
            onCodeGraphViewProject={onCodeGraphViewProject}
            onCodeGraphGenerateRepository={onCodeGraphGenerateRepository}
            onCodeGraphViewRepositoryInProject={onCodeGraphViewRepositoryInProject}
            onOpenInFinder={onOpenInFinder}
            openRepositoryInPreferredEditor={openRepositoryInPreferredEditor}
            onOpenPromptsRepository={onOpenPromptsRepository}
            onOpenRepositoryMainOwner={onOpenRepositoryMainOwner}
            onConfigureRepositorySddMode={onConfigureRepositorySddMode}
            onDetachRepositoryFromProject={onDetachRepositoryFromProject}
            onReorderRepositoriesInProject={onReorderRepositoriesInProject}
            onMoveRepositoryToProject={onMoveRepositoryToProject}
            onMoveRepositoryToProjectWithExpand={onMoveRepositoryToProjectWithExpand}
            onProjectDropTargetChange={onProjectDropTargetChange}
            onClearRepoSidebarDrag={onClearRepoSidebarDrag}
            onMoveRepositoryError={onMoveRepositoryError}
            codeGraphIndexStatusByRepoId={codeGraphIndexStatusByRepoId}
            scheduledTasksByRepoId={scheduledTasksByRepoId}
            requirementUnsplitByProjectId={requirementUnsplitByProjectId}
            requirementUnsplitByRepoId={requirementUnsplitByRepoId}
            onOpenScheduledTasksForRepository={onOpenScheduledTasksForRepository}
            onOpenScheduledTasksForProject={onOpenScheduledTasksForProject}
            onOpenRepositoryRequirements={onOpenRepositoryRequirements}
            executableTasksByProjectId={executableTasksByProjectId}
            executableTasksByRepoId={executableTasksByRepoId}
            onOpenExecutableTasksForProject={onOpenExecutableTasksForProject}
            onOpenExecutableTasksForRepository={onOpenExecutableTasksForRepository}
          />
        ))}
        {projects.length === 0 && floatingRepositories.length === 0 && (
          <div className="app-repository-item app-repository-item--add" onClick={onCreateProjectClick}>
            <span className="app-repository-add-icon"><PlusIcon /></span>
            <span className="app-repository-add-text">新建 Workspace</span>
          </div>
        )}
      </div>
    </>
  );
}

function ProjectTrellisAction({ onOpen }: { onOpen: () => void }) {
  return (
    <Tooltip title="Workspace Trellis" mouseEnterDelay={0.3}>
      <button
        type="button"
        className="app-repository-action app-repository-action--task app-repository-action--project-quick"
        aria-label="Workspace Trellis"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        <TrellisIcon />
      </button>
    </Tooltip>
  );
}

interface ProjectRowProps {
  project: Workspace;
  projectRepos: Repository[];
  isActiveProject: boolean;
  activeRepositoryId: number | null;
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
  onReconcileProject?: (projectId: string, mode: ReconcileProjectMode) => void | Promise<void>;
  onCodeGraphGenerateProject?: (project: Workspace) => void | Promise<void>;
  onCodeGraphViewProject?: (project: Workspace) => void;
  onCodeGraphGenerateRepository?: (repository: Repository) => void | Promise<void>;
  onCodeGraphViewRepositoryInProject?: (project: Workspace, repository: Repository) => void;
  onOpenInFinder: (repository: Repository) => void;
  openRepositoryInPreferredEditor: (repository: Repository) => void;
  onOpenPromptsRepository?: (project: Workspace, repository: Repository) => void;
  onOpenRepositoryMainOwner?: (repository: Repository) => void;
  onConfigureRepositorySddMode?: (repository: Repository) => void;
  onDetachRepositoryFromProject: (projectId: string, repositoryId: number) => void;
  onReorderRepositoriesInProject?: (projectId: string, repositoryIds: number[]) => void | Promise<void>;
  onMoveRepositoryToProject?: (targetProjectId: string, repositoryId: number) => void | Promise<void>;
  onMoveRepositoryToProjectWithExpand: (targetProjectId: string, repositoryId: number) => Promise<void>;
  onProjectDropTargetChange: (projectId: string | null | ((cur: string | null) => string | null)) => void;
  onClearRepoSidebarDrag: () => void;
  onMoveRepositoryError: (message: string, err: unknown) => void;
  codeGraphIndexStatusByRepoId?: Record<number, SidebarCodeGraphIndexStatus>;
  scheduledTasksByRepoId?: Record<number, SidebarScheduledTasksSummary>;
  requirementUnsplitByProjectId?: Record<string, number>;
  requirementUnsplitByRepoId?: Record<number, number>;
  executableTasksByProjectId?: Record<string, number>;
  executableTasksByRepoId?: Record<number, number>;
  onOpenScheduledTasksForRepository?: (repository: Repository) => void;
  onOpenScheduledTasksForProject?: (project: Workspace) => void;
  onOpenRepositoryRequirements?: (repository: Repository) => void;
  onOpenExecutableTasksForProject?: (project: Workspace) => void;
  onOpenExecutableTasksForRepository?: (repository: Repository) => void;
}

function ProjectRow({
  project,
  projectRepos,
  isActiveProject,
  activeRepositoryId,
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
  onOpenPromptsProject,
  onOpenProjectTrellis,
  onAddRepositoryToProject,
  onCreateProjectTask,
  onCreateRepositoryTask,
  onReconcileProject,
  onCodeGraphGenerateProject,
  onCodeGraphViewProject,
  onCodeGraphGenerateRepository,
  onCodeGraphViewRepositoryInProject,
  onOpenInFinder,
  openRepositoryInPreferredEditor,
  onOpenPromptsRepository,
  onOpenRepositoryMainOwner,
  onConfigureRepositorySddMode,
  onDetachRepositoryFromProject,
  onReorderRepositoriesInProject,
  onMoveRepositoryToProject,
  onMoveRepositoryToProjectWithExpand,
  onProjectDropTargetChange,
  onClearRepoSidebarDrag,
  onMoveRepositoryError,
  codeGraphIndexStatusByRepoId = {},
  scheduledTasksByRepoId = {},
  requirementUnsplitByProjectId = {},
  requirementUnsplitByRepoId = {},
  executableTasksByProjectId = {},
  executableTasksByRepoId = {},
  onOpenScheduledTasksForRepository,
  onOpenScheduledTasksForProject,
  onOpenRepositoryRequirements,
  onOpenExecutableTasksForProject,
  onOpenExecutableTasksForRepository,
}: ProjectRowProps) {
  const projectHasCodeGraph = project.repositoryIds.some(
    (repositoryId) => codeGraphIndexStatusByRepoId[repositoryId] === "done",
  );
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
    onAddRepositoryToProject: Boolean(onAddRepositoryToProject),
    onOpenScheduledTasksForProject: Boolean(onOpenScheduledTasksForProject),
    onOpenExecutableTasksForProject: Boolean(onOpenExecutableTasksForProject),
    onReconcileProject: Boolean(onReconcileProject),
    onCodeGraphGenerateProject: Boolean(onCodeGraphGenerateProject),
    onCodeGraphViewProject: Boolean(onCodeGraphViewProject),
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
                onMoveRepositoryError("移动仓库到 Workspace 失败", err);
              });
            }
          : undefined
      }
    >
      <div
        className={`app-repository-item app-repository-item--project${isActiveProject ? " app-repository-item--project-active" : ""}`}
        onClick={(e) => {
          if ((e.target as HTMLElement | null)?.closest(".app-repository-row-actions")) return;
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
          aria-label={expanded ? "收起 Workspace" : "展开 Workspace"}
        >
          <ExpandIcon expanded={expanded} />
        </span>
        <span className="app-repository-name-block">
          <span className="app-repository-name">{project.name}</span>
          {!expanded && projectRepos.length > 0 ? (
            <span className="app-repository-meta" aria-label={`${projectRepos.length} 个仓库`}>
              {projectRepos.length}
            </span>
          ) : null}
          {isPinned ? (
            <span className="app-repository-pin" aria-label="已置顶" title="已置顶" />
          ) : null}
        </span>
        <div className="app-repository-row-actions app-repository-row-actions--project">
          {onOpenProjectTrellis ? (
            <ProjectTrellisAction onOpen={() => onOpenProjectTrellis(project)} />
          ) : null}
          <SidebarRequirementAction
            variant="project"
            unsplitCount={projectRequirementUnsplitCount}
            onOpen={() => onCreateProjectTask(project, "split")}
          />
          {projectHasCodeGraph && onCodeGraphViewProject ? (
            <RepositoryCodeGraphAction
              variant="project"
              onOpen={() => onCodeGraphViewProject(project)}
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
          {onOpenExecutableTasksForProject ? (
            <SidebarExecutableTasksAction
              variant="project"
              executableCount={projectExecutableTaskCount}
              onOpen={() => onOpenExecutableTasksForProject(project)}
            />
          ) : null}
          <Dropdown
            rootClassName="app-sidebar-more-menu-dropdown"
            menu={{
              className: "app-sidebar-more-menu-inner",
              items: projectMoreItems,
              onClick: ({ key }) => {
                if (key === "pin") onTogglePinProject(project.id);
                if (key === "rename") onRenameProject(project);
                if (key === "add-repository") onAddRepositoryToProject?.(project.id);
                if (key === "scheduled-tasks") onOpenScheduledTasksForProject?.(project);
                if (key === "requirements") onCreateProjectTask(project, "split");
                if (key === "executable-tasks") onOpenExecutableTasksForProject?.(project);
                if (key === "reconcile-repos") void Promise.resolve(onReconcileProject?.(project.id, "repos_only"));
                if (key === "reconcile-repos-graphs") {
                  void Promise.resolve(onReconcileProject?.(project.id, "repos_and_graphs"));
                }
                if (key === "code-graph-generate-project") void Promise.resolve(onCodeGraphGenerateProject?.(project));
                if (key === "code-graph-view-project") onCodeGraphViewProject?.(project);
                if (key === "prompts") onOpenPromptsProject?.(project);
                if (key === "delete") onDeleteProject(project);
              },
            }}
            trigger={["click"]}
            placement="bottomRight"
          >
            <button
              type="button"
              className="app-repository-action app-repository-action--more"
              aria-label="Workspace 更多操作"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreIcon />
            </button>
          </Dropdown>
        </div>
      </div>

      {expanded && projectRepos.length > 0 ? (
        <div className="app-repository-sessions">
          <ProjectRepositoryRows
            project={project}
            projectRepos={projectRepos}
            activeRepositoryId={activeRepositoryId}
            onRepositorySelect={onRepositorySelect}
            onCreateRepositoryTask={onCreateRepositoryTask}
            onDetachRepositoryFromProject={onDetachRepositoryFromProject}
            onOpenInFinder={onOpenInFinder}
            openRepositoryInPreferredEditor={openRepositoryInPreferredEditor}
            onOpenPromptsRepository={onOpenPromptsRepository}
            onOpenRepositoryMainOwner={onOpenRepositoryMainOwner}
            onReorderRepositoriesInProject={onReorderRepositoriesInProject}
            onMoveRepositoryToProject={onMoveRepositoryToProjectWithExpand}
            onConfigureSddMode={onConfigureRepositorySddMode}
            onCodeGraphGenerateRepository={onCodeGraphGenerateRepository}
            onCodeGraphViewRepositoryInProject={onCodeGraphViewRepositoryInProject}
            repoSidebarDragRef={repoSidebarDragRef}
            onRepoSidebarDragEnd={onClearRepoSidebarDrag}
            hideChatAction={
              resolveWorkspaceMode({
                activeProjectId: project.id,
                projects: [project],
              }) === "multi_repo"
            }
            codeGraphIndexStatusByRepoId={codeGraphIndexStatusByRepoId}
            scheduledTasksByRepoId={scheduledTasksByRepoId}
            requirementUnsplitByRepoId={requirementUnsplitByRepoId}
            executableTasksByRepoId={executableTasksByRepoId}
            onOpenScheduledTasks={onOpenScheduledTasksForRepository}
            onOpenRepositoryRequirements={onOpenRepositoryRequirements}
            onOpenRepositoryExecutableTasks={onOpenExecutableTasksForRepository}
          />
        </div>
      ) : null}
    </div>
  );
}
