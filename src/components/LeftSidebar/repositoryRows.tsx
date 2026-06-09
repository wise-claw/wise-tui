import { useState } from "react";
import { useWorkspaceTodoIncompleteCount } from "../../hooks/useWorkspaceTodoIncompleteCount";
import { UserOutlined } from "@ant-design/icons";
import { App as AntdApp, Dropdown, Popover } from "antd";
import { DeferredHoverTooltip } from "../shared/DeferredHoverTooltip";
import { openWorkspaceTodosFromSidebarMenu } from "../../utils/openWorkspaceTodosFromSidebar";
import { workspaceTodosAnchorKey } from "../../utils/workspaceTodosAnchorKey";
import type { Repository, StandaloneRepo, TaskMode, Workspace } from "../../types";
import { repositoryFolderBasename } from "../../utils/repositoryType";
import type { WorkspaceFocus } from "../../utils/workspaceMode";
import { parseOpenAppConfigureMenuKey } from "../../utils/openAppScope";
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
  ExecutableTasksIcon,
  MoreIcon,
  RepositoryTypeIcon,
  RepoDragHandleIcon,
  ScheduledTasksIcon,
  RequirementIcon,
  TrellisIcon,
  WorkspaceRemindersIcon,
} from "./SidebarIcons";
import { useIsRepositoryRunCommandRunning } from "../../hooks/useIsRepositoryRunCommandRunning";
import {
  isRepositoryRunCommandRowPinned,
  toggleRepositoryRunCommandRowPinned,
} from "../../services/repositoryRunCommandRowActionPreference";
import { useRepositoryRunCommandRowPinnedMap } from "../../hooks/useRepositoryRunCommandRowPinned";
import { RunningMainSessionDot } from "./RunningMainSessionDot";
import { RepositorySddStackBadge } from "./RepositorySddStackBadge";
import { WorkspaceTodosPopoverContent } from "./WorkspaceTodosPopoverContent";

function workspaceTodosPopoverTitle(projectId: string | null, repositoryId: number | null): string {
  if (repositoryId != null) return "仓库待办事项";
  if (projectId?.trim()) return "工作区待办事项";
  return "待办事项";
}

function repositoryTrellisEntrypointsEnabled(repository: Repository, trellisReady: boolean): boolean {
  return repository.sddMode !== "off" && (trellisReady || repository.sddMode !== "project_owned");
}

function RunCommandStopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect
        x="5"
        y="5"
        width="14"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.12"
      />
    </svg>
  );
}

function RunCommandStartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <polygon
        points="6 4 19 12 6 20"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.12"
      />
    </svg>
  );
}

/** 仓库行快捷区：运行指令启动 / 停止（运行菜单内可开启仓库行显示）。 */
function RepositoryRunCommandRowActions({
  repositoryId,
  pinned,
  onStart,
  onStop,
}: {
  repositoryId: number;
  pinned: boolean;
  onStart?: () => void;
  onStop?: () => void;
}) {
  const running = useIsRepositoryRunCommandRunning(repositoryId);

  if (!pinned) {
    if (!running || !onStop) return null;
    return (
      <DeferredHoverTooltip title="停止运行">
        <button
          type="button"
          className="app-repository-action app-repository-action--run-stop"
          aria-label="停止运行"
          onClick={(event) => {
            event.stopPropagation();
            onStop();
          }}
        >
          <RunCommandStopIcon />
        </button>
      </DeferredHoverTooltip>
    );
  }

  if (running) {
    if (!onStop) return null;
    return (
      <DeferredHoverTooltip title="停止运行">
        <button
          type="button"
          className="app-repository-action app-repository-action--run-stop"
          aria-label="停止运行"
          onClick={(event) => {
            event.stopPropagation();
            onStop();
          }}
        >
          <RunCommandStopIcon />
        </button>
      </DeferredHoverTooltip>
    );
  }

  if (!onStart) return null;
  return (
    <DeferredHoverTooltip title="启动">
      <button
        type="button"
        className="app-repository-action app-repository-action--run-start"
        aria-label="启动"
        onClick={(event) => {
          event.stopPropagation();
          onStart();
        }}
      >
        <RunCommandStartIcon />
      </button>
    </DeferredHoverTooltip>
  );
}

