import type { MutableRefObject } from "react";
import { Dropdown, Tooltip, Typography } from "antd";
import type { MenuProps } from "antd";
import type { ReconcileProjectMode } from "../../constants/reconcileProjectMode";
import type { ProjectItem, Repository, TaskMode } from "../../types";
import { resolveWorkspaceMode } from "../../utils/workspaceMode";
import {
  ExpandIcon,
  MoreIcon,
  PlusIcon,
  ProjectIcon,
  RequirementIcon,
} from "./SidebarIcons";
import {
  FloatingRepositoryRow,
  ProjectRepositoryRows,
} from "./repositoryRows";

interface ProjectRepositoryListProps {
  projects: ProjectItem[];
  repositoriesById: Map<number, Repository>;
  floatingRepositories: Repository[];
  activeProjectId: string | null;
  activeRepositoryId: number | null;
  pinnedProjectIds: string[];
  expandedProjects: Set<string>;
  projectDropTargetId: string | null;
  repoSidebarDragRef: MutableRefObject<{ sourceProjectId: string; repositoryId: number } | null>;
  onProjectSelect: (projectId: string) => void;
  onRepositorySelect: (id: number | null) => void;
  onCreateProjectClick: () => void;
  onAddFloatingRepositoryClick?: () => void;
  onReconcileProject?: (projectId: string, mode: ReconcileProjectMode) => void | Promise<void>;
  onToggleProjectExpand: (projectId: string) => void;
  onTogglePinProject: (projectId: string) => void;
  onRenameProject: (project: ProjectItem) => void;
  onDeleteProject: (project: ProjectItem) => void;
  onOpenPromptsProject?: (project: ProjectItem) => void;
  onCreateProjectTask: (project: ProjectItem, mode: TaskMode) => void;
  onCreateRepositoryTask: (repository: Repository, mode: TaskMode) => void;
  onOpenInFinder: (repository: Repository) => void;
  openRepositoryInPreferredEditor: (repository: Repository) => void;
  onOpenPromptsRepository?: (project: ProjectItem, repository: Repository) => void;
  onOpenRepositoryMainOwner?: (repository: Repository) => void;
  onConfigureRepositorySddMode?: (repository: Repository) => void;
  onPromoteFloatingRepository?: (repository: Repository) => void;
  onJoinFloatingRepository?: (repository: Repository, projectId: string) => void;
  onRemoveFloatingRepository: (repository: Repository) => void;
  onDetachRepositoryFromProject: (projectId: string, repositoryId: number) => void;
  onReorderRepositoriesInProject?: (projectId: string, repositoryIds: number[]) => void | Promise<void>;
  onMoveRepositoryToProject?: (targetProjectId: string, repositoryId: number) => void | Promise<void>;
  onMoveRepositoryToProjectWithExpand: (targetProjectId: string, repositoryId: number) => Promise<void>;
  onProjectDropTargetChange: (projectId: string | null | ((cur: string | null) => string | null)) => void;
  onClearRepoSidebarDrag: () => void;
  onMoveRepositoryError: (message: string, err: unknown) => void;
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
  onReconcileProject,
  onToggleProjectExpand,
  onTogglePinProject,
  onRenameProject,
  onDeleteProject,
  onOpenPromptsProject,
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
}: ProjectRepositoryListProps) {
  return (
    <>
      <div className="app-repository-header">
        <Typography.Text className="app-repository-header-title">
          项目
        </Typography.Text>
        <div className="app-repository-header-actions">
          {onAddFloatingRepositoryClick ? (
            <Tooltip title="添加游离仓库（不绑定项目）" mouseEnterDelay={0.3}>
              <button
                className="app-repository-header-btn"
                aria-label="添加游离仓库"
                onClick={onAddFloatingRepositoryClick}
              >
                <PlusIcon />
              </button>
            </Tooltip>
          ) : null}
          <Tooltip title="新建项目" mouseEnterDelay={0.3}>
            <button
              className="app-repository-header-btn"
              aria-label="新建项目"
              onClick={onCreateProjectClick}
            >
              <ProjectIcon />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="app-repository-list">
        {floatingRepositories.length > 0 ? (
          <div className="app-repository-floating-group" aria-label="游离仓库">
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
                onPromoteToNewProject={onPromoteFloatingRepository}
                onJoinExistingProject={onJoinFloatingRepository}
                onRemove={onRemoveFloatingRepository}
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
            onCreateProjectTask={onCreateProjectTask}
            onCreateRepositoryTask={onCreateRepositoryTask}
            onReconcileProject={onReconcileProject}
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
          />
        ))}
        {projects.length === 0 && floatingRepositories.length === 0 && (
          <div className="app-repository-item app-repository-item--add" onClick={onCreateProjectClick}>
            <span className="app-repository-add-icon"><PlusIcon /></span>
            <span className="app-repository-add-text">新建项目</span>
          </div>
        )}
      </div>
    </>
  );
}

function ProjectRequirementAction({ onOpen }: { onOpen: () => void }) {
  return (
    <Tooltip title="打开需求" mouseEnterDelay={0.3}>
      <button
        type="button"
        className="app-repository-action app-repository-action--task app-repository-action--primary app-repository-action--requirement"
        aria-label="打开需求"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        <RequirementIcon />
        <span className="app-repository-action-label">需求</span>
      </button>
    </Tooltip>
  );
}

