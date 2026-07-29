import type { MutableRefObject } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as AntdApp, Button, Popover, Typography } from "antd";
import { DeferredHoverTooltip } from "../shared/DeferredHoverTooltip";
import { useWorkspaceTodoIncompleteCount } from "../../hooks/useWorkspaceTodoIncompleteCount";
import { useWorkspaceTodoCompletedCount } from "../../hooks/useWorkspaceTodoCompletedCount";
import { WorkspaceTodosPopoverContent } from "./WorkspaceTodosPopoverContent";
import {
  toggleWorkspaceMemoPanel,
  useWorkspaceMemoPanelOpen,
} from "../../stores/workspaceMemoPanelStore";
import { LEFT_SIDEBAR_SCROLLING_CLASS } from "../../constants/leftSidebarScrollPerformance";
import { useScrollEndClass } from "../../hooks/useScrollEndClass";
import { useRepositoryRunCommandRowPinnedMap } from "../../hooks/useRepositoryRunCommandRowPinned";
import { setWorkspacePointerActive } from "../../stores/chromePanelHoverStore";
import type { ReconcileProjectMode } from "../../constants/reconcileProjectMode";
import type {
  ClaudeSession,
  EmployeeMonitorItem,
  Repository,
  SessionConversationTaskItem,
  StandaloneRepo,
  TaskMode,
  TeamMonitorItem,
  Workspace,
} from "../../types";
import { type SidebarScheduledTasksSummary } from "./useSidebarScheduledTasksMap";
import { type WorkspaceFocus } from "../../utils/workspaceMode";
import { collectFlatWorkspaceRepositories } from "../../utils/repositoryWorkspaceTree";
import { repositoryFolderBasename } from "../../utils/repositoryType";
import {
  ExpandIcon,
  PlusIcon,
  WorkspaceMemoIcon,
  WorkspaceRemindersIcon,
} from "./SidebarIcons";
import {
  FloatingRepositoryRow,
  buildFlatWorkspaceReorderUi,
  type RepositoryReorderUi,
} from "./repositoryRows";
import { LeftSidebarQuickActionsPopover } from "./LeftSidebarQuickActionsPopover";
import { RepositoryWorkspaceSessionTree } from "./RepositoryWorkspaceSessionTree";
import { projectRepositoryListPropsEqual } from "./projectRepositoryListPropsEqual";

const EMPTY_JOINABLE_PROJECTS: Workspace[] = [];

export interface ProjectRepositoryListProps {
  projects: Workspace[];
  repositoriesById: Map<number, Repository>;
  floatingRepositories: StandaloneRepo[];
  workspaceRepositoryOrder?: readonly number[];
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
  onToggleProjectExpand: (projectId: string) => void;
  onTogglePinProject: (projectId: string) => void;
  onRenameProject: (project: Workspace) => void;
  onDeleteProject: (project: Workspace) => void;
  onOpenPromptsProject?: (project: Workspace) => void;
  onCreateProjectTask: (project: Workspace, mode: TaskMode) => void;
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
  onOpenSplitSessionForRepository?: (repository: Repository) => void;
  onNewPaneSessionForProject?: (project: Workspace) => void;
  onOpenSplitSessionForProject?: (project: Workspace) => void;
  onPromoteFloatingRepository?: (repository: StandaloneRepo) => void;
  onJoinFloatingRepository?: (repository: StandaloneRepo, projectId: string) => void;
  onRemoveFloatingRepository: (repository: StandaloneRepo) => void;
  onDetachRepositoryFromProject: (projectId: string, repositoryId: number) => void;
  onReorderRepositoriesInProject?: (projectId: string, repositoryIds: number[]) => void | Promise<void>;
  /** 扁平工作区列表拖拽排序 */
  onReorderWorkspaceRepositories?: (repositoryIds: number[]) => void | Promise<void>;
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
  /** 仓库即工作区：展开的仓库 id */
  expandedRepositoryIds?: Set<number>;
  onToggleRepositoryExpand?: (repositoryId: number) => void;
  /** 会话/运行子树数据 */
  workspaceSessions?: ReadonlyArray<ClaudeSession>;
  activeSessionId?: string | null;
  showWorkspaceRunItems?: boolean;
  employeeMonitorItems?: ReadonlyArray<EmployeeMonitorItem>;
  sessionConversationTaskItems?: ReadonlyArray<SessionConversationTaskItem>;
  teamMonitorItems?: ReadonlyArray<TeamMonitorItem>;
  onSelectSession?: (sessionId: string) => void;
  onRestoreHistorySessionAsMain?: (sessionId: string) => void | Promise<void>;
  onArchiveSession?: (sessionId: string) => void;
  onHistoryDrawerSessionIdChange?: (sessionId: string | null) => void;
  onRefreshHistorySessions?: (scope: {
    repositoryPath: string;
    repositoryName: string;
  }) => void | Promise<void>;
  onStopEmployeeMonitor?: (employeeId: string) => void;
  onStopTeamMonitor?: (workflowId: string) => void;
  onOpenTeamMonitorDetail?: (workflowId: string) => void;
  onCancelSessionFromMonitor?: (sessionId: string) => void;
  onOpenOmcBatchInvocationDetail?: (input: {
    sessionId: string;
    repositoryPath: string;
    invocationKey: string;
  }) => void;
  onCancelOmcDirectBatchInvocation?: (invocationKey: string) => void;
  onStopSessionConversationTask?: (item: SessionConversationTaskItem) => void;
}