export function RepositoryConversationAction({ onOpen }: { onOpen: () => void }) {
  return (
    <DeferredHoverTooltip title="打开仓库对话">
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
    </DeferredHoverTooltip>
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
    <DeferredHoverTooltip title={variant === "project" ? "工作区 Trellis" : "仓库 Trellis"}>
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
    </DeferredHoverTooltip>
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
    <DeferredHoverTooltip title={tooltipTitle}>
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
    </DeferredHoverTooltip>
  );
}

export function SidebarRequirementAction({
  unsplitCount,
  onOpen,
  variant = "repo",
}: {
  unsplitCount: number;
  onOpen: () => void;
  /** project = 工作区需求（可跨仓下发）；repo = 本仓库需求 */
  variant?: "repo" | "project";
}) {
  if (unsplitCount <= 0) return null;

  const badgeLabel = unsplitCount > 99 ? "99+" : String(unsplitCount);
  const scopeLabel = variant === "project" ? "工作区需求" : "仓库需求";
  const tooltip = `${scopeLabel}：${unsplitCount} 条尚未生成任务`;

  return (
    <DeferredHoverTooltip title={tooltip}>
      <button
        type="button"
        className={`app-repository-action app-repository-action--task app-repository-action--primary app-repository-action--requirement${variant === "project" ? " app-repository-action--project-quick" : ""}`}
        aria-label={`${scopeLabel}（${unsplitCount} 条尚未生成任务）`}
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
    </DeferredHoverTooltip>
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
    <DeferredHoverTooltip title={`${executableCount} 个可执行任务`}>
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
    </DeferredHoverTooltip>
  );
}