interface ProjectRowProps {
  project: ProjectItem;
  projectRepos: Repository[];
  isActiveProject: boolean;
  activeRepositoryId: number | null;
  isPinned: boolean;
  expanded: boolean;
  projectDropTargetId: string | null;
  repoSidebarDragRef: MutableRefObject<{ sourceProjectId: string; repositoryId: number } | null>;
  onProjectSelect: (projectId: string) => void;
  onRepositorySelect: (id: number | null) => void;
  onToggleProjectExpand: (projectId: string) => void;
  onTogglePinProject: (projectId: string) => void;
  onRenameProject: (project: ProjectItem) => void;
  onDeleteProject: (project: ProjectItem) => void;
  onOpenPromptsProject?: (project: ProjectItem) => void;
  onCreateProjectTask: (project: ProjectItem, mode: TaskMode) => void;
  onCreateRepositoryTask: (repository: Repository, mode: TaskMode) => void;
  onReconcileProject?: (projectId: string, mode: ReconcileProjectMode) => void | Promise<void>;
  onOpenInFinder: (repository: Repository) => void;
  openRepositoryInPreferredEditor: (repository: Repository) => void;
  onOpenPromptsRepository?: (project: ProjectItem, repository: Repository) => void;
  onOpenRepositoryMainOwner?: (repository: Repository) => void;
  onConfigureRepositorySddMode?: (repository: Repository) => void;
  onDetachRepositoryFromProject: (projectId: string, repositoryId: number) => void;
  onReorderRepositoriesInProject?: (projectId: string, repositoryIds: number[]) => void | Promise<void>;
  onMoveRepositoryToProject?: (targetProjectId: string, repositoryId: number) => void | Promise<void>;
  onMoveRepositoryToProjectWithExpand: (targetProjectId: string, repositoryId: number) => Promise<void>;
  onProjectDropTargetChange: (projectId: string | null | ((cur: string | null) => string | null)) => void;
  onClearRepoSidebarDrag: () => void;
  onMoveRepositoryError: (message: string, err: unknown) => void;
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
  onCreateProjectTask,
  onCreateRepositoryTask,
  onReconcileProject,
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
}: ProjectRowProps) {
  const projectMoreItems: MenuProps["items"] = [
    { key: "pin", label: isPinned ? "取消置顶" : "置顶" },
    { key: "rename", label: "重命名项目" },
    ...(onReconcileProject
      ? ([
          {
            key: "reconcile-submenu",
            label: "重新初始化项目",
            children: [
              { key: "reconcile-repos", label: "仅同步仓库" },
              { key: "reconcile-repos-graphs", label: "同步并重绘流程图（草稿）" },
            ],
          },
        ] satisfies MenuProps["items"])
      : []),
    { key: "prompts", label: "提示词" },
    { type: "divider" },
    { key: "delete", label: <span style={{ color: "var(--ant-color-error)" }}>删除项目</span> },
  ];

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
                onMoveRepositoryError("移动仓库到项目失败", err);
              });
            }
          : undefined
      }
    >
      <div
        className={`app-repository-item app-repository-item--project${isActiveProject ? " app-repository-item--project-active" : ""}`}
        onClick={() => onProjectSelect(project.id)}
      >
        <span
          className="app-repository-expand"
          onClick={(e) => {
            e.stopPropagation();
            onToggleProjectExpand(project.id);
          }}
        >
          <ExpandIcon expanded={expanded} />
        </span>
        <span className="app-repository-icon">
          <ProjectIcon />
        </span>
        <span className="app-repository-name">{project.name}</span>
        <div className="app-repository-row-actions">
          <ProjectRequirementAction onOpen={() => onCreateProjectTask(project, "split")} />
          <Dropdown
            rootClassName="app-sidebar-more-menu-dropdown"
            menu={{
              className: "app-sidebar-more-menu-inner",
              items: projectMoreItems,
              onClick: ({ key }) => {
                if (key === "pin") onTogglePinProject(project.id);
                if (key === "rename") onRenameProject(project);
                if (key === "reconcile-repos") void Promise.resolve(onReconcileProject?.(project.id, "repos_only"));
                if (key === "reconcile-repos-graphs") {
                  void Promise.resolve(onReconcileProject?.(project.id, "repos_and_graphs"));
                }
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
              aria-label="项目更多操作"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreIcon />
            </button>
          </Dropdown>
        </div>
      </div>

      {expanded && (
        <div className="app-repository-sessions">
          {projectRepos.length === 0 ? (
            <div className="app-session-item" style={{ cursor: "default" }}>
              <span className="app-session-item-name">
                在根目录下拉取仓库后，用项目菜单「重新初始化项目」→「仅同步仓库」或「同步并重绘流程图」
              </span>
            </div>
          ) : (
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
              repoSidebarDragRef={repoSidebarDragRef}
              onRepoSidebarDragEnd={onClearRepoSidebarDrag}
              hideChatAction={
                resolveWorkspaceMode({
                  activeProjectId: project.id,
                  projects: [project],
                }) === "multi_repo"
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