function ProjectRepositoryListInner({
  projects,
  repositoriesById,
  floatingRepositories,
  workspaceRepositoryOrder = [],
  activeProjectId,
  activeRepositoryId,
  showRepositoryIconBadgesInWorkspaceList = false,
  repoSidebarDragRef,
  onRepositorySelect,
  onCreateProjectClick,
  onAddFloatingRepositoryClick,
  onOpenInFinder,
  onOpenInTerminal,
  onOpenRepositoryInBrowser,
  openRepositoryInPreferredEditor,
  onOpenRepositoryMainOwner,
  onConfigureRepositoryMainSessionRun,
  onStartRepositoryRunCommand,
  onStopRepositoryRunCommand,
  onConfigureRepositorySddMode,
  onConfigureRepositoryIconBadge,
  onConfigureRepositoryOpenApp,
  onNewPaneSessionForRepository,
  onOpenSplitSessionForRepository,
  onRemoveFloatingRepository,
  onReorderWorkspaceRepositories,
  onClearRepoSidebarDrag,
  repositoryTrellisReadyById = {},
  scheduledTasksByRepoId = {},
  requirementUnsplitByRepoId = {},
  executableTasksByRepoId = {},
  workspaceTodosEnabled = true,
  onOpenGlobalWorkspaceTodoAdd,
  onOpenScheduledTasksForRepository,
  onOpenRepositoryRequirements,
  onOpenExecutableTasksForRepository,
  runningMainSessionByRepositoryId = {},
  onStopRepositoryMainSession,
  sectionCollapsed = false,
  onSectionCollapsedChange,
  expandedRepositoryIds,
  onToggleRepositoryExpand,
  workspaceSessions = [],
  activeSessionId = null,
  showWorkspaceRunItems = true,
  employeeMonitorItems,
  sessionConversationTaskItems,
  teamMonitorItems,
  onSelectSession,
  onRestoreHistorySessionAsMain,
  onArchiveSession,
  onHistoryDrawerSessionIdChange,
  onRefreshHistorySessions,
  onStopEmployeeMonitor,
  onStopTeamMonitor,
  onOpenTeamMonitorDetail,
  onCancelSessionFromMonitor,
  onOpenOmcBatchInvocationDetail,
  onCancelOmcDirectBatchInvocation,
  onStopSessionConversationTask,
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

  const [headerTodosPopoverOpen, setHeaderTodosPopoverOpen] = useState(false);
  const [headerTodosShowCompleted, setHeaderTodosShowCompleted] = useState(false);
  const headerMemoOpen = useWorkspaceMemoPanelOpen();
  const headerTodoCount = useWorkspaceTodoIncompleteCount(workspaceTodosEnabled);
  const headerCompletedCount = useWorkspaceTodoCompletedCount(workspaceTodosEnabled);

  const runCommandRowPinnedMap = useRepositoryRunCommandRowPinnedMap();
  const { message } = AntdApp.useApp();
  const [workspaceDropHint, setWorkspaceDropHint] = useState<RepositoryReorderUi["dropHint"]>(null);

  const flatRepositories = useMemo(
    () =>
      collectFlatWorkspaceRepositories(
        [...repositoriesById.values()],
        floatingRepositories,
        workspaceRepositoryOrder,
      ),
    [repositoriesById, floatingRepositories, workspaceRepositoryOrder],
  );
  const workspaceRowReorderEnabled =
    Boolean(onReorderWorkspaceRepositories) && flatRepositories.length > 1;

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
      <div
        className="app-repository-header"
        onClick={setSectionCollapsed ? () => setSectionCollapsed(!sectionCollapsed) : undefined}
        style={setSectionCollapsed ? { cursor: 'pointer' } : undefined}
      >
        <Typography.Text className="app-repository-header-title">
          工作区
        </Typography.Text>
        <div
          className="app-repository-header-actions"
          onClick={(e) => { e.stopPropagation(); }}
        >
          <DeferredHoverTooltip title="需求">
            <button
              type="button"
              className={`app-repository-header-btn${headerMemoOpen ? " app-repository-header-btn--active" : ""}`}
              aria-label="需求"
              aria-pressed={headerMemoOpen}
              onClick={() => toggleWorkspaceMemoPanel()}
            >
              <WorkspaceMemoIcon />
            </button>
          </DeferredHoverTooltip>
          {workspaceTodosEnabled ? (
            activeProjectId?.trim() ? (
              <Popover
                open={headerTodosPopoverOpen}
                onOpenChange={(open) => {
                  setHeaderTodosPopoverOpen(open);
                  if (!open) setHeaderTodosShowCompleted(false);
                }}
                trigger="click"
                placement="rightTop"
                destroyOnHidden
                getPopupContainer={() => document.body}
                rootClassName="app-left-sidebar-workspace-todos-popover"
                styles={{ root: { zIndex: 1200 } }}
                title={
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>待办事项</span>
                    {headerTodoCount > 0 ? (
                      <Button
                        type="link"
                        size="small"
                        style={{ padding: '0 4px', fontSize: 12, lineHeight: '22px' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setHeaderTodosShowCompleted((v) => !v);
                        }}
                      >
                        {headerTodosShowCompleted ? "隐藏已完成" : `已完成 ${headerCompletedCount}`}
                      </Button>
                    ) : null}
                  </div>
                }
                content={
                  headerTodosPopoverOpen ? (
                    <WorkspaceTodosPopoverContent
                      title="待办事项"
                      showCompleted={headerTodosShowCompleted}
                      onShowCompletedChange={setHeaderTodosShowCompleted}
                    />
                  ) : null
                }
              >
                <span
                  className="app-repository-action-popover-trigger"
                  onClick={(e) => e.stopPropagation()}
                >
                  <DeferredHoverTooltip
                    title={
                      headerTodoCount > 0
                        ? `待办事项：${headerTodoCount} 条未完成`
                        : "待办事项"
                    }
                  >
                    <button
                      type="button"
                      className="app-repository-header-btn"
                      aria-label="待办事项"
                      aria-expanded={headerTodosPopoverOpen}
                    >
                      <span className="app-repository-action-icon-wrap">
                        <WorkspaceRemindersIcon />
                        {headerTodoCount > 0 ? (
                          <span className="app-repository-action-count-badge app-repository-action-count-badge--workspace-reminders">
                            {headerTodoCount > 99 ? "99+" : String(headerTodoCount)}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </DeferredHoverTooltip>
                </span>
              </Popover>
            ) : onOpenGlobalWorkspaceTodoAdd ? (
              <DeferredHoverTooltip title="添加待办事项">
                <button
                  className="app-repository-header-btn"
                  aria-label="添加待办事项"
                  onClick={onOpenGlobalWorkspaceTodoAdd}
                >
                  <WorkspaceRemindersIcon />
                </button>
              </DeferredHoverTooltip>
            ) : null
          ) : null}
          <LeftSidebarQuickActionsPopover
            projectId={activeProjectId}
            repositoryId={activeRepositoryId}
            workspaces={projects}
            repositoriesById={repositoriesById}
            floatingRepositories={floatingRepositories}
          />
          {onAddFloatingRepositoryClick ? (
            <DeferredHoverTooltip title="添加仓库">
              <button
                className="app-repository-header-btn"
                aria-label="添加仓库"
                onClick={onAddFloatingRepositoryClick}
              >
                <PlusIcon />
              </button>
            </DeferredHoverTooltip>
          ) : null}
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
        {flatRepositories.map((repository) => {
          const expanded =
            expandedRepositoryIds == null
              ? false
              : expandedRepositoryIds.has(repository.id);
          const reorderUi: RepositoryReorderUi | undefined = workspaceRowReorderEnabled
            ? buildFlatWorkspaceReorderUi({
                repository,
                flatRepositories,
                rowReorderEnabled: workspaceRowReorderEnabled,
                dropHint: workspaceDropHint,
                setDropHint: setWorkspaceDropHint,
                repoSidebarDragRef,
                onRepoSidebarDragEnd: onClearRepoSidebarDrag,
                onReorderWorkspaceRepositories,
                messageError: message.error,
              })
            : undefined;
          return (
            <FloatingRepositoryRow
              key={repository.id}
              repository={repository}
              isActiveRepository={repository.id === activeRepositoryId}
              joinableProjects={EMPTY_JOINABLE_PROJECTS}
              onRepositorySelect={onRepositorySelect}
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
              onOpenSplitSession={onOpenSplitSessionForRepository}
              onPromoteToNewProject={undefined}
              onJoinExistingProject={undefined}
              onRemove={onRemoveFloatingRepository}
              trellisReady={repositoryTrellisReadyById[repository.id] === true}
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
              expanded={expanded}
              onToggleExpand={
                onToggleRepositoryExpand
                  ? () => onToggleRepositoryExpand(repository.id)
                  : undefined
              }
              repositoryReorder={reorderUi}
            >
              {expanded ? (
                <RepositoryWorkspaceSessionTree
                  repositoryPath={repository.path}
                  repositoryName={repositoryFolderBasename(repository)}
                  sessions={workspaceSessions}
                  activeSessionId={activeSessionId}
                  showRunItems={showWorkspaceRunItems}
                  employeeMonitorItems={employeeMonitorItems}
                  sessionConversationTaskItems={sessionConversationTaskItems}
                  teamMonitorItems={teamMonitorItems}
                  onSelectSession={onSelectSession}
                  onRestoreHistorySessionAsMain={onRestoreHistorySessionAsMain}
                  onArchiveSession={onArchiveSession}
                  onHistoryDrawerSessionIdChange={onHistoryDrawerSessionIdChange}
                  onRefreshHistorySessions={onRefreshHistorySessions}
                  onStopEmployeeMonitor={onStopEmployeeMonitor}
                  onStopTeamMonitor={onStopTeamMonitor}
                  onOpenTeamMonitorDetail={onOpenTeamMonitorDetail}
                  onCancelSessionFromMonitor={onCancelSessionFromMonitor}
                  onOpenOmcBatchInvocationDetail={onOpenOmcBatchInvocationDetail}
                  onCancelOmcDirectBatchInvocation={onCancelOmcDirectBatchInvocation}
                  onStopSessionConversationTask={onStopSessionConversationTask}
                />
              ) : null}
            </FloatingRepositoryRow>
          );
        })}
        {flatRepositories.length === 0 && (
          <div
            className="app-repository-item app-repository-item--add"
            onClick={onAddFloatingRepositoryClick ?? onCreateProjectClick}
          >
            <span className="app-repository-add-icon"><PlusIcon /></span>
            <span className="app-repository-add-text">添加仓库</span>
          </div>
        )}
      </div>
      ) : null}
    </>
  );
}

export const ProjectRepositoryList = memo(
  ProjectRepositoryListInner,
  projectRepositoryListPropsEqual,
);
