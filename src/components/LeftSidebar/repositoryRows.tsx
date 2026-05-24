import { useState } from "react";
import { UserOutlined } from "@ant-design/icons";
import { App as AntdApp, Dropdown, Tooltip } from "antd";
import type { Repository, StandaloneRepo, TaskMode, Workspace } from "../../types";
import type { SidebarCodeGraphIndexStatus } from "./useSidebarCodeGraphIndexMap";
import { repositoryFolderBasename } from "../../utils/repositoryType";
import type { WorkspaceFocus } from "../../utils/workspaceMode";
import { reorderRepositoryIdsForDrop } from "./repositoryReorder";

export interface RepositoryReorderUi {
  dragHandleEnabled: boolean;
  rowReorderEnabled: boolean;
  dropHint: { anchorRepositoryId: number; placement: "before" | "after" } | null;
  foreignDropRowId: number | null;
  onDragStartHandle: (e: React.DragEvent) => void;
  onDragEndHandle: () => void;
  onDragOverRow: (e: React.DragEvent) => void;
  onDragLeaveRow: (e: React.DragEvent) => void;
  onDropRow: (e: React.DragEvent) => void;
}

import {
  buildFloatingRepositoryMoreMenuItems,
  buildProjectRepositoryMoreMenuItems,
} from "./sidebarMoreMenuItems";
import {
  ChatIcon,
  CodeGraphIcon,
  ExecutableTasksIcon,
  MoreIcon,
  RepositoryTypeIcon,
  RepoDragHandleIcon,
  ScheduledTasksIcon,
  RequirementIcon,
  TrellisIcon,
} from "./SidebarIcons";
import { RunningMainSessionDot } from "./RunningMainSessionDot";
import { RepositorySddStackBadge } from "./RepositorySddStackBadge";

function repositoryTrellisEntrypointsEnabled(repository: Repository, trellisReady: boolean): boolean {
  return repository.sddMode !== "off" && (trellisReady || repository.sddMode !== "project_owned");
}

export function RepositoryConversationAction({ onOpen }: { onOpen: () => void }) {
  return (
    <Tooltip title="打开仓库对话" mouseEnterDelay={0.3}>
      <button
        type="button"
        className="app-repository-action app-repository-action--task app-repository-action--primary app-repository-action--chat"
        aria-label="打开对话"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        <ChatIcon />
      </button>
    </Tooltip>
  );
}

export function RepositoryCodeGraphAction({
  onOpen,
  variant = "repo",
}: {
  onOpen: () => void;
  variant?: "repo" | "project";
}) {
  return (
    <Tooltip title="查看代码图谱" mouseEnterDelay={0.3}>
      <button
        type="button"
        className={`app-repository-action app-repository-action--task app-repository-action--primary app-repository-action--code-graph${variant === "project" ? " app-repository-action--project-quick" : ""}`}
        aria-label="查看代码图谱"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        <CodeGraphIcon />
      </button>
    </Tooltip>
  );
}

