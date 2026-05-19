import { useState } from "react";
import { UserOutlined } from "@ant-design/icons";
import { App as AntdApp, Dropdown, Tooltip } from "antd";
import type { MenuProps } from "antd";
import type { Repository, StandaloneRepo, TaskMode, Workspace } from "../../types";
import type { SidebarCodeGraphIndexStatus } from "./useSidebarCodeGraphIndexMap";
import { DEFAULT_OPEN_APP_ID, DEFAULT_OPEN_APP_TARGETS } from "../OpenAppMenu/constants";
import { getOpenAppPreferenceSync } from "../../services/openAppPreference";
import { repositoryFolderBasename } from "../../utils/repositoryType";
import {
  ChatIcon,
  CodeGraphIcon,
  MoreIcon,
  RepositoryTypeIcon,
  RepoDragHandleIcon,
  ScheduledTasksIcon,
  RequirementIcon,
} from "./SidebarIcons";

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

export function repositoryEditorOpenMenuLabel(): string {
  const id = getOpenAppPreferenceSync().trim() || DEFAULT_OPEN_APP_ID;
  const target = DEFAULT_OPEN_APP_TARGETS.find((item) => item.id === id) ?? DEFAULT_OPEN_APP_TARGETS[0];
  return target ? `在 ${target.label} 中打开` : "编辑器打开";
}

