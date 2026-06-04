import type {
  ClaudeComposerExecuteBubbleOptions,
  ClaudeSession,
  EmployeeItem,
  PendingExecutionTask,
  ProjectItem,
  Repository,
  WorkflowGraph,
  WorkflowTaskItem,
  WorkflowTemplateItem,
  SessionConversationTaskItem,
} from "../../types";
import { Button, Empty, Spin } from "antd";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Topbar } from "./Topbar";
export { Topbar, type TopbarProps } from "./Topbar";
import { pickSessionForRepositorySidebarSelect } from "../../utils/claudeSessionSelection";
import { filterSessionsForWorkspace } from "../../utils/projectSessionPanelFilter";
import {
  resolveBoundMainSessionId,
  resolveMainOwnerAgentNameForRepositoryPath,
  resolveRepositoryForSession,
} from "../../utils/repositoryMainSessionBinding";
import {
  isChatSurfaceReady,
  resolveClaudePanelActiveSession,
  resolveClaudeWorkspaceMainSession,
  resolveProjectComposerRepository,
} from "../../utils/workspaceSelectionState";
import { loadSessionOwnerHints } from "../../utils/sessionOwnerHints";
import type { WorkspaceMode, WorkspaceFocus } from "../../utils/workspaceMode";
import { type PaneCount, type PaneSlot } from "../../constants/mainLayoutWidths";
import type { MultiPaneSharedChatProps, PaneRepoTreeNode } from "./ClaudeMultiPaneGrid";
import { runPaneCreateTask } from "./paneCreateLoading";
import { WorkspaceViewportLoading } from "../WorkspaceViewportLoading";
import "./index.css";

const TerminalPanelLazy = lazy(() =>
  import("../TerminalPanel").then((module) => ({ default: module.TerminalPanel })),
);
const ClaudeMultiPaneGridLazy = lazy(() =>
  import("./ClaudeMultiPaneGrid").then((module) => ({ default: module.ClaudeMultiPaneGrid })),
);
const ClaudeSessionChatWithDockLazy = lazy(() =>
  import("./ClaudeSessionChatWithDock").then((module) => ({
    default: module.ClaudeSessionChatWithDock,
  })),
);

const claudeChatSurfaceChunk = import("./ClaudeSessionChatWithDock");
const claudeMultiPaneChunk = import("./ClaudeMultiPaneGrid");

interface SessionEmptyStateProps {
  title: string;
  hint: string;
  primaryAction?: {
    label: string;
    onClick: () => void;
    loading?: boolean;
    disabled?: boolean;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  /** 在操作按钮上方渲染的额外内容（如仓库选择器）。 */
  extraContent?: React.ReactNode;
}

function SessionEmptyState({
  title,
  hint,
  primaryAction,
  secondaryAction,
  extraContent,
}: SessionEmptyStateProps) {
  return (
    <div className="app-claude-session-empty">
      <Empty
        className="app-claude-session-empty__content"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <span className="app-claude-session-empty__copy">
            <span className="app-claude-session-empty__title">{title}</span>
            <span className="app-claude-session-empty__hint">{hint}</span>
          </span>
        }
      >
        {extraContent}
        {primaryAction || secondaryAction ? (
          <div className="app-claude-session-empty__actions">
            {primaryAction ? (
              <Button
                type="primary"
                onClick={primaryAction.onClick}
                loading={primaryAction.loading}
                disabled={primaryAction.disabled}
              >
                {primaryAction.label}
              </Button>
            ) : null}
            {secondaryAction ? (
              <Button onClick={secondaryAction.onClick}>
                {secondaryAction.label}
              </Button>
            ) : null}
          </div>
        ) : null}
      </Empty>
    </div>
  );
}

// ── ClaudeSessions ──