export function RepositoryTrellisAction({
  onOpen,
  variant = "repo",
}: {
  onOpen: () => void;
  variant?: "repo" | "project";
}) {
  return (
    <Tooltip title={variant === "project" ? "工作区 Trellis" : "仓库 Trellis"} mouseEnterDelay={0.3}>
      <button
        type="button"
        className={`app-repository-action app-repository-action--task app-repository-action--primary app-repository-action--trellis${variant === "project" ? " app-repository-action--project-quick" : ""}`}
        aria-label={variant === "project" ? "工作区 Trellis" : "仓库 Trellis"}
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

export function SidebarScheduledTasksAction({
  totalCount,
  enabledCount,
  onOpen,
  variant = "repo",
}: {
  totalCount: number;
  enabledCount: number;
  onOpen: () => void;
  variant?: "repo" | "project";
}) {
  if (totalCount <= 0) return null;

  const badgeLabel = enabledCount > 99 ? "99+" : String(enabledCount);
  const tooltipTitle =
    enabledCount > 0
      ? `${enabledCount} 个激活的定时任务（共 ${totalCount} 个）`
      : `已配置 ${totalCount} 个定时任务（均未启用）`;
  const ariaLabel =
    enabledCount > 0
      ? `定时任务（${enabledCount} 个激活，共 ${totalCount} 个）`
      : `定时任务（共 ${totalCount} 个，均未启用）`;

  return (
    <Tooltip title={tooltipTitle} mouseEnterDelay={0.3}>
      <button
        type="button"
        className={`app-repository-action app-repository-action--task app-repository-action--primary app-repository-action--scheduled-tasks${variant === "project" ? " app-repository-action--project-quick" : ""}`}
        aria-label={ariaLabel}
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        <span className="app-repository-action-icon-wrap">
          <ScheduledTasksIcon />
          {enabledCount > 0 ? (
            <span className="app-repository-action-count-badge">{badgeLabel}</span>
          ) : null}
        </span>
      </button>
    </Tooltip>
  );
}

export function SidebarRequirementAction({
  unsplitCount,
  onOpen,
  variant = "repo",
}: {
  unsplitCount: number;
  onOpen: () => void;
  variant?: "repo" | "project";
}) {
  if (unsplitCount <= 0) return null;

  const badgeLabel = unsplitCount > 99 ? "99+" : String(unsplitCount);

  return (
    <Tooltip title={`${unsplitCount} 条需求待拆分`} mouseEnterDelay={0.3}>
      <button
        type="button"
        className={`app-repository-action app-repository-action--task app-repository-action--primary app-repository-action--requirement${variant === "project" ? " app-repository-action--project-quick" : ""}`}
        aria-label={`需求（${unsplitCount} 条待拆分）`}
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        <span className="app-repository-action-icon-wrap">
          <RequirementIcon />
          <span className="app-repository-action-count-badge app-repository-action-count-badge--requirement">
            {badgeLabel}
          </span>
        </span>
      </button>
    </Tooltip>
  );
}

export function SidebarExecutableTasksAction({
  executableCount,
  onOpen,
  variant = "repo",
}: {
  executableCount: number;
  onOpen: () => void;
  variant?: "repo" | "project";
}) {
  if (executableCount <= 0) return null;

  const badgeLabel = executableCount > 99 ? "99+" : String(executableCount);

  return (
    <Tooltip title={`${executableCount} 个可执行任务`} mouseEnterDelay={0.3}>
      <button
        type="button"
        className={`app-repository-action app-repository-action--task app-repository-action--primary app-repository-action--executable-tasks${variant === "project" ? " app-repository-action--project-quick" : ""}`}
        aria-label={`可执行任务（${executableCount} 个）`}
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        <span className="app-repository-action-icon-wrap">
          <ExecutableTasksIcon />
          <span className="app-repository-action-count-badge app-repository-action-count-badge--executable">
            {badgeLabel}
          </span>
        </span>
      </button>
    </Tooltip>
  );
}

export function RepositoryRow({
  project,
  repository,
  isActiveRepository,
  onRepositorySelect,
  onOpenTaskMode,
  onDetachFromProject,
  onOpenInFinder,
  onOpenRepositoryInEditor,
  onOpenPromptsRepository,
  onOpenRepositoryMainOwner,
  onConfigureSddMode,
  onCodeGraphGenerateRepository,
  onCodeGraphViewRepositoryInProject,
  repositoryReorder,
  hideChatAction = false,
  codeGraphIndexed = false,
  trellisReady = false,
  scheduledTasksTotalCount = 0,
  scheduledTasksEnabledCount = 0,
  requirementUnsplitCount = 0,
  executableTaskCount = 0,
  onOpenScheduledTasks,
  onOpenRequirements,
  onOpenExecutableTasks,
  mainSessionRunning = false,
  onStopMainSession,
}: {
  project: Workspace;
  repository: Repository;
  isActiveRepository: boolean;
  onRepositorySelect: (id: number | null) => void;
  onOpenTaskMode: (repository: Repository, mode: TaskMode) => void;
  onDetachFromProject: (projectId: string, repositoryId: number) => void;
  onOpenInFinder: (repository: Repository) => void;
  onOpenRepositoryInEditor: (repository: Repository) => void;
  onOpenPromptsRepository?: (project: Workspace, repository: Repository) => void;
  onOpenRepositoryMainOwner?: (repository: Repository) => void;
  onConfigureSddMode?: (repository: Repository) => void;
  onCodeGraphGenerateRepository?: (repository: Repository) => void | Promise<void>;
  onCodeGraphViewRepositoryInProject?: (project: Workspace, repository: Repository) => void;
  repositoryReorder?: RepositoryReorderUi;
  hideChatAction?: boolean;
  codeGraphIndexed?: boolean;
  trellisReady?: boolean;
  scheduledTasksTotalCount?: number;
  scheduledTasksEnabledCount?: number;
  requirementUnsplitCount?: number;
  executableTaskCount?: number;
  onOpenScheduledTasks?: (repository: Repository) => void;
  onOpenRequirements?: (repository: Repository) => void;
  onOpenExecutableTasks?: (repository: Repository) => void;
  mainSessionRunning?: boolean;
  onStopMainSession?: () => void;
}) {
  const workspaceTrellisEnabled = project.sddMode !== "project_owned" || trellisReady;
  const moreItems = buildProjectRepositoryMoreMenuItems({
    trellisEnabled: workspaceTrellisEnabled,
    trellisReady,
    trellisRootActionEnabled: false,
    onOpenRepositoryMainOwner: Boolean(onOpenRepositoryMainOwner),
    onOpenPromptsRepository: Boolean(onOpenPromptsRepository),
    onConfigureSddMode: Boolean(onConfigureSddMode),
    onOpenScheduledTasks: Boolean(onOpenScheduledTasks),
    onOpenRequirements: Boolean(onOpenRequirements),
    onOpenExecutableTasks: Boolean(onOpenExecutableTasks),
    onCodeGraphGenerateRepository: Boolean(onCodeGraphGenerateRepository),
    onCodeGraphViewRepositoryInProject: Boolean(onCodeGraphViewRepositoryInProject),
  });

  const dropRowClass =
    repositoryReorder?.rowReorderEnabled && repositoryReorder.dropHint?.anchorRepositoryId === repository.id
      ? repositoryReorder.dropHint.placement === "before"
        ? " app-repository-row--drop-before"
        : " app-repository-row--drop-after"
      : "";
  const foreignDropClass =
    repositoryReorder?.foreignDropRowId === repository.id ? " app-repository-row--foreign-drop" : "";
  const hasMainOwner = Boolean(repository.mainOwnerAgentName?.trim());

  return (
    <div
      className={`app-repository-row${dropRowClass}${foreignDropClass}`}
      onDragOver={repositoryReorder?.dragHandleEnabled ? repositoryReorder.onDragOverRow : undefined}
      onDragLeave={repositoryReorder?.dragHandleEnabled ? repositoryReorder.onDragLeaveRow : undefined}
      onDrop={repositoryReorder?.dragHandleEnabled ? repositoryReorder.onDropRow : undefined}
    >
      <div
        className={`app-repository-item app-repository-item--repo${isActiveRepository ? " app-repository-item--repo-active" : ""}`}
        onClick={(e) => {
          const target = e.target as HTMLElement | null;
          if (
            target?.closest(".app-repository-row-actions") ||
            target?.closest(".app-repository-main-session-running-dot-wrap")
          ) {
            return;
          }
          onRepositorySelect(repository.id);
        }}
      >
        {repositoryReorder?.dragHandleEnabled ? (
          <span
            className="app-repository-drag-handle"
            draggable
            onDragStart={repositoryReorder.onDragStartHandle}
            onDragEnd={repositoryReorder.onDragEndHandle}
            onClick={(e) => e.stopPropagation()}
            title="拖动排序 / 拖入其它工作区"
            role="button"
            aria-label="拖动排序或拖入其它工作区"
          >
            <RepoDragHandleIcon />
          </span>
        ) : null}
        <span className="app-repository-icon-wrap">
          <span className="app-repository-icon app-repository-icon--folder">
            <RepositoryTypeIcon repository={repository} />
          </span>
          {hasMainOwner ? (
            <span
              className="app-repository-main-owner-badge"
              aria-label="已配置仓库"
              title="已配置仓库"
            >
              <UserOutlined />
            </span>
          ) : null}
        </span>
        <span className="app-repository-name-block">
          <span className="app-repository-name">{repositoryFolderBasename(repository)}</span>
          {mainSessionRunning ? <RunningMainSessionDot onStop={onStopMainSession} /> : null}
        </span>
        <div
          className="app-repository-row-actions"
          onClick={(e) => e.stopPropagation()}
        >
          {hideChatAction ? null : (
            <RepositoryConversationAction onOpen={() => onOpenTaskMode(repository, "chat")} />
          )}
          {codeGraphIndexed && onCodeGraphViewRepositoryInProject ? (
            <RepositoryCodeGraphAction
              onOpen={() => onCodeGraphViewRepositoryInProject(project, repository)}
            />
          ) : null}
          {workspaceTrellisEnabled && onOpenRequirements ? (
            <SidebarRequirementAction
              unsplitCount={requirementUnsplitCount}
              onOpen={() => onOpenRequirements(repository)}
            />
          ) : null}
          {onOpenScheduledTasks ? (
            <SidebarScheduledTasksAction
              totalCount={scheduledTasksTotalCount}
              enabledCount={scheduledTasksEnabledCount}
              onOpen={() => onOpenScheduledTasks(repository)}
            />
          ) : null}
          {workspaceTrellisEnabled && onOpenExecutableTasks ? (
            <SidebarExecutableTasksAction
              executableCount={executableTaskCount}
              onOpen={() => onOpenExecutableTasks(repository)}
            />
          ) : null}
          <RepositorySddStackBadge repository={repository} />
          <Dropdown
            rootClassName="app-sidebar-more-menu-dropdown"
            menu={{
              className: "app-sidebar-more-menu-inner",
              items: moreItems,
              onClick: ({ key }) => {
                if (key === "finder") onOpenInFinder(repository);
                if (key === "editor") onOpenRepositoryInEditor(repository);
                if (key === "main-owner") onOpenRepositoryMainOwner?.(repository);
                if (key === "detach") onDetachFromProject(project.id, repository.id);
                if (key === "prompts") onOpenPromptsRepository?.(project, repository);
                if (key === "sdd-mode") onConfigureSddMode?.(repository);
                if (key === "scheduled-tasks") onOpenScheduledTasks?.(repository);
                if (key === "requirements" && workspaceTrellisEnabled) onOpenRequirements?.(repository);
                if (key === "executable-tasks" && workspaceTrellisEnabled) onOpenExecutableTasks?.(repository);
                if (key === "code-graph-generate-repo") void Promise.resolve(onCodeGraphGenerateRepository?.(repository));
                if (key === "code-graph-view-repo") onCodeGraphViewRepositoryInProject?.(project, repository);
              },
            }}
            trigger={["click"]}
            placement="bottomRight"
          >
            <button
              type="button"
              className="app-repository-action app-repository-action--more"
              aria-label="仓库更多操作"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreIcon />
            </button>
          </Dropdown>
        </div>
      </div>
    </div>
  );
}

export function FloatingRepositoryRow({
  repository,
  isActiveRepository,
  joinableProjects,
  onRepositorySelect,
  onOpenTaskMode,
  onOpenInFinder,
  onOpenRepositoryInEditor,
  onOpenRepositoryMainOwner,
  onConfigureSddMode,
  onBootstrapTrellis,
  onCodeGraphGenerateRepository,
  onCodeGraphViewFloatingRepository,
  onPromoteToNewProject,
  onJoinExistingProject,
  onRemove,
  codeGraphIndexed = false,
  trellisReady = false,
  onOpenFloatingRepositoryTrellis,
  scheduledTasksTotalCount = 0,
  scheduledTasksEnabledCount = 0,
  requirementUnsplitCount = 0,
  executableTaskCount = 0,
  onOpenScheduledTasks,
  onOpenRequirements,
  onOpenExecutableTasks,
  mainSessionRunning = false,
  onStopMainSession,
}: {
  repository: StandaloneRepo;
  isActiveRepository: boolean;
  joinableProjects: Workspace[];
  onRepositorySelect: (id: number | null) => void;
  onOpenTaskMode: (repository: Repository, mode: TaskMode) => void;
  onOpenInFinder: (repository: Repository) => void;
  onOpenRepositoryInEditor: (repository: Repository) => void;
  onOpenRepositoryMainOwner?: (repository: Repository) => void;
  onConfigureSddMode?: (repository: Repository) => void;
  onBootstrapTrellis?: (repository: Repository) => void | Promise<void>;
  onCodeGraphGenerateRepository?: (repository: Repository) => void | Promise<void>;
  onCodeGraphViewFloatingRepository?: (repository: Repository) => void;
  onPromoteToNewProject?: (repository: StandaloneRepo) => void;
  onJoinExistingProject?: (repository: StandaloneRepo, projectId: string) => void;
  onRemove: (repository: StandaloneRepo) => void;
  codeGraphIndexed?: boolean;
  trellisReady?: boolean;
  onOpenFloatingRepositoryTrellis?: (repository: Repository) => void;
  scheduledTasksTotalCount?: number;
  scheduledTasksEnabledCount?: number;
  requirementUnsplitCount?: number;
  executableTaskCount?: number;
  onOpenScheduledTasks?: (repository: Repository) => void;
  onOpenRequirements?: (repository: Repository) => void;
  onOpenExecutableTasks?: (repository: Repository) => void;
  mainSessionRunning?: boolean;
  onStopMainSession?: () => void;
}) {
  const hasMainOwner = Boolean(repository.mainOwnerAgentName?.trim());
  const trellisEnabled = repositoryTrellisEntrypointsEnabled(repository, trellisReady);
  const moreItems = buildFloatingRepositoryMoreMenuItems({
    joinableProjects,
    trellisEnabled,
    trellisReady,
    onOpenRepositoryMainOwner: Boolean(onOpenRepositoryMainOwner),
    onConfigureSddMode: Boolean(onConfigureSddMode),
    onOpenScheduledTasks: Boolean(onOpenScheduledTasks),
    onOpenRequirements: Boolean(onOpenRequirements),
    onOpenExecutableTasks: Boolean(onOpenExecutableTasks),
    onCodeGraphGenerateRepository: Boolean(onCodeGraphGenerateRepository),
    onCodeGraphViewFloatingRepository: Boolean(onCodeGraphViewFloatingRepository),
    onPromoteToNewProject: Boolean(onPromoteToNewProject),
    onJoinExistingProject: Boolean(onJoinExistingProject),
  });

  return (
    <div className="app-repository-row">
      <div
        className={`app-repository-item app-repository-item--repo${isActiveRepository ? " app-repository-item--repo-active" : ""}`}
        onClick={(e) => {
          const target = e.target as HTMLElement | null;
          if (
            target?.closest(".app-repository-row-actions") ||
            target?.closest(".app-repository-main-session-running-dot-wrap")
          ) {
            return;
          }
          onRepositorySelect(repository.id);
        }}
      >
        <span className="app-repository-icon-wrap">
          <span className="app-repository-icon app-repository-icon--folder">
            <RepositoryTypeIcon repository={repository} />
          </span>
          {hasMainOwner ? (
            <span
              className="app-repository-main-owner-badge"
              aria-label="已配置主 Owner"
              title="已配置主 Owner"
            >
              <UserOutlined />
            </span>
          ) : null}
        </span>
        <span className="app-repository-name-block">
          <span className="app-repository-name">{repositoryFolderBasename(repository)}</span>
          {mainSessionRunning ? <RunningMainSessionDot onStop={onStopMainSession} /> : null}
        </span>
        <div
          className="app-repository-row-actions"
          onClick={(e) => e.stopPropagation()}
        >
          <RepositoryConversationAction onOpen={() => onOpenTaskMode(repository, "chat")} />
          {trellisEnabled && trellisReady && onOpenFloatingRepositoryTrellis ? (
            <RepositoryTrellisAction onOpen={() => onOpenFloatingRepositoryTrellis(repository)} />
          ) : null}
          {codeGraphIndexed && onCodeGraphViewFloatingRepository ? (
            <RepositoryCodeGraphAction onOpen={() => onCodeGraphViewFloatingRepository(repository)} />
          ) : null}
          {trellisEnabled && onOpenRequirements ? (
            <SidebarRequirementAction
              unsplitCount={requirementUnsplitCount}
              onOpen={() => onOpenRequirements(repository)}
            />
          ) : null}
          {onOpenScheduledTasks ? (
            <SidebarScheduledTasksAction
              totalCount={scheduledTasksTotalCount}
              enabledCount={scheduledTasksEnabledCount}
              onOpen={() => onOpenScheduledTasks(repository)}
            />
          ) : null}
          {trellisEnabled && onOpenExecutableTasks ? (
            <SidebarExecutableTasksAction
              executableCount={executableTaskCount}
              onOpen={() => onOpenExecutableTasks(repository)}
            />
          ) : null}
          <RepositorySddStackBadge repository={repository} />
          <Dropdown
            rootClassName="app-sidebar-more-menu-dropdown"
            menu={{
              className: "app-sidebar-more-menu-inner",
              items: moreItems,
              onClick: ({ key }) => {
                if (key === "finder") onOpenInFinder(repository);
                if (key === "editor") onOpenRepositoryInEditor(repository);
                if (key === "main-owner") onOpenRepositoryMainOwner?.(repository);
                if (key === "sdd-mode") onConfigureSddMode?.(repository);
                if (key === "trellis-init" && trellisEnabled) void Promise.resolve(onBootstrapTrellis?.(repository));
                if (key === "scheduled-tasks") onOpenScheduledTasks?.(repository);
                if (key === "requirements" && trellisEnabled) onOpenRequirements?.(repository);
                if (key === "executable-tasks" && trellisEnabled) onOpenExecutableTasks?.(repository);
                if (key === "code-graph-generate-repo") void Promise.resolve(onCodeGraphGenerateRepository?.(repository));
                if (key === "code-graph-view-repo") onCodeGraphViewFloatingRepository?.(repository);
                if (key === "promote") onPromoteToNewProject?.(repository);
                if (typeof key === "string" && key.startsWith("join-")) {
                  const projectId = key.slice("join-".length);
                  onJoinExistingProject?.(repository, projectId);
                }
                if (key === "remove") onRemove(repository);
              },
            }}
            trigger={["click"]}
            placement="bottomRight"
          >
            <button
              type="button"
              className="app-repository-action app-repository-action--more"
              aria-label="仓库更多操作"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreIcon />
            </button>
          </Dropdown>
        </div>
      </div>
    </div>
  );
}

export function ProjectRepositoryRows({
  project,
  projectRepos,
  activeRepositoryId,
  activeWorkspaceFocus = "repository",
  onRepositorySelect,
  onCreateRepositoryTask,
  onDetachRepositoryFromProject,
  onOpenInFinder,
  openRepositoryInPreferredEditor,
  onOpenPromptsRepository,
  onOpenRepositoryMainOwner,
  onReorderRepositoriesInProject,
  onMoveRepositoryToProject,
  onConfigureSddMode,
  onCodeGraphGenerateRepository,
  onCodeGraphViewRepositoryInProject,
  repoSidebarDragRef,
  onRepoSidebarDragEnd,
  hideChatAction = false,
  codeGraphIndexStatusByRepoId = {},
  repositoryTrellisReadyById = {},
  scheduledTasksByRepoId = {},
  requirementUnsplitByRepoId = {},
  executableTasksByRepoId = {},
  onOpenScheduledTasks,
  onOpenRepositoryRequirements,
  onOpenRepositoryExecutableTasks,
  runningMainSessionByRepositoryId = {},
  onStopRepositoryMainSession,
}: {
  project: Workspace;
  projectRepos: Repository[];
  activeRepositoryId: number | null;
  activeWorkspaceFocus?: WorkspaceFocus;
  onRepositorySelect: (id: number | null) => void;
  onCreateRepositoryTask: (repository: Repository, mode: TaskMode) => void;
  onDetachRepositoryFromProject: (projectId: string, repositoryId: number) => void;
  onOpenInFinder: (repository: Repository) => void;
  openRepositoryInPreferredEditor: (repository: Repository) => void;
  onOpenPromptsRepository?: (project: Workspace, repository: Repository) => void;
  onOpenRepositoryMainOwner?: (repository: Repository) => void;
  onReorderRepositoriesInProject?: (projectId: string, repositoryIds: number[]) => void | Promise<void>;
  onMoveRepositoryToProject?: (targetProjectId: string, repositoryId: number) => void | Promise<void>;
  onConfigureSddMode?: (repository: Repository) => void;
  onCodeGraphGenerateRepository?: (repository: Repository) => void | Promise<void>;
  onCodeGraphViewRepositoryInProject?: (project: Workspace, repository: Repository) => void;
  repoSidebarDragRef: React.MutableRefObject<{ sourceProjectId: string; repositoryId: number } | null>;
  onRepoSidebarDragEnd: () => void;
  hideChatAction?: boolean;
  codeGraphIndexStatusByRepoId?: Record<number, SidebarCodeGraphIndexStatus>;
  repositoryTrellisReadyById?: Record<number, boolean>;
  scheduledTasksByRepoId?: Record<number, { total: number; enabled: number }>;
  requirementUnsplitByRepoId?: Record<number, number>;
  executableTasksByRepoId?: Record<number, number>;
  onOpenScheduledTasks?: (repository: Repository) => void;
  onOpenRepositoryRequirements?: (repository: Repository) => void;
  onOpenRepositoryExecutableTasks?: (repository: Repository) => void;
  runningMainSessionByRepositoryId?: Record<number, boolean>;
  onStopRepositoryMainSession?: (repository: Repository) => void;
}) {
  const { message } = AntdApp.useApp();
  const [dropHint, setDropHint] = useState<{ anchorRepositoryId: number; placement: "before" | "after" } | null>(
    null,
  );
  const [foreignDropRowId, setForeignDropRowId] = useState<number | null>(null);
  const rowReorderEnabled = Boolean(onReorderRepositoriesInProject) && projectRepos.length > 1;
  const dragHandleEnabled = Boolean(onMoveRepositoryToProject) || rowReorderEnabled;

  return (
    <>
      {projectRepos.map((repository) => {
        const reorderUi: RepositoryReorderUi | undefined = dragHandleEnabled
          ? buildRepositoryReorderUi({
              project,
              projectRepos,
              repository,
              rowReorderEnabled,
              dropHint,
              foreignDropRowId,
              setDropHint,
              setForeignDropRowId,
              repoSidebarDragRef,
              onRepoSidebarDragEnd,
              onReorderRepositoriesInProject,
              onMoveRepositoryToProject,
              messageError: message.error,
            })
          : undefined;
        return (
          <RepositoryRow
            key={repository.id}
            project={project}
            repository={repository}
            isActiveRepository={
              repository.id === activeRepositoryId && activeWorkspaceFocus === "repository"
            }
            onRepositorySelect={onRepositorySelect}
            onOpenTaskMode={onCreateRepositoryTask}
            onDetachFromProject={onDetachRepositoryFromProject}
            onOpenInFinder={onOpenInFinder}
            onOpenRepositoryInEditor={openRepositoryInPreferredEditor}
            onOpenPromptsRepository={onOpenPromptsRepository}
            onOpenRepositoryMainOwner={onOpenRepositoryMainOwner}
            onConfigureSddMode={onConfigureSddMode}
            onCodeGraphGenerateRepository={onCodeGraphGenerateRepository}
            onCodeGraphViewRepositoryInProject={onCodeGraphViewRepositoryInProject}
            repositoryReorder={reorderUi}
            hideChatAction={hideChatAction}
            codeGraphIndexed={codeGraphIndexStatusByRepoId[repository.id] === "done"}
            trellisReady={repositoryTrellisReadyById[repository.id] === true}
            scheduledTasksTotalCount={scheduledTasksByRepoId[repository.id]?.total ?? 0}
            scheduledTasksEnabledCount={scheduledTasksByRepoId[repository.id]?.enabled ?? 0}
            requirementUnsplitCount={requirementUnsplitByRepoId[repository.id] ?? 0}
            executableTaskCount={executableTasksByRepoId[repository.id] ?? 0}
            onOpenScheduledTasks={onOpenScheduledTasks}
            onOpenRequirements={onOpenRepositoryRequirements}
            onOpenExecutableTasks={onOpenRepositoryExecutableTasks}
            mainSessionRunning={runningMainSessionByRepositoryId[repository.id] === true}
            onStopMainSession={
              runningMainSessionByRepositoryId[repository.id] === true && onStopRepositoryMainSession
                ? () => onStopRepositoryMainSession(repository)
                : undefined
            }
          />
        );
      })}
    </>
  );
}

function buildRepositoryReorderUi({
  project,
  projectRepos,
  repository,
  rowReorderEnabled,
  dropHint,
  foreignDropRowId,
  setDropHint,
  setForeignDropRowId,
  repoSidebarDragRef,
  onRepoSidebarDragEnd,
  onReorderRepositoriesInProject,
  onMoveRepositoryToProject,
  messageError,
}: {
  project: Workspace;
  projectRepos: Repository[];
  repository: Repository;
  rowReorderEnabled: boolean;
  dropHint: RepositoryReorderUi["dropHint"];
  foreignDropRowId: number | null;
  setDropHint: React.Dispatch<React.SetStateAction<RepositoryReorderUi["dropHint"]>>;
  setForeignDropRowId: React.Dispatch<React.SetStateAction<number | null>>;
  repoSidebarDragRef: React.MutableRefObject<{ sourceProjectId: string; repositoryId: number } | null>;
  onRepoSidebarDragEnd: () => void;
  onReorderRepositoriesInProject?: (projectId: string, repositoryIds: number[]) => void | Promise<void>;
  onMoveRepositoryToProject?: (targetProjectId: string, repositoryId: number) => void | Promise<void>;
  messageError: (content: string) => void;
}): RepositoryReorderUi {
  return {
    dragHandleEnabled: true,
    rowReorderEnabled,
    dropHint,
    foreignDropRowId,
    onDragStartHandle: (e) => {
      repoSidebarDragRef.current = { sourceProjectId: project.id, repositoryId: repository.id };
      e.dataTransfer.setData("text/plain", String(repository.id));
      e.dataTransfer.effectAllowed = "move";
      setDropHint(null);
      setForeignDropRowId(null);
    },
    onDragEndHandle: () => {
      repoSidebarDragRef.current = null;
      setDropHint(null);
      setForeignDropRowId(null);
      onRepoSidebarDragEnd();
    },
    onDragOverRow: (e) => {
      const dragged = repoSidebarDragRef.current;
      if (!dragged) return;
      if (dragged.sourceProjectId === project.id && rowReorderEnabled) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setForeignDropRowId(null);
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const placement = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
        setDropHint({ anchorRepositoryId: repository.id, placement });
        return;
      }
      if (dragged.sourceProjectId !== project.id && onMoveRepositoryToProject) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropHint(null);
        setForeignDropRowId(repository.id);
      }
    },
    onDragLeaveRow: (e) => {
      const related = e.relatedTarget as Node | null;
      if (related && (e.currentTarget as HTMLElement).contains(related)) return;
      setDropHint((prev) => (prev?.anchorRepositoryId === repository.id ? null : prev));
      setForeignDropRowId((cur) => (cur === repository.id ? null : cur));
    },
    onDropRow: (e) => {
      e.preventDefault();
      e.stopPropagation();
      const dragged = repoSidebarDragRef.current;
      repoSidebarDragRef.current = null;
      setDropHint(null);
      setForeignDropRowId(null);
      onRepoSidebarDragEnd();
      if (!dragged) return;

      if (dragged.sourceProjectId === project.id && rowReorderEnabled && onReorderRepositoriesInProject) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const placement = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
        const baseOrder = projectRepos.map((repo) => repo.id);
        const next = reorderRepositoryIdsForDrop(baseOrder, dragged.repositoryId, repository.id, placement);
        const unchanged = next.every((id, index) => id === baseOrder[index]);
        if (unchanged) return;
        void Promise.resolve(onReorderRepositoriesInProject(project.id, next)).catch((err: unknown) => {
          messageError("调整仓库顺序失败");
          console.error(err);
        });
        return;
      }
      if (dragged.sourceProjectId !== project.id && onMoveRepositoryToProject) {
        void Promise.resolve(onMoveRepositoryToProject(project.id, dragged.repositoryId)).catch((err: unknown) => {
          messageError("移动仓库到工作区失败");
          console.error(err);
        });
      }
    },
  };
}