export function reorderRepositoryIdsForDrop(
  ordered: readonly number[],
  draggedId: number,
  anchorId: number,
  placement: "before" | "after",
): number[] {
  const next = ordered.filter((id) => id !== draggedId);
  const anchorIdx = next.indexOf(anchorId);
  if (anchorIdx === -1) return [...ordered];
  const insertAt = placement === "before" ? anchorIdx : anchorIdx + 1;
  next.splice(insertAt, 0, draggedId);
  return next;
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
  scheduledTasksTotalCount = 0,
  scheduledTasksEnabledCount = 0,
  onOpenScheduledTasks,
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
  scheduledTasksTotalCount?: number;
  scheduledTasksEnabledCount?: number;
  onOpenScheduledTasks?: (repository: Repository) => void;
}) {
  const moreItems: MenuProps["items"] = [
    { key: "finder", label: "Finder打开" },
    { key: "editor", label: repositoryEditorOpenMenuLabel() },
    { type: "divider" },
    ...(onOpenRepositoryMainOwner ? [{ key: "main-owner", label: "配置Owner" }] satisfies MenuProps["items"] : []),
    { key: "prompts", label: "提示词" },
    { key: "sdd-mode", label: "SDD 模式" },
    ...(onOpenScheduledTasks
      ? [{ key: "scheduled-tasks", label: "定时任务" }] satisfies MenuProps["items"]
      : []),
    ...(onCodeGraphGenerateRepository && onCodeGraphViewRepositoryInProject
      ? ([
          {
            key: "code-graph-submenu",
            label: "图谱操作",
            popupClassName: "app-sidebar-more-menu-submenu",
            children: [
              { key: "code-graph-generate-repo", label: "生成检索" },
              { key: "code-graph-view-repo", label: "查看检索" },
            ],
          },
        ] satisfies MenuProps["items"])
      : []),
    { type: "divider" },
    { key: "detach", label: "移出 Workspace", danger: true },
  ];

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
          if ((e.target as HTMLElement | null)?.closest(".app-repository-row-actions")) return;
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
            title="拖动排序 / 拖入其它 Workspace"
            role="button"
            aria-label="拖动排序或拖入其它 Workspace"
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
        <span className="app-repository-name">{repositoryFolderBasename(repository)}</span>
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
          {onOpenScheduledTasks ? (
            <SidebarScheduledTasksAction
              totalCount={scheduledTasksTotalCount}
              enabledCount={scheduledTasksEnabledCount}
              onOpen={() => onOpenScheduledTasks(repository)}
            />
          ) : null}
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
  onCodeGraphGenerateRepository,
  onCodeGraphViewFloatingRepository,
  onPromoteToNewProject,
  onJoinExistingProject,
  onRemove,
  codeGraphIndexed = false,
  scheduledTasksTotalCount = 0,
  scheduledTasksEnabledCount = 0,
  onOpenScheduledTasks,
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
  onCodeGraphGenerateRepository?: (repository: Repository) => void | Promise<void>;
  onCodeGraphViewFloatingRepository?: (repository: Repository) => void;
  onPromoteToNewProject?: (repository: StandaloneRepo) => void;
  onJoinExistingProject?: (repository: StandaloneRepo, projectId: string) => void;
  onRemove: (repository: StandaloneRepo) => void;
  codeGraphIndexed?: boolean;
  scheduledTasksTotalCount?: number;
  scheduledTasksEnabledCount?: number;
  onOpenScheduledTasks?: (repository: Repository) => void;
}) {
  const hasMainOwner = Boolean(repository.mainOwnerAgentName?.trim());
  const joinChildren: MenuProps["items"] = joinableProjects.map((project) => ({
    key: `join-${project.id}`,
    label: project.name,
  }));
  const moreItems: MenuProps["items"] = [
    { key: "finder", label: "Finder打开" },
    { key: "editor", label: repositoryEditorOpenMenuLabel() },
    ...(onOpenRepositoryMainOwner ? [{ key: "main-owner", label: "主 Owner 智能体…" }] satisfies MenuProps["items"] : []),
    { key: "sdd-mode", label: "SDD 模式" },
    ...(onOpenScheduledTasks
      ? [{ key: "scheduled-tasks", label: "定时任务" }] satisfies MenuProps["items"]
      : []),
    ...(onCodeGraphGenerateRepository && onCodeGraphViewFloatingRepository
      ? ([
          {
            key: "code-graph-submenu",
            label: "图谱操作",
            popupClassName: "app-sidebar-more-menu-submenu",
            children: [
              { key: "code-graph-generate-repo", label: "生成检索" },
              { key: "code-graph-view-repo", label: "查看检索" },
            ],
          },
        ] satisfies MenuProps["items"])
      : []),
    { type: "divider" },
    ...(onPromoteToNewProject ? [{ key: "promote", label: "升格为 Workspace…" }] satisfies MenuProps["items"] : []),
    ...(onJoinExistingProject && joinChildren.length > 0
      ? ([
          {
            key: "join",
            label: "加入 Workspace",
            popupClassName: "app-sidebar-more-menu-submenu",
            children: joinChildren,
          },
        ] satisfies MenuProps["items"])
      : []),
    { type: "divider" },
    { key: "remove", label: "移除仓库", danger: true },
  ];

  return (
    <div className="app-repository-row">
      <div
        className={`app-repository-item app-repository-item--repo${isActiveRepository ? " app-repository-item--repo-active" : ""}`}
        onClick={(e) => {
          if ((e.target as HTMLElement | null)?.closest(".app-repository-row-actions")) return;
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
        <span className="app-repository-name">{repositoryFolderBasename(repository)}</span>
        <div
          className="app-repository-row-actions"
          onClick={(e) => e.stopPropagation()}
        >
          <RepositoryConversationAction onOpen={() => onOpenTaskMode(repository, "chat")} />
          {codeGraphIndexed && onCodeGraphViewFloatingRepository ? (
            <RepositoryCodeGraphAction onOpen={() => onCodeGraphViewFloatingRepository(repository)} />
          ) : null}
          {onOpenScheduledTasks ? (
            <SidebarScheduledTasksAction
              totalCount={scheduledTasksTotalCount}
              enabledCount={scheduledTasksEnabledCount}
              onOpen={() => onOpenScheduledTasks(repository)}
            />
          ) : null}
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
                if (key === "scheduled-tasks") onOpenScheduledTasks?.(repository);
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
  scheduledTasksByRepoId = {},
  onOpenScheduledTasks,
}: {
  project: Workspace;
  projectRepos: Repository[];
  activeRepositoryId: number | null;
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
  scheduledTasksByRepoId?: Record<number, { total: number; enabled: number }>;
  onOpenScheduledTasks?: (repository: Repository) => void;
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
            isActiveRepository={repository.id === activeRepositoryId}
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
            scheduledTasksTotalCount={scheduledTasksByRepoId[repository.id]?.total ?? 0}
            scheduledTasksEnabledCount={scheduledTasksByRepoId[repository.id]?.enabled ?? 0}
            onOpenScheduledTasks={onOpenScheduledTasks}
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
          messageError("移动仓库到 Workspace 失败");
          console.error(err);
        });
      }
    },
  };
}