interface Props {
  sessions: ClaudeSession[];
  activeSessionId: string | null;
  hideTopbar?: boolean;
  activeRepository?: Repository;
  repositories?: Repository[];
  activeRepositoryId?: number | null;
  /**
   * 与 `useWorkspaceMode` 一致的派生形态。`multi_repo` 时面板只展示锚点 path 的项目主会话；
   * `single_repo` 维持历史列表行为。缺省按 `single_repo` 处理（向后兼容）。
   */
  workspaceMode?: WorkspaceMode;
  /** 当 `workspaceMode === "multi_repo"` 时用于解析项目主会话 anchor.path。 */
  activeProject?: ProjectItem | null;
  /** 全部工作区（项目），用于窗格仓库选择器的树状分组。 */
  projects?: ProjectItem[];
  /** 侧栏选中粒度：Workspace 项目 vs 具体仓库。 */
  activeWorkspaceFocus?: WorkspaceFocus;
  onSelectRepository?: (id: number) => void;
  onUpdateSessionModel: (sessionId: string, model: string) => void;
  onUpdateSessionConnectionKind: (
    sessionId: string,
    kind: import("../../constants/claudeConnection").ClaudeSessionConnectionKind,
  ) => void | Promise<void>;
  onUpdateRepositoryExecutionEngine?: (
    repositoryId: number,
    engine: import("../../types").SessionExecutionEngine,
  ) => void | Promise<void>;
  onUpdateEmployeeExecutionEngine?: (
    employeeId: string,
    engine: import("../../types").SessionExecutionEngine,
  ) => void | Promise<void>;
  codexAvailable?: boolean;
  cursorAvailable?: boolean;
  onOpenExecutionEnvironment?: () => void;
  onExecuteSession: (
    sessionId: string,
    prompt: string,
    dispatchTarget?: Pick<PendingExecutionTask, "targetType" | "targetEmployeeName" | "targetWorkflowId" | "targetWorkflowName">,
    executeOptions?: ClaudeComposerExecuteBubbleOptions,
  ) => boolean | void | Promise<boolean | void>;
  onResumeSessionFromMonitorDrawer?: import("../ProgressMonitorPanel/MonitorDrawerSessionComposer").MonitorDrawerResumeSessionFn;
  onPrepareSessionForMonitorDrawer?: import("../ProgressMonitorPanel/MonitorDrawerSessionComposer").MonitorDrawerPrepareSessionFn;
  onDispatchExecutionEnvironment?: (input: {
    prompt: string;
    userBubblePrompt?: string;
  }) => void | Promise<void>;
  onSendMessage: (prompt: string) => void;
  onCancelSession: (sessionId: string, opts?: { retractLastUserTurn?: boolean }) => void;
  onCloseSession: (sessionId: string) => void;
  onSwitchSession: (sessionId: string) => void;
  onNewSession: (repository: Repository) => void | Promise<void>;
  onNewProjectSession?: (project: ProjectItem) => void | Promise<void>;
  onRespondToQuestion: (sessionId: string, answers: string[], customAnswer?: string) => void;
  onDismissQuestion: (sessionId: string) => void;
  onRespondToPermission: (sessionId: string, response: "allow_once" | "allow_always" | "deny") => void;
  onClearTodos: (sessionId: string) => void;
  onToggleTodo: (sessionId: string, todoId: string) => void;
  onRestoreTodosFromTranscript: (sessionId: string) => void;
  onRestorePendingPermissionFromTranscript: (sessionId: string) => void;
  onClearFollowups: (sessionId: string) => void;
  onClearRevertItems: (sessionId: string) => void;
  onSendFollowup: (sessionId: string, id: string) => void;
  onRestoreRevert: (sessionId: string, itemId: string) => void | Promise<void>;
  /** 终端运行报错自动修复：创建独立 Claude 会话处理（非主会话） */
  onAutoFixRunError?: (prompt: string) => void | Promise<void>;
  /** 多屏模式屏数：1=单屏，2/4/6/8=多屏 */
  paneCount?: PaneCount;
  /** 多屏额外窗格槽位 */
  extraPanes?: PaneSlot[];
  onChangePaneCount?: (count: PaneCount) => void;
  onPaneRepositorySelect?: (slotIndex: number, repositoryId: number) => void | Promise<void>;
  onPaneProjectNewSession?: (
    slotIndex: number,
    projectId: string,
    projects: ProjectItem[],
    options?: { rootPath?: string | null; projectName?: string | null },
  ) => void | Promise<void>;
  onNewPaneSession?: (slotIndex: number, repository: Repository) => void | Promise<void>;
  onToggleSidebar?: () => void;
  onToggleRightPanel?: () => void;
  rightPanelDefaultCollapsed?: boolean;
  onSetRightPanelDefaultCollapsed?: (collapsed: boolean) => void;
  onToggleTerminal?: () => void;
  onSearch?: () => void;
  collapsed?: boolean;
  rightCollapsed?: boolean;
  terminalCollapsed?: boolean;
  onOpenWorkflowConfig?: () => void;
  /** 从会话快捷条「更多」直达指定内置助手对话页 */
  onOpenBuiltinAssistant?: (assistantId: string) => void;
  /** 打开当前仓库定时任务叠层（主区+右栏，与技能市场同构） */
  onOpenRepositoryScheduledTasks?: () => void;
  employees?: EmployeeItem[];
  mentionEmployees?: EmployeeItem[];
  composerProjectRoleTagOptions?: ReadonlyArray<import("../../utils/projectRoleTagOptions").RoleTagOption>;
  composerProjectRepositoryMentionOptions?: ReadonlyArray<
    import("../../utils/projectRoleTagOptions").RepositoryMentionOption
  >;
  composerHideEmployeesInAtMode?: boolean;
  workflowTasks?: WorkflowTaskItem[];
  onDecideWorkflowTask?: (input: {
    taskId: string;
    employeeId: string;
    decision: "approved" | "rejected";
    reason?: string;
  }) => Promise<void>;
  taskPendingEmployeesByTaskId?: Record<string, Array<{ employeeId: string; name: string }>>;
  workflowTemplates?: WorkflowTemplateItem[];
  workflowGraphsByWorkflowId?: Record<string, WorkflowGraph>;
  workflowGraphStatusByWorkflowId?: Record<string, string>;
  onOpenTaskDetail?: (taskId: string) => void;
  panelBelowMessages?: React.ReactNode;
  hideMessages?: boolean;
  hideSessionTools?: boolean;
  /** 侧栏展示的当前仓库 Claude 槽位剩余（估算），不限制多选条数 */
  taskListConcurrentCapacity?: number;
  /** 按标签会话解析并发槽位，供批量直接 OMC 与主发一致占槽 */
  resolveTaskListOmcInvokeConcurrency?: (session: ClaudeSession) => {
    concurrencyScopeKey: string;
    concurrencyLimit: number;
  } | null;
  /** 与侧栏仓库主会话绑定一致，用于 OMC 批量等挂到固定主标签 */
  repositoryMainBindings?: Record<string, string>;
  /** 将系统消息写入指定 tab 会话（如主会话上的批量 OMC 系统提示） */
  onAppendSystemMessage?: (sessionId: string, text: string) => void;
  /** 仅追加用户气泡（不 invoke），用于批量 OMC 展示派发正文 */
  onAppendUserMessage?: (sessionId: string, text: string) => void;
  /** 直连批量 OMC：可执行任务成功标为已完成时，向「OMC员工」标签追加系统提示 */
  onNotifyOmcEmployeeDirectBatchTaskDone?: (input: {
    repositoryPath: string;
    repositoryDisplayName: string;
    employeeMessage: string;
  }) => void;
  /** 直连批量 OMC 启动前：清空「OMC员工」该仓库标签并预建新会话，避免沿用 */
  onPrepareFreshOmcEmployeeWorkerForDirectBatch?: (input: {
    repositoryPath: string;
    repositoryDisplayName: string;
  }) => void | Promise<void>;
  /** 从历史会话弹窗重新扫描当前仓库磁盘上的 Claude 会话 */
  onRefreshHistorySessions?: (scope: import("./ClaudeChat").RefreshHistorySessionsScope) => void | Promise<void>;
  /** 历史会话弹窗内删除某条会话（物理删除 jsonl + 内存清理）。运行中状态会被拒绝，由调用方做二次确认。 */
  onDeleteHistorySession?: (sessionId: string) => Promise<void>;
  /** 打开历史会话 transcript 抽屉；是否自动展开右栏由默认配置决定 */
  onOpenHistorySessionInInspector?: (sessionId: string) => void;
  /** 将历史会话恢复为当前仓库主会话 */
  onRestoreHistorySessionAsMain?: (sessionId: string) => void | Promise<void>;
  /** 直连批量 OMC 进行中（`omcBatchRuntime.active`），供各标签内「OMC员工」空闲判定与监控一致 */
  omcBatchPipelineActive?: boolean;
  /** 工作树弹窗：将 worktree 目录加入当前侧栏项目 */
  onAddWorktreeRepositoryToProject?: (worktreePath: string) => void | Promise<void>;
  /** 从磁盘加载完整 jsonl 覆盖指定标签消息（尾部懒加载后补齐） */
  onReloadFullDiskTranscript?: (sessionId: string) => void | Promise<void>;
  /** 渐进加载更早 jsonl 尾部 */
  onLoadMoreTranscriptFromDisk?: (sessionId: string) => void | Promise<void>;
  /** 手动执行 `/compact` 压缩指定标签会话历史 */
  onCompactSessionHistory?: (sessionId: string) => void | Promise<void>;
  onStopSessionConversationTask?: (item: SessionConversationTaskItem) => void;
  missionContext?: {
    projectId?: string | null;
    rootPath?: string | null;
  };
}

