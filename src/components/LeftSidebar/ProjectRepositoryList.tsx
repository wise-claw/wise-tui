import type { MutableRefObject } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as AntdApp, Typography } from "antd";
import { DeferredHoverTooltip } from "../shared/DeferredHoverTooltip";
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
import { filterVisibleWorkspaceRepositories } from "../../utils/workspaceHiddenRepositories";
import { repositoryFolderBasename } from "../../utils/repositoryType";
import {
  ExpandIcon,
  PlusIcon,
  VisibilityConfigIcon,
} from "./SidebarIcons";
import {
  FloatingRepositoryRow,
  buildFlatWorkspaceReorderUi,
  type RepositoryReorderUi,
} from "./repositoryRows";
import { LeftSidebarQuickActionsPopover } from "./LeftSidebarQuickActionsPopover";
import { RepositoryWorkspaceSessionTree } from "./RepositoryWorkspaceSessionTree";
import { WorkspaceRepositoryVisibilityPopover } from "./WorkspaceRepositoryVisibilityPopover";
import { projectRepositoryListPropsEqual } from "./projectRepositoryListPropsEqual";

const EMPTY_JOINABLE_PROJECTS: Workspace[] = [];

export interface ProjectRepositoryListProps {
  projects: Workspace[];
  repositoriesById: Map<number, Repository>;
  floatingRepositories: StandaloneRepo[];
  workspaceRepositoryOrder?: readonly number[];
  hiddenWorkspaceRepositoryIds?: readonly number[];
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
  onSetWorkspaceRepositoryHidden?: (repositoryId: number, hidden: boolean) => void;
  onShowAllWorkspaceRepositories?: () => void;
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
  hiddenWorkspaceRepositoryIds = [],
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
  onSetWorkspaceRepositoryHidden,
  onShowAllWorkspaceRepositories,
  onClearRepoSidebarDrag,
  repositoryTrellisReadyById = {},
  scheduledTasksByRepoId = {},
  requirementUnsplitByRepoId = {},
  executableTasksByRepoId = {},
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

  const runCommandRowPinnedMap = useRepositoryRunCommandRowPinnedMap();
  const { message } = AntdApp.useApp();
  const [workspaceDropHint, setWorkspaceDropHint] = useState<RepositoryReorderUi["dropHint"]>(null);
  const [visibilityOpen, setVisibilityOpen] = useState(false);

  const flatRepositories = useMemo(
    () =>
      collectFlatWorkspaceRepositories(
        [...repositoriesById.values()],
        floatingRepositories,
        workspaceRepositoryOrder,
      ),
    [repositoriesById, floatingRepositories, workspaceRepositoryOrder],
  );
  const visibleRepositories = useMemo(
    () => filterVisibleWorkspaceRepositories(flatRepositories, hiddenWorkspaceRepositoryIds),
    [flatRepositories, hiddenWorkspaceRepositoryIds],
  );
  const workspaceRowReorderEnabled =
    Boolean(onReorderWorkspaceRepositories) && visibleRepositories.length > 1;
  const handleHideRepository = useCallback(
    (repository: StandaloneRepo) => {
      onSetWorkspaceRepositoryHidden?.(repository.id, true);
    },
    [onSetWorkspaceRepositoryHidden],
  );

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
          <LeftSidebarQuickActionsPopover
            projectId={activeProjectId}
            repositoryId={activeRepositoryId}
            workspaces={projects}
            repositoriesById={repositoriesById}
            floatingRepositories={floatingRepositories}
          />
          {onSetWorkspaceRepositoryHidden && flatRepositories.length > 0 ? (
            <WorkspaceRepositoryVisibilityPopover
              repositories={flatRepositories}
              hiddenIds={hiddenWorkspaceRepositoryIds}
              open={visibilityOpen}
              onOpenChange={setVisibilityOpen}
              onSetHidden={onSetWorkspaceRepositoryHidden}
              onShowAll={onShowAllWorkspaceRepositories}
            />
          ) : null}
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
        {visibleRepositories.map((repository) => {
          const expanded =
            expandedRepositoryIds == null
              ? false
              : expandedRepositoryIds.has(repository.id);
          const reorderUi: RepositoryReorderUi | undefined = workspaceRowReorderEnabled
            ? buildFlatWorkspaceReorderUi({
                repository,
                flatRepositories: visibleRepositories,
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
              onHide={onSetWorkspaceRepositoryHidden ? handleHideRepository : undefined}
              trellisReady={repositoryTrellisReadyById[repository.id] === true}
              scheduledTasksTotalCount={scheduledTasksByRepoId[repository.id]?.total ?? 0}
              scheduledTasksEnabledCount={scheduledTasksByRepoId[repository.id]?.enabled ?? 0}
              requirementUnsplitCount={requirementUnsplitByRepoId[repository.id] ?? 0}
              executableTaskCount={executableTasksByRepoId[repository.id] ?? 0}
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
        {visibleRepositories.length === 0 && (
          <div
            className="app-repository-item app-repository-item--add"
            onClick={
              flatRepositories.length > 0 && onSetWorkspaceRepositoryHidden
                ? () => setVisibilityOpen(true)
                : onAddFloatingRepositoryClick ?? onCreateProjectClick
            }
          >
            <span className="app-repository-add-icon">
              {flatRepositories.length > 0 ? <VisibilityConfigIcon /> : <PlusIcon />}
            </span>
            <span className="app-repository-add-text">
              {flatRepositories.length > 0 ? "已隐藏全部仓库" : "添加仓库"}
            </span>
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