export function SidebarWorkspaceRemindersAction({
  variant = "repo",
  projectId,
  repositoryId,
  enabled = true,
}: {
  variant?: "repo" | "project";
  projectId: string | null;
  repositoryId: number | null;
  /** 默认配置关闭待办时隐藏侧栏徽章与 Popover。 */
  enabled?: boolean;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const incompleteCount = useWorkspaceTodoIncompleteCount(
    variant === "project" ? "project" : "repository",
    projectId,
    repositoryId,
    enabled,
  );

  if (!enabled || incompleteCount <= 0) return null;

  const badgeLabel = incompleteCount > 99 ? "99+" : String(incompleteCount);
  const scopeLabel = variant === "project" ? "工作区" : "仓库";
  const tooltip = `${scopeLabel}待办事项：${incompleteCount} 条未完成`;
  const popoverTitle = workspaceTodosPopoverTitle(projectId, repositoryId);

  return (
    <Popover
      open={popoverOpen}
      onOpenChange={setPopoverOpen}
      trigger="click"
      placement="rightTop"
      destroyOnHidden
      getPopupContainer={() => document.body}
      rootClassName="app-left-sidebar-workspace-todos-popover"
      styles={{ root: { zIndex: 1200 } }}
      title={popoverTitle}
      content={
        popoverOpen ? (
          <WorkspaceTodosPopoverContent
            projectId={projectId}
            repositoryId={repositoryId}
            title={popoverTitle}
          />
        ) : null
      }
    >
      <span
        className="app-repository-action-popover-trigger"
        onClick={(e) => e.stopPropagation()}
      >
        <DeferredHoverTooltip title={tooltip}>
          <button
            type="button"
            className={`app-repository-action app-repository-action--task app-repository-action--primary app-repository-action--workspace-reminders${variant === "project" ? " app-repository-action--project-quick" : ""}`}
            aria-label={tooltip}
            aria-expanded={popoverOpen}
          >
            <span className="app-repository-action-icon-wrap">
              <WorkspaceRemindersIcon />
              <span className="app-repository-action-count-badge app-repository-action-count-badge--workspace-reminders">
                {badgeLabel}
              </span>
            </span>
          </button>
        </DeferredHoverTooltip>
      </span>
    </Popover>
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
  onOpenInTerminal,
  onOpenRepositoryInBrowser,
  onOpenRepositoryInEditor,
  onConfigureRepositoryOpenApp,
  onOpenRepositoryMainOwner,
  onConfigureSddMode,
  onConfigureRepositoryMainSessionRun,
  onNewPaneSession,
  repositoryReorder,
  hideChatAction = false,
  trellisReady = false,
  scheduledTasksTotalCount = 0,
  scheduledTasksEnabledCount = 0,
  requirementUnsplitCount = 0,
  executableTaskCount = 0,
  workspaceTodosEnabled = true,
  onOpenScheduledTasks,
  onOpenRequirements,
  onOpenExecutableTasks,
  onStartRepositoryRunCommand,
  onStopRepositoryRunCommand,
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
  onOpenInTerminal?: (repository: Repository) => void;
  onOpenRepositoryInBrowser: (repository: Repository) => void;
  onOpenRepositoryInEditor: (repository: Repository) => void;
  onConfigureRepositoryOpenApp?: (repository: Repository, openAppId: string | null) => void;
  onOpenRepositoryMainOwner?: (repository: Repository) => void;
  onConfigureSddMode?: (repository: Repository) => void;
  onConfigureRepositoryMainSessionRun?: (repository: Repository) => void;
  onNewPaneSession?: (repository: Repository) => void;
  repositoryReorder?: RepositoryReorderUi;
  hideChatAction?: boolean;
  trellisReady?: boolean;
  scheduledTasksTotalCount?: number;
  scheduledTasksEnabledCount?: number;
  requirementUnsplitCount?: number;
  executableTaskCount?: number;
  workspaceTodosEnabled?: boolean;
  onOpenScheduledTasks?: (repository: Repository) => void;
  onOpenRequirements?: (repository: Repository) => void;
  onOpenExecutableTasks?: (repository: Repository) => void;
  onStartRepositoryRunCommand?: (repository: Repository) => void;
  onStopRepositoryRunCommand?: (repository: Repository) => void;
  mainSessionRunning?: boolean;
  onStopMainSession?: () => void;
}) {
  const runCommandRunning = useIsRepositoryRunCommandRunning(repository.id);
  const runCommandRowPinnedMap = useRepositoryRunCommandRowPinnedMap();
  const pinnedRunCommandRowActions = isRepositoryRunCommandRowPinned(
    runCommandRowPinnedMap,
    repository.id,
  );
  const workspaceTrellisEnabled = project.sddMode !== "project_owned" || trellisReady;
  const moreItems = buildProjectRepositoryMoreMenuItems({
    trellisEnabled: workspaceTrellisEnabled,
    trellisReady,
    trellisRootActionEnabled: false,
    onAddWorkspaceTodo: workspaceTodosEnabled,
    onOpenRepositoryMainOwner: Boolean(onOpenRepositoryMainOwner),
    onConfigureSddMode: Boolean(onConfigureSddMode),
    onMainSessionRun: true,
    runCommandRunning,
    runRowPinned: pinnedRunCommandRowActions,
    onNewPaneSession: Boolean(onNewPaneSession),
    onOpenRepositoryInTerminal: Boolean(onOpenInTerminal),
    onOpenScheduledTasks: Boolean(onOpenScheduledTasks),
    onOpenRequirements: Boolean(onOpenRequirements),
    onOpenExecutableTasks: Boolean(onOpenExecutableTasks),
    repositoryOpenAppId: repository.openAppId,
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
  const showActiveRepository = isActiveRepository;

  return (
    <div
      className={`app-repository-row${dropRowClass}${foreignDropClass}`}
      onDragOver={repositoryReorder?.dragHandleEnabled ? repositoryReorder.onDragOverRow : undefined}
      onDragLeave={repositoryReorder?.dragHandleEnabled ? repositoryReorder.onDragLeaveRow : undefined}
      onDrop={repositoryReorder?.dragHandleEnabled ? repositoryReorder.onDropRow : undefined}
    >
      <div
        className={`app-repository-item app-repository-item--repo${showActiveRepository ? " app-repository-item--repo-active" : ""}`}
        onClick={(e) => {
          const target = e.target as HTMLElement | null;
          if (
            target?.closest(".app-repository-row-actions") ||
            target?.closest(".app-repository-row-running-status")
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
          {mainSessionRunning ? (
            <RunningMainSessionDot
              runningTitle="长驻会话运行中"
              stopTitle="结束长驻会话"
              onStop={onStopMainSession}
            />
          ) : null}
        </span>
        <div
          className="app-repository-row-actions"
          onClick={(e) => e.stopPropagation()}
        >
          <RepositoryRunCommandRowActions
            repositoryId={repository.id}
            pinned={pinnedRunCommandRowActions}
            onStart={
              onStartRepositoryRunCommand ? () => onStartRepositoryRunCommand(repository) : undefined
            }
            onStop={
              onStopRepositoryRunCommand ? () => onStopRepositoryRunCommand(repository) : undefined
            }
          />
          {hideChatAction ? null : (
            <RepositoryConversationAction onOpen={() => onOpenTaskMode(repository, "chat")} />
          )}
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
          <SidebarWorkspaceRemindersAction
            enabled={workspaceTodosEnabled}
            projectId={project.id}
            repositoryId={repository.id}
          />
          <RepositorySddStackBadge repository={repository} />
          <Dropdown
            rootClassName="app-sidebar-more-menu-dropdown"
            menu={{
              className: "app-sidebar-more-menu-inner",
              items: moreItems,
              onClick: ({ key }) => {
                if (key === "add-workspace-todo") {
                  if (!workspaceTodosEnabled) return;
                  onRepositorySelect(repository.id);
                  openWorkspaceTodosFromSidebarMenu({
                    projectId: project.id,
                    repositoryId: repository.id,
                  });
                  return;
                }
                if (key === "finder") onOpenInFinder(repository);
                if (key === "editor") onOpenRepositoryInEditor(repository);
                if (key === "open-terminal") onOpenInTerminal?.(repository);
                if (key === "browser") onOpenRepositoryInBrowser(repository);
                if (key === "main-owner") onOpenRepositoryMainOwner?.(repository);
                if (key === "detach") onDetachFromProject(project.id, repository.id);
                if (key === "sdd-mode") onConfigureSddMode?.(repository);
                if (key === "run-configure") onConfigureRepositoryMainSessionRun?.(repository);
                if (key === "run-start") onStartRepositoryRunCommand?.(repository);
                if (key === "run-stop") onStopRepositoryRunCommand?.(repository);
                if (key === "run-row-pin") void toggleRepositoryRunCommandRowPinned(repository.id);
                if (key === "new-session") onNewPaneSession?.(repository);
                if (key === "scheduled-tasks") onOpenScheduledTasks?.(repository);
                if (key === "requirements" && workspaceTrellisEnabled) onOpenRequirements?.(repository);
                if (key === "executable-tasks" && workspaceTrellisEnabled) onOpenExecutableTasks?.(repository);
                if (typeof key === "string") {
                  const openAppId = parseOpenAppConfigureMenuKey(key);
                  if (openAppId !== undefined) onConfigureRepositoryOpenApp?.(repository, openAppId);
                }
              },
            }}
            trigger={["click"]}
            placement="bottomRight"
          >
            <button
              type="button"
              className="app-repository-action app-repository-action--more"
              aria-label="仓库更多操作"
              data-workspace-todos-anchor={
                workspaceTodosEnabled
                  ? workspaceTodosAnchorKey(null, repository.id) ?? undefined
                  : undefined
              }
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
  onOpenInTerminal,
  onOpenRepositoryInBrowser,
  onOpenRepositoryInEditor,
  onConfigureRepositoryOpenApp,
  onOpenRepositoryMainOwner,
  onConfigureSddMode,
  onConfigureRepositoryMainSessionRun,
  onNewPaneSession,
  onBootstrapTrellis,
  onPromoteToNewProject,
  onJoinExistingProject,
  onRemove,
  trellisReady = false,
  onOpenFloatingRepositoryTrellis,
  scheduledTasksTotalCount = 0,
  scheduledTasksEnabledCount = 0,
  requirementUnsplitCount = 0,
  executableTaskCount = 0,
  workspaceTodosEnabled = true,
  onOpenScheduledTasks,
  onOpenRequirements,
  onOpenExecutableTasks,
  onStartRepositoryRunCommand,
  onStopRepositoryRunCommand,
  mainSessionRunning = false,
  onStopMainSession,
}: {
  repository: StandaloneRepo;
  isActiveRepository: boolean;
  joinableProjects: Workspace[];
  onRepositorySelect: (id: number | null) => void;
  onOpenTaskMode: (repository: Repository, mode: TaskMode) => void;
  onOpenInFinder: (repository: Repository) => void;
  onOpenInTerminal?: (repository: Repository) => void;
  onOpenRepositoryInBrowser: (repository: Repository) => void;
  onOpenRepositoryInEditor: (repository: Repository) => void;
  onConfigureRepositoryOpenApp?: (repository: Repository, openAppId: string | null) => void;
  onOpenRepositoryMainOwner?: (repository: Repository) => void;
  onConfigureSddMode?: (repository: Repository) => void;
  onConfigureRepositoryMainSessionRun?: (repository: Repository) => void;
  onNewPaneSession?: (repository: Repository) => void;
  onBootstrapTrellis?: (repository: Repository) => void | Promise<void>;
  onPromoteToNewProject?: (repository: StandaloneRepo) => void;
  onJoinExistingProject?: (repository: StandaloneRepo, projectId: string) => void;
  onRemove: (repository: StandaloneRepo) => void;
  trellisReady?: boolean;
  onOpenFloatingRepositoryTrellis?: (repository: Repository) => void;
  scheduledTasksTotalCount?: number;
  scheduledTasksEnabledCount?: number;
  requirementUnsplitCount?: number;
  executableTaskCount?: number;
  workspaceTodosEnabled?: boolean;
  onOpenScheduledTasks?: (repository: Repository) => void;
  onOpenRequirements?: (repository: Repository) => void;
  onOpenExecutableTasks?: (repository: Repository) => void;
  onStartRepositoryRunCommand?: (repository: Repository) => void;
  onStopRepositoryRunCommand?: (repository: Repository) => void;
  mainSessionRunning?: boolean;
  onStopMainSession?: () => void;
}) {
  const runCommandRunning = useIsRepositoryRunCommandRunning(repository.id);
  const runCommandRowPinnedMap = useRepositoryRunCommandRowPinnedMap();
  const pinnedRunCommandRowActions = isRepositoryRunCommandRowPinned(
    runCommandRowPinnedMap,
    repository.id,
  );
  const hasMainOwner = Boolean(repository.mainOwnerAgentName?.trim());
  const showActiveRepository = isActiveRepository;

  const trellisEnabled = repositoryTrellisEntrypointsEnabled(repository, trellisReady);
  const moreItems = buildFloatingRepositoryMoreMenuItems({
    joinableProjects,
    trellisEnabled,
    trellisReady,
    onAddWorkspaceTodo: workspaceTodosEnabled,
    onOpenRepositoryMainOwner: Boolean(onOpenRepositoryMainOwner),
    onConfigureSddMode: Boolean(onConfigureSddMode),
    onMainSessionRun: true,
    runCommandRunning,
    runRowPinned: pinnedRunCommandRowActions,
    onNewPaneSession: Boolean(onNewPaneSession),
    onOpenRepositoryInTerminal: Boolean(onOpenInTerminal),
    onOpenScheduledTasks: Boolean(onOpenScheduledTasks),
    onOpenRequirements: Boolean(onOpenRequirements),
    onOpenExecutableTasks: Boolean(onOpenExecutableTasks),
    onPromoteToNewProject: Boolean(onPromoteToNewProject),
    onJoinExistingProject: Boolean(onJoinExistingProject),
    repositoryOpenAppId: repository.openAppId,
  });

  return (
    <div className="app-repository-row">
      <div
        className={`app-repository-item app-repository-item--repo${showActiveRepository ? " app-repository-item--repo-active" : ""}`}
        onClick={(e) => {
          const target = e.target as HTMLElement | null;
          if (
            target?.closest(".app-repository-row-actions") ||
            target?.closest(".app-repository-row-running-status")
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
          {mainSessionRunning ? (
            <RunningMainSessionDot
              runningTitle="长驻会话运行中"
              stopTitle="结束长驻会话"
              onStop={onStopMainSession}
            />
          ) : null}
        </span>
        <div
          className="app-repository-row-actions"
          onClick={(e) => e.stopPropagation()}
        >
          <RepositoryRunCommandRowActions
            repositoryId={repository.id}
            pinned={pinnedRunCommandRowActions}
            onStart={
              onStartRepositoryRunCommand ? () => onStartRepositoryRunCommand(repository) : undefined
            }
            onStop={
              onStopRepositoryRunCommand ? () => onStopRepositoryRunCommand(repository) : undefined
            }
          />
          <RepositoryConversationAction onOpen={() => onOpenTaskMode(repository, "chat")} />
          {trellisEnabled && trellisReady && onOpenFloatingRepositoryTrellis ? (
            <RepositoryTrellisAction onOpen={() => onOpenFloatingRepositoryTrellis(repository)} />
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
          <SidebarWorkspaceRemindersAction
            enabled={workspaceTodosEnabled}
            projectId={null}
            repositoryId={repository.id}
          />
          <RepositorySddStackBadge repository={repository} />
          <Dropdown
            rootClassName="app-sidebar-more-menu-dropdown"
            menu={{
              className: "app-sidebar-more-menu-inner",
              items: moreItems,
              onClick: ({ key }) => {
                if (key === "add-workspace-todo") {
                  if (!workspaceTodosEnabled) return;
                  onRepositorySelect(repository.id);
                  openWorkspaceTodosFromSidebarMenu({
                    projectId: null,
                    repositoryId: repository.id,
                  });
                  return;
                }
                if (key === "finder") onOpenInFinder(repository);
                if (key === "editor") onOpenRepositoryInEditor(repository);
                if (key === "open-terminal") onOpenInTerminal?.(repository);
                if (key === "browser") onOpenRepositoryInBrowser(repository);
                if (key === "main-owner") onOpenRepositoryMainOwner?.(repository);
                if (key === "sdd-mode") onConfigureSddMode?.(repository);
                if (key === "run-configure") onConfigureRepositoryMainSessionRun?.(repository);
                if (key === "run-start") onStartRepositoryRunCommand?.(repository);
                if (key === "run-stop") onStopRepositoryRunCommand?.(repository);
                if (key === "run-row-pin") void toggleRepositoryRunCommandRowPinned(repository.id);
                if (key === "new-session") onNewPaneSession?.(repository);
                if (key === "trellis-init" && trellisEnabled) void Promise.resolve(onBootstrapTrellis?.(repository));
                if (key === "scheduled-tasks") onOpenScheduledTasks?.(repository);
                if (key === "requirements" && trellisEnabled) onOpenRequirements?.(repository);
                if (key === "executable-tasks" && trellisEnabled) onOpenExecutableTasks?.(repository);
                if (key === "promote") onPromoteToNewProject?.(repository);
                if (typeof key === "string" && key.startsWith("join-")) {
                  const projectId = key.slice("join-".length);
                  onJoinExistingProject?.(repository, projectId);
                }
                if (key === "remove") onRemove(repository);
                if (typeof key === "string") {
                  const openAppId = parseOpenAppConfigureMenuKey(key);
                  if (openAppId !== undefined) onConfigureRepositoryOpenApp?.(repository, openAppId);
                }
              },
            }}
            trigger={["click"]}
            placement="bottomRight"
          >
            <button
              type="button"
              className="app-repository-action app-repository-action--more"
              aria-label="仓库更多操作"
              data-workspace-todos-anchor={
                workspaceTodosEnabled
                  ? workspaceTodosAnchorKey(null, repository.id) ?? undefined
                  : undefined
              }
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
  onOpenInTerminal,
  onOpenRepositoryInBrowser,
  openRepositoryInPreferredEditor,
  onConfigureRepositoryOpenApp,
  onOpenRepositoryMainOwner,
  onReorderRepositoriesInProject,
  onMoveRepositoryToProject,
  onConfigureSddMode,
  onConfigureRepositoryMainSessionRun,
  onNewPaneSession,
  repoSidebarDragRef,
  onRepoSidebarDragEnd,
  hideChatAction = false,
  repositoryTrellisReadyById = {},
  scheduledTasksByRepoId = {},
  requirementUnsplitByRepoId = {},
  executableTasksByRepoId = {},
  workspaceTodosEnabled = true,
  onOpenScheduledTasks,
  onOpenRepositoryRequirements,
  onOpenRepositoryExecutableTasks,
  onStartRepositoryRunCommand,
  onStopRepositoryRunCommand,
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
  onOpenInTerminal?: (repository: Repository) => void;
  onOpenRepositoryInBrowser: (repository: Repository) => void;
  openRepositoryInPreferredEditor: (repository: Repository) => void;
  onConfigureRepositoryOpenApp?: (repository: Repository, openAppId: string | null) => void;
  onOpenRepositoryMainOwner?: (repository: Repository) => void;
  onReorderRepositoriesInProject?: (projectId: string, repositoryIds: number[]) => void | Promise<void>;
  onMoveRepositoryToProject?: (targetProjectId: string, repositoryId: number) => void | Promise<void>;
  onConfigureSddMode?: (repository: Repository) => void;
  onConfigureRepositoryMainSessionRun?: (repository: Repository) => void;
  onNewPaneSession?: (repository: Repository) => void;
  repoSidebarDragRef: React.MutableRefObject<{ sourceProjectId: string; repositoryId: number } | null>;
  onRepoSidebarDragEnd: () => void;
  hideChatAction?: boolean;
  repositoryTrellisReadyById?: Record<number, boolean>;
  scheduledTasksByRepoId?: Record<number, { total: number; enabled: number }>;
  requirementUnsplitByRepoId?: Record<number, number>;
  executableTasksByRepoId?: Record<number, number>;
  workspaceTodosEnabled?: boolean;
  onOpenScheduledTasks?: (repository: Repository) => void;
  onOpenRepositoryRequirements?: (repository: Repository) => void;
  onOpenRepositoryExecutableTasks?: (repository: Repository) => void;
  onStartRepositoryRunCommand?: (repository: Repository) => void;
  onStopRepositoryRunCommand?: (repository: Repository) => void;
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
            onOpenInTerminal={onOpenInTerminal}
            onOpenRepositoryInBrowser={onOpenRepositoryInBrowser}
            onOpenRepositoryInEditor={openRepositoryInPreferredEditor}
            onConfigureRepositoryOpenApp={onConfigureRepositoryOpenApp}
            onOpenRepositoryMainOwner={onOpenRepositoryMainOwner}
            onConfigureSddMode={onConfigureSddMode}
            onConfigureRepositoryMainSessionRun={onConfigureRepositoryMainSessionRun}
            onNewPaneSession={onNewPaneSession}
            repositoryReorder={reorderUi}
            hideChatAction={hideChatAction}
            trellisReady={repositoryTrellisReadyById[repository.id] === true}
            scheduledTasksTotalCount={scheduledTasksByRepoId[repository.id]?.total ?? 0}
            scheduledTasksEnabledCount={scheduledTasksByRepoId[repository.id]?.enabled ?? 0}
            requirementUnsplitCount={requirementUnsplitByRepoId[repository.id] ?? 0}
            executableTaskCount={executableTasksByRepoId[repository.id] ?? 0}
            workspaceTodosEnabled={workspaceTodosEnabled}
            onOpenScheduledTasks={onOpenScheduledTasks}
            onOpenRequirements={onOpenRepositoryRequirements}
            onOpenExecutableTasks={onOpenRepositoryExecutableTasks}
            onStartRepositoryRunCommand={onStartRepositoryRunCommand}
            onStopRepositoryRunCommand={onStopRepositoryRunCommand}
            mainSessionRunning={runningMainSessionByRepositoryId[repository.id] === true}
            onStopMainSession={
              onStopRepositoryMainSession
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