export function ClaudeSessions({
  sessions: incomingSessions,
  activeSessionId,
  hideTopbar = false,
  activeRepository,
  repositories,
  activeRepositoryId,
  workspaceMode = "single_repo",
  activeProject = null,
  projects = [],
  activeWorkspaceFocus = "repository",
  onSelectRepository,
  onUpdateSessionModel,
  onUpdateSessionConnectionKind,
  onUpdateRepositoryExecutionEngine,
  onUpdateEmployeeExecutionEngine,
  codexAvailable = true,
  cursorAvailable = true,
  onOpenExecutionEnvironment,
  onExecuteSession,
  onResumeSessionFromMonitorDrawer,
  onPrepareSessionForMonitorDrawer,
  onDispatchExecutionEnvironment,
  onSendMessage,
  onCancelSession,
  onCloseSession: _onCloseSession,
  onSwitchSession,
  onNewSession,
  onNewProjectSession,
  onRespondToQuestion,
  onDismissQuestion,
  onRespondToPermission,
  onClearTodos,
  onToggleTodo,
  onRestoreTodosFromTranscript,
  onRestorePendingPermissionFromTranscript,
  onClearFollowups,
  onClearRevertItems,
  onSendFollowup,
  onRestoreRevert,
  paneCount = 1,
  extraPanes = [],
  onChangePaneCount,
  onPaneRepositorySelect,
  onPaneProjectNewSession,
  onNewPaneSession,
  onToggleSidebar,
  onToggleRightPanel,
  rightPanelDefaultCollapsed,
  onSetRightPanelDefaultCollapsed,
  onToggleTerminal,
  onSearch,
  collapsed,
  rightCollapsed,
  terminalCollapsed,
  onAutoFixRunError: onAutoFixRunErrorFromProps,
  onOpenWorkflowConfig,
  onOpenBuiltinAssistant,
  onOpenRepositoryScheduledTasks,
  employees = [],
  mentionEmployees = [],
  composerProjectRoleTagOptions = [],
  composerProjectRepositoryMentionOptions = [],
  composerHideEmployeesInAtMode = false,
  workflowTasks = [],
  taskPendingEmployeesByTaskId = {},
  workflowTemplates = [],
  workflowGraphsByWorkflowId = {},
  workflowGraphStatusByWorkflowId = {},
  onOpenTaskDetail,
  panelBelowMessages,
  hideMessages = false,
  hideSessionTools = false,
  taskListConcurrentCapacity,
  resolveTaskListOmcInvokeConcurrency,
  repositoryMainBindings = {},
  onAppendSystemMessage,
  onAppendUserMessage,
  onNotifyOmcEmployeeDirectBatchTaskDone,
  onPrepareFreshOmcEmployeeWorkerForDirectBatch,
  onRefreshHistorySessions,
  onDeleteHistorySession,
  onOpenHistorySessionInInspector,
  onRestoreHistorySessionAsMain,
  omcBatchPipelineActive = false,
  onAddWorktreeRepositoryToProject,
  onReloadFullDiskTranscript,
  onLoadMoreTranscriptFromDisk,
  onCompactSessionHistory,
  onStopSessionConversationTask,
  missionContext,
}: Props) {
  const sessions = useMemo(
    () =>
      filterSessionsForWorkspace({
        sessions: incomingSessions,
        workspaceMode,
        project: activeProject,
        repositories: repositories ?? [],
        activeWorkspaceFocus,
        activeRepositoryId,
      }),
    [
      incomingSessions,
      workspaceMode,
      activeProject,
      repositories,
      activeWorkspaceFocus,
      activeRepositoryId,
    ],
  );

  const sessionById = useMemo(() => {
    const map = new Map<string, ClaudeSession>();
    for (const session of incomingSessions) {
      map.set(session.id, session);
    }
    return map;
  }, [incomingSessions]);

  const projectComposerRepository = useMemo(
    () => resolveProjectComposerRepository(activeProject, repositories ?? []) ?? undefined,
    [activeProject, repositories],
  );

  const chatContextRepository: Repository | undefined =
    activeRepository ?? projectComposerRepository;

  const chatSurfaceReady = isChatSurfaceReady({
    activeRepository,
    activeWorkspaceFocus,
    activeProject,
  });

  useEffect(() => {
    if (!chatSurfaceReady) return;
    void claudeChatSurfaceChunk;
    void import("./ClaudeChatComposerTray");
    void import("../ClaudeChatInput/composer-region");
    if (paneCount > 1) {
      void claudeMultiPaneChunk;
    }
  }, [chatSurfaceReady, paneCount]);

  const workflowTasksByCreator = useMemo(() => {
    const map = new Map<string, WorkflowTaskItem[]>();
    for (const task of workflowTasks) {
      const creator = task.creator?.trim();
      if (!creator) continue;
      const bucket = map.get(creator);
      if (bucket) {
        bucket.push(task);
      } else {
        map.set(creator, [task]);
      }
    }
    return map;
  }, [workflowTasks]);

  const mainSessionForDataLink = useMemo(
    () =>
      resolveClaudeWorkspaceMainSession({
        sessions: incomingSessions,
        repositoryMainBindings,
        repositories: repositories ?? [],
        activeRepository,
        activeProject,
        activeWorkspaceFocus,
        activeSessionId,
      }),
    [
      incomingSessions,
      repositoryMainBindings,
      repositories,
      activeRepository,
      activeProject,
      activeWorkspaceFocus,
      activeSessionId,
    ],
  );

  const activeSession = useMemo(
    () =>
      resolveClaudePanelActiveSession({
        sessions,
        allSessions: incomingSessions,
        activeSessionId,
        activeWorkspaceFocus,
        activeProject,
        activeRepository,
        repositories: repositories ?? [],
        repositoryMainBindings,
        workspaceMainSession: mainSessionForDataLink,
      }),
    [
      sessions,
      incomingSessions,
      activeSessionId,
      activeWorkspaceFocus,
      activeProject,
      activeRepository,
      repositories,
      repositoryMainBindings,
      mainSessionForDataLink,
    ],
  );

  /** 解析每个额外窗格对应的实际会话对象。 */
  const resolvedPaneSessions = useMemo(() => {
    return extraPanes.map((slot) => {
      if (!slot.sessionId) return null;
      return sessionById.get(slot.sessionId) ?? null;
    });
  }, [extraPanes, sessionById]);

  /** 解析每个窗格对应的仓库。 */
  const resolvedPaneRepositories = useMemo(() => {
    return extraPanes.map((slot) => {
      if (slot.repositoryId == null) return activeRepository ?? null;
      return (repositories ?? []).find((r) => r.id === slot.repositoryId) ?? activeRepository ?? null;
    });
  }, [activeRepository, extraPanes, repositories]);

  /** 窗格仓库选择器的树状数据：工作区（项目）节点 + 仓库叶子，未归属项目的仓库归入「独立仓库」组。 */
  const paneRepoTreeData = useMemo<PaneRepoTreeNode[]>(() => {
    const repoList = repositories ?? [];
    const projectList = projects ?? [];
    const repoById = new Map(repoList.map((r) => [r.id, r] as const));
    const assignedRepoIds = new Set<number>();
    const tree: PaneRepoTreeNode[] = [];

    for (const p of projectList) {
      const children: PaneRepoTreeNode[] = [];
      for (const repoId of p.repositoryIds ?? []) {
        const repo = repoById.get(repoId);
        if (!repo) continue;
        children.push({
          title: repo.name || repo.path,
          value: `repo:${repo.id}`,
          selectable: true,
          nodeType: "repo",
          repositoryId: repo.id,
        });
        assignedRepoIds.add(repoId);
      }
      tree.push({
        title: p.name || "未命名工作区",
        value: `project:${p.id}`,
        selectable: true,
        nodeType: "project",
        projectId: p.id,
        projectRootPath: p.rootPath ?? undefined,
        children,
      });
    }

    const standalone = repoList
      .filter((r) => !assignedRepoIds.has(r.id))
      .map((r) => ({
        title: r.name || r.path,
        value: `repo:${r.id}`,
        selectable: true,
        nodeType: "repo" as const,
        repositoryId: r.id,
      }));
    if (standalone.length > 0) {
      tree.push({
        title: "独立仓库",
        value: "__standalone__",
        selectable: false,
        nodeType: "group",
        children: standalone,
      });
    }

    return tree;
  }, [projects, repositories]);
  const projectsById = useMemo(
    () => new Map((projects ?? []).map((project) => [project.id.trim(), project] as const)),
    [projects],
  );

  const [pendingCollapseNotificationForSessionId, setPendingCollapseNotificationForSessionId] = useState<
    string | null
  >(null);
  const [paneRepoPickerOpenBySlot, setPaneRepoPickerOpenBySlot] = useState<Record<number, boolean>>({});
  const [creatingPaneSlots, setCreatingPaneSlots] = useState<Record<number, boolean>>({});
  const activeSessionWorkflowTasks = useMemo(
    () => (activeSession?.id ? workflowTasksByCreator.get(activeSession.id) ?? [] : []),
    [workflowTasksByCreator, activeSession?.id],
  );
  /** 各额外窗格的 workflow tasks。 */
  const paneWorkflowTasks = useMemo(() => {
    return extraPanes.map((slot) =>
      slot.sessionId ? workflowTasksByCreator.get(slot.sessionId) ?? [] : [],
    );
  }, [extraPanes, workflowTasksByCreator]);

  const [creatingPrimarySession, setCreatingPrimarySession] = useState(false);
  const creatingPrimarySessionRef = useRef(false);

  const handleCreatePrimarySession = useCallback(() => {
    if (creatingPrimarySessionRef.current) {
      return;
    }
    creatingPrimarySessionRef.current = true;
    setCreatingPrimarySession(true);
    const finish = () => {
      creatingPrimarySessionRef.current = false;
      setCreatingPrimarySession(false);
    };

    if (activeWorkspaceFocus === "project" && activeProject && onNewProjectSession) {
      void Promise.resolve(onNewProjectSession(activeProject)).finally(finish);
      return;
    }
    if (!activeRepository) {
      finish();
      return;
    }
    void Promise.resolve(onNewSession(activeRepository)).finally(finish);
  }, [
    activeProject,
    activeRepository,
    activeWorkspaceFocus,
    onNewProjectSession,
    onNewSession,
  ]);

  /** 打开仓库/项目时仅恢复已有主会话绑定，不自动新建（新建仅走「新建会话」按钮）。 */
  useEffect(() => {
    if (activeSession) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;

      if (activeWorkspaceFocus === "project" && activeProject) {
        if (mainSessionForDataLink) {
          onSwitchSession(mainSessionForDataLink.id);
        }
        return;
      }

      if (!activeRepository) {
        return;
      }

      const mainOwnerPick = resolveMainOwnerAgentNameForRepositoryPath(
        repositories ?? [],
        activeRepository.path,
      );
      const boundId = resolveBoundMainSessionId(
        activeRepository.path,
        repositoryMainBindings,
        incomingSessions,
        mainOwnerPick,
      );
      if (boundId && sessions.some((item) => item.id === boundId)) {
        onSwitchSession(boundId);
        return;
      }

      const picked = pickSessionForRepositorySidebarSelect(
        sessions,
        activeRepository.path,
        loadSessionOwnerHints(),
        { mainOwnerAgentName: mainOwnerPick },
      );
      if (picked) {
        onSwitchSession(picked.id);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeProject,
    activeRepository,
    activeSession,
    activeWorkspaceFocus,
    incomingSessions,
    mainSessionForDataLink,
    onSwitchSession,
    repositories,
    repositoryMainBindings,
    sessions,
  ]);

  const handleCreatePaneSession = useCallback(
    (slotIndex: number) => {
      const repo = resolvedPaneRepositories[slotIndex] ?? activeRepository;
      if (!repo || !onNewPaneSession) return;
      if (creatingPaneSlots[slotIndex]) return;
      setPaneRepoPickerOpenBySlot((prev) => ({ ...prev, [slotIndex]: false }));
      runPaneCreateTask(Promise.resolve(onNewPaneSession(slotIndex, repo)), slotIndex, setCreatingPaneSlots);
    },
    [activeRepository, creatingPaneSlots, onNewPaneSession, resolvedPaneRepositories],
  );

  const handlePanePickerOpenChange = useCallback((paneIdx: number, open: boolean) => {
    setPaneRepoPickerOpenBySlot((prev) => ({ ...prev, [paneIdx]: open }));
  }, []);

  const handleSwitchToSession = useCallback(
    (sessionId: string, options?: { collapseSessionNotificationPanel?: boolean }) => {
      if (options?.collapseSessionNotificationPanel) {
        setPendingCollapseNotificationForSessionId(sessionId);
      }
      const targetSession = sessions.find((item) => item.id === sessionId);
      if (!targetSession) {
        onSwitchSession(sessionId);
        return;
      }
      if (repositories?.length && onSelectRepository) {
        const targetRepository = resolveRepositoryForSession({
          session: targetSession,
          repositories,
          bindings: repositoryMainBindings,
          sessions,
          preferredRepositoryId: activeRepositoryId,
        });
        if (targetRepository && targetRepository.id !== activeRepositoryId) {
          onSelectRepository(targetRepository.id);
        }
      }
      onSwitchSession(sessionId);
    },
    [
      sessions,
      repositories,
      repositoryMainBindings,
      onSelectRepository,
      activeRepositoryId,
      onSwitchSession,
    ],
  );

  // 用 ref + Object.assign 保持 shared 引用稳定且数据始终最新，
  // 避免 sessions 高频变化时触发所有窗格 memo 比较器失效。
  const multiPaneSharedChatRef = useRef<MultiPaneSharedChatProps>({} as MultiPaneSharedChatProps);
  Object.assign(multiPaneSharedChatRef.current, {
    sessions,
    allSessionsForHistory: incomingSessions,
    repositories,
    activeProject,
    onSwitchSession: handleSwitchToSession,
    onSend: onSendMessage,
    onExecute: onExecuteSession,
    onDispatchExecutionEnvironment,
    onUpdateSessionModel,
    onUpdateSessionConnectionKind,
    onUpdateRepositoryExecutionEngine,
    onUpdateEmployeeExecutionEngine,
    codexAvailable,
    cursorAvailable,
    onOpenExecutionEnvironment,
    onCancelSession,
    onRespondToQuestion,
    onDismissQuestion,
    onRespondToPermission,
    onClearTodos,
    onToggleTodo,
    onRestoreTodosFromTranscript,
    onRestorePendingPermissionFromTranscript,
    onClearFollowups,
    onClearRevertItems,
    onSendFollowup,
    onRestoreRevert,
    onOpenWorkflowConfig,
    onOpenBuiltinAssistant,
    onOpenRepositoryScheduledTasks,
    employees,
    mentionEmployees,
    composerProjectRoleTagOptions,
    composerProjectRepositoryMentionOptions,
    composerHideEmployeesInAtMode,
    taskPendingEmployeesByTaskId,
    workflowTemplates,
    workflowGraphsByWorkflowId,
    workflowGraphStatusByWorkflowId,
    onOpenTaskDetail,
    hideMessages,
    hideSessionTools,
    taskListConcurrentCapacity,
    resolveTaskListOmcInvokeConcurrency,
    repositoryMainBindings,
    onAppendSystemMessage,
    onAppendUserMessage,
    onNotifyOmcEmployeeDirectBatchTaskDone,
    onPrepareFreshOmcEmployeeWorkerForDirectBatch,
    onRefreshHistorySessions,
    onDeleteHistorySession,
    onOpenHistorySessionInInspector,
    onRestoreHistorySessionAsMain,
    omcBatchPipelineActive,
    onAddWorktreeRepositoryToProject,
    onReloadFullDiskTranscript,
    onLoadMoreTranscriptFromDisk,
    onCompactSessionHistory,
    onStopSessionConversationTask,
    missionContext,
  });

  useEffect(() => {
    if (
      pendingCollapseNotificationForSessionId !== null &&
      activeSessionId === pendingCollapseNotificationForSessionId
    ) {
      setPendingCollapseNotificationForSessionId(null);
    }
  }, [activeSessionId, pendingCollapseNotificationForSessionId]);

  return (
    <div className="app-claude-sessions">
      {/* Topbar always visible */}
      {!hideTopbar && (
        <Topbar
          activeProject={activeProject}
          activeWorkspaceFocus={activeWorkspaceFocus}
          activeRepository={activeRepository}
          repositories={repositories ?? []}
          activeSessionRepositoryPath={
            activeSession?.repositoryPath?.trim() || chatContextRepository?.path
          }
          mainSessionForDataLink={mainSessionForDataLink}
          onSessionInsightsAiAnalysis={
            mainSessionForDataLink
              ? async (prompt) => {
                  onSwitchSession(mainSessionForDataLink.id);
                  await onExecuteSession(mainSessionForDataLink.id, prompt);
                }
              : undefined
          }
          onToggleSidebar={onToggleSidebar}
          onToggleRightPanel={onToggleRightPanel}
          rightPanelDefaultCollapsed={rightPanelDefaultCollapsed}
          onSetRightPanelDefaultCollapsed={onSetRightPanelDefaultCollapsed}
          onToggleTerminal={onToggleTerminal}
          onSearch={onSearch}
          collapsed={collapsed}
          rightCollapsed={rightCollapsed}
          terminalCollapsed={terminalCollapsed}
          onAutoFixRunError={(prompt) => onAutoFixRunErrorFromProps?.(prompt)}
          paneCount={paneCount}
          onChangePaneCount={onChangePaneCount}
        />
      )}

      {/* Session Tabs - 会话标签栏 */}
      {!chatSurfaceReady ? null : activeSession ? (
        <Suspense fallback={<WorkspaceViewportLoading />}>
        {paneCount > 1 && chatContextRepository ? (
          <ClaudeMultiPaneGridLazy
            paneCount={paneCount}
            activeSession={activeSession}
            activeRepository={chatContextRepository}
            extraPanes={extraPanes}
            resolvedPaneSessions={resolvedPaneSessions}
            resolvedPaneRepositories={resolvedPaneRepositories}
            activeSessionWorkflowTasks={activeSessionWorkflowTasks}
            paneWorkflowTasks={paneWorkflowTasks}
            shared={multiPaneSharedChatRef.current}
            projects={projects ?? []}
            paneRepoTreeData={paneRepoTreeData}
            projectsById={projectsById}
            pendingCollapseNotificationForSessionId={pendingCollapseNotificationForSessionId}
            creatingPaneSlots={creatingPaneSlots}
            paneRepoPickerOpenBySlot={paneRepoPickerOpenBySlot}
            onCreatePrimarySession={handleCreatePrimarySession}
            onCreatePaneSession={handleCreatePaneSession}
            onPickerOpenChange={handlePanePickerOpenChange}
            setCreatingPaneSlots={setCreatingPaneSlots}
            onPaneRepositorySelect={onPaneRepositorySelect}
            onPaneProjectNewSession={onPaneProjectNewSession}
            onNewPaneSession={onNewPaneSession}
            panelBelowMessages={panelBelowMessages}
          />
        ) : (
          <ClaudeSessionChatWithDockLazy
            key={activeSession.id}
            session={activeSession}
            activeSessionId={activeSession.id}
            sessions={sessions}
            allSessionsForHistory={incomingSessions}
            repositories={repositories}
            activeRepository={chatContextRepository}
            activeProject={activeProject}
            initialNotificationPanelCollapsed={
              pendingCollapseNotificationForSessionId === activeSession.id
            }
            onSwitchSession={handleSwitchToSession}
            onCreateNewSession={handleCreatePrimarySession}
            creatingNewSession={creatingPrimarySession}
            onOpenBuiltinAssistant={onOpenBuiltinAssistant}
            onOpenRepositoryScheduledTasks={onOpenRepositoryScheduledTasks}
            onSend={onSendMessage}
            onExecute={onExecuteSession}
            onResumeSessionFromMonitorDrawer={onResumeSessionFromMonitorDrawer}
            onPrepareSessionForMonitorDrawer={onPrepareSessionForMonitorDrawer}
            onDispatchExecutionEnvironment={onDispatchExecutionEnvironment}
            onSessionModelChange={(model) => onUpdateSessionModel(activeSession.id, model)}
            onSessionConnectionKindChange={(kind) =>
              void onUpdateSessionConnectionKind(activeSession.id, kind)
            }
            onUpdateRepositoryExecutionEngine={onUpdateRepositoryExecutionEngine}
            onUpdateEmployeeExecutionEngine={onUpdateEmployeeExecutionEngine}
            codexAvailable={codexAvailable}
            cursorAvailable={cursorAvailable}
            onOpenExecutionEnvironment={onOpenExecutionEnvironment}
            onCancel={(opts) => onCancelSession(activeSession.id, opts)}
            onCancelSessionById={onCancelSession}
            respondQuestionAt={onRespondToQuestion}
            dismissQuestionAt={onDismissQuestion}
            onRespondToPermission={(response) => onRespondToPermission(activeSession.id, response)}
            onClearTodos={() => onClearTodos(activeSession.id)}
            onToggleTodo={(todoId) => onToggleTodo(activeSession.id, todoId)}
            onRestoreTodosFromTranscript={() => onRestoreTodosFromTranscript(activeSession.id)}
            onRestorePendingPermissionFromTranscript={() =>
              onRestorePendingPermissionFromTranscript(activeSession.id)
            }
            onClearFollowups={() => onClearFollowups(activeSession.id)}
            onClearRevertItems={() => onClearRevertItems(activeSession.id)}
            onSendFollowup={(id) => onSendFollowup(activeSession.id, id)}
            onRestoreRevert={(id) => onRestoreRevert(activeSession.id, id)}
            onOpenWorkflowConfig={onOpenWorkflowConfig}
            employees={employees}
            mentionEmployees={mentionEmployees}
            projectRoleTagOptions={composerProjectRoleTagOptions}
            projectRepositoryMentionOptions={composerProjectRepositoryMentionOptions}
            hideEmployeesInAtMode={composerHideEmployeesInAtMode}
            workflowTasks={activeSessionWorkflowTasks}
            taskPendingEmployeesByTaskId={taskPendingEmployeesByTaskId}
            workflowTemplates={workflowTemplates}
            workflowGraphsByWorkflowId={workflowGraphsByWorkflowId}
            workflowGraphStatusByWorkflowId={workflowGraphStatusByWorkflowId}
            onOpenTaskDetail={onOpenTaskDetail}
            panelBelowMessages={panelBelowMessages}
            hideMessages={hideMessages}
            hideSessionTools={hideSessionTools}
            taskListConcurrentCapacity={taskListConcurrentCapacity}
            resolveTaskListOmcInvokeConcurrency={resolveTaskListOmcInvokeConcurrency}
            repositoryMainBindings={repositoryMainBindings}
            onAppendSystemMessage={onAppendSystemMessage}
            onAppendUserMessage={onAppendUserMessage}
            onNotifyOmcEmployeeDirectBatchTaskDone={onNotifyOmcEmployeeDirectBatchTaskDone}
            onPrepareFreshOmcEmployeeWorkerForDirectBatch={onPrepareFreshOmcEmployeeWorkerForDirectBatch}
            onRefreshHistorySessions={onRefreshHistorySessions}
            onDeleteHistorySession={onDeleteHistorySession}
            onOpenHistorySessionInInspector={onOpenHistorySessionInInspector}
            onStopSessionConversationTask={onStopSessionConversationTask}
            onRestoreHistorySessionAsMain={onRestoreHistorySessionAsMain}
            omcBatchPipelineActive={omcBatchPipelineActive}
            onAddWorktreeRepositoryToProject={onAddWorktreeRepositoryToProject}
            onReloadFullDiskTranscript={onReloadFullDiskTranscript}
            onLoadMoreTranscriptFromDisk={onLoadMoreTranscriptFromDisk}
            onCompactSessionHistory={onCompactSessionHistory}
            missionContext={missionContext}
          />
        )}
        </Suspense>
      ) : (
        <SessionEmptyState
          title="暂无 Claude Code 会话"
          hint="使用下方「新建会话」开始对话，或从「历史会话」恢复已有会话。"
          primaryAction={{
            label: "新建会话",
            onClick: handleCreatePrimarySession,
            loading: creatingPrimarySession,
            disabled: creatingPrimarySession,
          }}
        />
      )}

      {/* Terminal Panel：按需加载 xterm，避免进入会话页即拉取 terminal-vendor */}
      {!terminalCollapsed && chatContextRepository && onToggleTerminal && (
        <Suspense
          fallback={
            <div className="app-claude-sessions-terminal-lazy-fallback" role="status" aria-label="终端加载中">
              <Spin size="small" />
            </div>
          }
        >
          <TerminalPanelLazy
            repositoryPath={chatContextRepository.path}
            repositoryName={chatContextRepository.name}
            branch={chatContextRepository.branch}
            dirty={false}
            onClose={onToggleTerminal}
          />
        </Suspense>
      )}
    </div>
  );
}
