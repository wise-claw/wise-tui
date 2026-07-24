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
import { Spin } from "antd";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  getClaudeSessionsSnapshot,
  getClaudeSessionSnapshot,
  useClaudeSessionsStructureKey,
} from "../../stores/claudeSessionsLiveStore";
import { WORKSPACE_MEMO_PANEL_NODE } from "../WorkspaceMemoPanel";
import { TERMINAL_CENTER_SLOT_SENTINEL } from "../TerminalPanel/terminalCenterSlot";
import {
  closeTerminalCenterPanelOnPane,
  collapseTerminalCenterPanelOnPane,
  useTerminalCenterPanelState,
} from "../../stores/terminalCenterPanelStore";
import { ClaudeSessionsChatHost } from "./ClaudeSessionsChatHost";
import { Topbar, type PaneTopbarSharedProps } from "./Topbar";
export { Topbar, type TopbarProps, type PaneTopbarSharedProps } from "./Topbar";
import type { CenterView } from "./ClaudeChat";
import type { PaneAuxLayout, ResolvePaneAuxLayout } from "./paneAuxLayout";
import { pickSessionForRepositorySidebarSelect } from "../../utils/claudeSessionSelection";
import { filterSessionsForWorkspace, sessionMatchesProjectWorkspaceFocus } from "../../utils/projectSessionPanelFilter";
import {
  resolveBoundMainSessionId,
  resolveMainOwnerAgentNameForRepositoryPath,
  resolveRepositoryForSession,
} from "../../utils/repositoryMainSessionBinding";
import {
  isChatSurfaceReady,
  resolveChatContextRepository,
  resolveClaudePanelActiveSession,
  resolveClaudeWorkspaceMainSession,
} from "../../utils/workspaceSelectionState";
import { loadSessionOwnerHints } from "../../utils/sessionOwnerHints";
import type { WorkspaceMode, WorkspaceFocus } from "../../utils/workspaceMode";
import { type PaneCount, type PaneSlot } from "../../constants/mainLayoutWidths";
import type { PaneRepoTreeNode } from "./ClaudeMultiPaneGrid";
import { prefetchModule } from "../../utils/prefetchModule";
import { prefetchNewSessionSurface } from "./prefetchNewSessionSurface";
import { claudeSessionsShellPropsEqual } from "./claudeSessionsPropsEqual";
import "./index.css";

const TerminalPanelLazy = lazy(() =>
  import("../TerminalPanel").then((module) => ({ default: module.TerminalPanel })),
);

export interface ClaudeSessionsProps {
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
  /** Per-session ultracode setter；顶层 (sessionId, next) 签名，per-session false beats global true。 */
  onUpdateSessionUltracode?: (sessionId: string, next: boolean | null) => void;
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
  geminiAvailable?: boolean;
  opencodeAvailable?: boolean;
  qoderAvailable?: boolean;
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
  onDispatchSessionFeedbackLoop?: (input: {
    anchorSessionId: string;
    prompt: string;
    kind: import("../../utils/sessionFeedbackLoopDispatch").FeedbackLoopDispatchKind;
    cycleIndex?: number;
  }) => void | Promise<void>;
  onSendMessage: (prompt: string) => void;
  onCancelSession: (sessionId: string, opts?: { retractLastUserTurn?: boolean }) => void;
  onCloseSession: (sessionId: string) => void;
  onSwitchSession: (sessionId: string) => void;
  onNewSession: (repository: Repository) => void | Promise<void>;
  onNewProjectSession?: (project: ProjectItem) => void | Promise<void>;
  /** 打开仓库时恢复或自动新建主会话（非手动「新建会话」）。 */
  onEnsureRepositorySession?: (repository: Repository) => void | Promise<void>;
  /** 打开工作区时恢复或自动新建项目主会话（非手动「新建会话」）。 */
  onEnsureProjectSession?: (project: ProjectItem) => void | Promise<void>;
  onRespondToQuestion: (sessionId: string, answers: string[], customAnswer?: string) => void;
  onDismissQuestion: (sessionId: string) => void;
  onRespondToPermission: (sessionId: string, response: "allow_once" | "allow_always" | "deny") => void;
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
  /** 多屏切换进行中，用于切换按钮 loading/disabled 反馈 */
  paneChangeInFlight?: boolean;
  /** 多屏额外窗格槽位 */
  extraPanes?: PaneSlot[];
  /** 主窗格运行时覆盖 */
  primaryPaneRuntimeOverride?: import("../../types/paneRuntimeOverride").PaneRuntimeOverride | null;
  onUpdatePaneRuntimeOverride?: (
    paneIndex: number,
    patch: Partial<import("../../types/paneRuntimeOverride").PaneRuntimeOverride>,
  ) => void;
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
  onToggleTerminal?: () => void;
  onCollapseTerminal?: () => void;
  onCloseTerminalPanel?: () => void;
  onSearch?: () => void;
  /** 按指定仓库路径打开搜索面板（多屏 per-pane 顶栏搜索按钮，作用于该 pane 仓库）。 */
  onSearchForRepository?: (repositoryPath: string) => void;
  collapsed?: boolean;
  rightCollapsed?: boolean;
  terminalCollapsed?: boolean;
  terminalPanelMounted?: boolean;
  onOpenWorkflowConfig?: () => void;
  /** 从会话快捷条「更多」直达指定内置助手对话页 */
  onOpenBuiltinAssistant?: (assistantId: string) => void;
  /** 按助手模板完整激活（对话 / 链接 / 工作流 / 脚本） */
  onActivateAssistant?: (assistant: import("../../types/assistant").AssistantEntry) => void | Promise<void>;
  /** 从会话快捷条「更多」进入 Author 域「助手模板」 */
  onOpenAssistantsHub?: () => void;
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
  /** 中栏「消息/文件」视图当前值（由 layout 壳层提升持有，全局 Topbar 的 Segmented
   *  与 ClaudeChat 共享同一份状态；多屏时各 pane 在 ClaudeMultiPaneGrid 内自管，不读此 prop）。 */
  centerView?: CenterView;
  /** 多屏时按窗格解析文件等中栏辅助面板布局。 */
  resolvePaneAuxLayout?: ResolvePaneAuxLayout;
  /**
   * 多屏辅助面板（文件编辑器）布局版本号。每次某 pane 的 editorVisible 变化（开/关文件）
   * 时 +1。`MemoClaudeSessions` 的 memo comparator 会跳过函数 prop（`resolvePaneAuxLayout`
   * 每次渲染都是新引用），若仅靠它无法触发重渲；这里用一个 number 显式驱动：版本号变化即
   * 重渲，从而让 `resolvePaneAuxLayout(paneIndex)` 返回的最新 bridge 元素被挂载/卸载。
   */
  centerAuxPanelsNodeByPaneVersion?: number;
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
  /** 从磁盘加载完整 jsonl 覆盖指定标签消息（尾部懒加载后补齐） */
  onReloadFullDiskTranscript?: (sessionId: string) => void | Promise<void>;
  /** 渐进加载更早 jsonl 尾部 */
  onLoadMoreTranscriptFromDisk?: (sessionId: string) => void | Promise<void>;
  /** 手动执行 `/compact` 压缩指定标签会话历史 */
  onCompactSessionHistory?: (sessionId: string) => void | Promise<void>;
  onStopSessionConversationTask?: (item: SessionConversationTaskItem) => void;
  /** 多屏下每个 pane 顶栏共享的回调与状态（窗口级 + 会话级 + per-pane 搜索入口）。
   *  由 AppWorkspaceLayout 组装，经 ClaudeSessionsChatHost 透传到 ClaudeMultiPaneGrid 各 pane。 */
  paneTopbarShared?: PaneTopbarSharedProps;
}

function ClaudeSessionsShell({
  sessions: _sessionsPropIgnored,
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
  onUpdateSessionUltracode,
  onUpdateRepositoryExecutionEngine,
  onUpdateEmployeeExecutionEngine,
  codexAvailable = true,
  cursorAvailable = true,
  geminiAvailable = false,
  opencodeAvailable = false,
  qoderAvailable = false,
  onOpenExecutionEnvironment,
  onExecuteSession,
  onResumeSessionFromMonitorDrawer,
  onPrepareSessionForMonitorDrawer,
  onDispatchExecutionEnvironment,
  onDispatchSessionFeedbackLoop,
  onSendMessage,
  onCancelSession,
  onCloseSession: _onCloseSession,
  onSwitchSession,
  onNewSession,
  onNewProjectSession,
  onEnsureRepositorySession,
  onEnsureProjectSession,
  onRespondToQuestion,
  onDismissQuestion,
  onRespondToPermission,
  onToggleTodo,
  onRestoreTodosFromTranscript,
  onRestorePendingPermissionFromTranscript,
  onClearFollowups,
  onClearRevertItems,
  onSendFollowup,
  onRestoreRevert,
  paneCount = 1,
  paneChangeInFlight = false,
  extraPanes = [],
  primaryPaneRuntimeOverride = null,
  onUpdatePaneRuntimeOverride,
  onChangePaneCount,
  onPaneRepositorySelect,
  onPaneProjectNewSession,
  onNewPaneSession,
  onToggleSidebar,
  onToggleTerminal,
  onSearch,
  collapsed,
  terminalCollapsed,
  terminalPanelMounted = false,
  onAutoFixRunError: onAutoFixRunErrorFromProps,
  onOpenWorkflowConfig,
  onOpenBuiltinAssistant,
  onActivateAssistant,
  onOpenAssistantsHub,
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
  centerView,
  hideMessages = false,
  hideSessionTools = false,
  resolvePaneAuxLayout,
  centerAuxPanelsNodeByPaneVersion,
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
  onReloadFullDiskTranscript,
  onLoadMoreTranscriptFromDisk,
  onCompactSessionHistory,
  onStopSessionConversationTask,
  paneTopbarShared,
}: ClaudeSessionsProps) {
  const structureKey = useClaudeSessionsStructureKey();
  const incomingSessions = useMemo(() => getClaudeSessionsSnapshot(), [structureKey]);

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

  const chatContextRepository: Repository | undefined = useMemo(() => {
    const currentSession =
      activeSessionId != null ? sessionById.get(activeSessionId) ?? null : null;
    return (
      resolveChatContextRepository({
        activeRepository,
        activeProject,
        activeWorkspaceFocus,
        repositories: repositories ?? [],
        sessionRepositoryPath: currentSession?.repositoryPath,
        sessionRepositoryName: currentSession?.repositoryName,
      }) ?? undefined
    );
  }, [
    activeProject,
    activeRepository,
    activeSessionId,
    activeWorkspaceFocus,
    repositories,
    sessionById,
  ]);

  const chatSurfaceReady = isChatSurfaceReady({
    activeRepository,
    activeWorkspaceFocus,
    activeProject,
  });

  useEffect(() => {
    if (!chatSurfaceReady) return;
    prefetchNewSessionSurface();
    // 首次进入多屏前预热 grid chunk，消除冷加载卡顿；
    // 原 paneCount>1 门控只有已进入多屏后才预热，无法覆盖首次 1→N 切换。
    prefetchModule(() => import("./ClaudeMultiPaneGrid"), "ClaudeMultiPaneGrid");
  }, [chatSurfaceReady]);

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
        workspaceMode,
      }),
    [
      incomingSessions,
      repositoryMainBindings,
      repositories,
      activeRepository,
      activeProject,
      activeWorkspaceFocus,
      activeSessionId,
      workspaceMode,
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
        workspaceMode,
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
      workspaceMode,
    ],
  );

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

  const autoEnsureInFlightRef = useRef(false);

  /** 工作区焦点：展示的主会话与 activeSessionId 对齐，确保 live 订阅与磁盘 hydrate 命中同一条。 */
  useEffect(() => {
    if (activeWorkspaceFocus !== "project" || !activeProject || !mainSessionForDataLink) {
      return;
    }
    if (activeSessionId === mainSessionForDataLink.id) {
      return;
    }
    const current = activeSessionId
      ? incomingSessions.find(
          (session) => session.id === activeSessionId || session.claudeSessionId === activeSessionId,
        ) ?? null
      : null;
    if (
      current &&
      sessionMatchesProjectWorkspaceFocus(current, {
        workspaceMode,
        project: activeProject,
        repositories: repositories ?? [],
      })
    ) {
      return;
    }
    onSwitchSession(mainSessionForDataLink.id);
  }, [
    activeProject,
    activeSessionId,
    activeWorkspaceFocus,
    incomingSessions,
    mainSessionForDataLink,
    onSwitchSession,
    repositories,
    workspaceMode,
  ]);

  /** 打开仓库/项目时恢复已有主会话；无可用会话时自动新建。 */
  useEffect(() => {
    if (activeSession) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || autoEnsureInFlightRef.current) return;

      const finishAutoEnsure = () => {
        autoEnsureInFlightRef.current = false;
      };
      const beginAutoEnsure = () => {
        autoEnsureInFlightRef.current = true;
      };

      if (activeWorkspaceFocus === "project" && activeProject) {
        if (mainSessionForDataLink) {
          onSwitchSession(mainSessionForDataLink.id);
          return;
        }
        if (onEnsureProjectSession) {
          beginAutoEnsure();
          void Promise.resolve(onEnsureProjectSession(activeProject)).finally(finishAutoEnsure);
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
        return;
      }

      if (onEnsureRepositorySession) {
        beginAutoEnsure();
        void Promise.resolve(onEnsureRepositorySession(activeRepository)).finally(finishAutoEnsure);
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
    onEnsureProjectSession,
    onEnsureRepositorySession,
    onSwitchSession,
    repositories,
    repositoryMainBindings,
    sessions,
  ]);

  const terminalCenter = useTerminalCenterPanelState();

  const resolveTerminalRepositoryForPane = useCallback(
    (paneIndex: number) => {
      if (paneIndex <= 0) return chatContextRepository;
      const slot = extraPanes[paneIndex - 1];
      if (!slot) return chatContextRepository;
      const repoList = repositories ?? [];
      if (slot.repositoryId != null) {
        return repoList.find((repo) => repo.id === slot.repositoryId) ?? chatContextRepository;
      }
      if (slot.sessionId) {
        const paneSession =
          sessionById.get(slot.sessionId) ?? getClaudeSessionSnapshot(slot.sessionId);
        if (paneSession) {
          return (
            resolveRepositoryForSession({
              session: paneSession,
              repositories: repoList,
              bindings: repositoryMainBindings,
              sessions: incomingSessions,
            }) ?? chatContextRepository
          );
        }
      }
      return chatContextRepository;
    },
    [
      chatContextRepository,
      extraPanes,
      incomingSessions,
      repositories,
      repositoryMainBindings,
      sessionById,
    ],
  );

  const terminalPanelByPane = useMemo(() => {
    const map = new Map<number, React.ReactNode>();
    if (!onToggleTerminal) return map;
    for (const paneIndex of terminalCenter.mountedPaneIndexes) {
      const repo = resolveTerminalRepositoryForPane(paneIndex);
      if (!repo) continue;
      const collapsed = !terminalCenter.visiblePaneIndexes.includes(paneIndex);
      map.set(
        paneIndex,
        <Suspense
          key={`terminal-pane-${paneIndex}`}
          fallback={
            collapsed ? null : (
              <div
                className="app-claude-sessions-terminal-lazy-fallback"
                role="status"
                aria-label="终端加载中"
              >
                <Spin size="small" />
              </div>
            )
          }
        >
          <TerminalPanelLazy
            workspaceId={`pane-${paneIndex}`}
            repositoryPath={repo.path}
            repositoryName={repo.name}
            branch={repo.branch}
            dirty={false}
            collapsed={collapsed}
            layout="center"
            onCollapse={() => collapseTerminalCenterPanelOnPane(paneIndex)}
            onClose={() => closeTerminalCenterPanelOnPane(paneIndex)}
          />
        </Suspense>,
      );
    }
    return map;
  }, [
    onToggleTerminal,
    resolveTerminalRepositoryForPane,
    terminalCenter.mountedPaneIndexes,
    terminalCenter.visiblePaneIndexes,
  ]);

  const resolveCenterPanel = useCallback(
    (incoming: ReactNode | undefined, paneIndex: number): ReactNode | undefined => {
      // 备忘录优先占 pane 0；sentinel 占位时替换为真实终端；其余（如文件编辑器）原样保留，
      // 终端与文件编辑器各自在独立 slot（panelBelowMessages / panelBelowTerminal）中并存，
      // 由 centerView 互斥显隐——避免终端打开时把文件 tab 内容挤掉。
      if (incoming === WORKSPACE_MEMO_PANEL_NODE) return incoming;
      if (incoming === TERMINAL_CENTER_SLOT_SENTINEL) {
        return terminalPanelByPane.get(paneIndex) ?? undefined;
      }
      return incoming;
    },
    [terminalPanelByPane],
  );

  const effectivePanelBelowMessages = resolveCenterPanel(panelBelowMessages, 0);
  const effectivePanelBelowTerminal = resolveCenterPanel(
    resolvePaneAuxLayout?.(0)?.panelBelowTerminal,
    0,
  );

  const resolvePaneAuxLayoutWithTerminal = useCallback<ResolvePaneAuxLayout>(
    (paneIndex) => {
      const base: PaneAuxLayout = resolvePaneAuxLayout
        ? resolvePaneAuxLayout(paneIndex)
        : {
            panelBelowMessages: paneIndex === 0 ? panelBelowMessages : undefined,
            hideMessages,
            hideSessionTools,
          };
      return {
        ...base,
        panelBelowMessages: resolveCenterPanel(base.panelBelowMessages, paneIndex),
        panelBelowTerminal: resolveCenterPanel(base.panelBelowTerminal, paneIndex),
      };
    },
    [
      hideMessages,
      hideSessionTools,
      panelBelowMessages,
      resolveCenterPanel,
      resolvePaneAuxLayout,
    ],
  );

  /**
   * ChatHost / MultiPaneGrid 的 memo 会跳过函数 prop（`resolvePaneAuxLayout`）。
   * 文件编辑器用 `centerAuxPanelsNodeByPaneVersion` 驱动重渲；终端开/关必须同样
   * bump 一个可比较的 number，否则各屏收不到最新 panelBelowMessages。
   */
  const terminalCenterLayoutVersion = terminalCenter.revision & 0xff;
  const centerAuxLayoutVersionForHost =
    ((centerAuxPanelsNodeByPaneVersion ?? 0) << 8) | terminalCenterLayoutVersion;

  return (
    <div className="app-claude-sessions">
      <div className="app-claude-sessions__conversation-column">
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
          onDispatchSessionFeedbackLoop={onDispatchSessionFeedbackLoop}
          getClaudeSessions={() => sessions}
          onToggleSidebar={onToggleSidebar}
          onToggleTerminal={onToggleTerminal}
          onSearch={onSearch}
          collapsed={collapsed}
          terminalCollapsed={terminalCollapsed}
          terminalPanelMounted={terminalPanelMounted}
          onAutoFixRunError={(prompt) => onAutoFixRunErrorFromProps?.(prompt)}
          paneCount={paneCount}
          paneChangeInFlight={paneChangeInFlight}
          onChangePaneCount={onChangePaneCount}
        />
      )}

      {chatSurfaceReady ? (
        <ClaudeSessionsChatHost
          incomingSessions={incomingSessions}
          sessions={sessions}
          activeSession={activeSession ?? null}
          activeSessionId={activeSessionId}
          activeRepository={activeRepository}
          repositories={repositories}
          activeRepositoryId={activeRepositoryId}
          workspaceMode={workspaceMode}
          activeProject={activeProject}
          projects={projects}
          activeWorkspaceFocus={activeWorkspaceFocus}
          onSelectRepository={onSelectRepository}
          onUpdateSessionModel={onUpdateSessionModel}
          onUpdateSessionConnectionKind={onUpdateSessionConnectionKind}
          onUpdateSessionUltracode={onUpdateSessionUltracode}
          onUpdateRepositoryExecutionEngine={onUpdateRepositoryExecutionEngine}
          onUpdateEmployeeExecutionEngine={onUpdateEmployeeExecutionEngine}
          codexAvailable={codexAvailable}
          cursorAvailable={cursorAvailable}
          geminiAvailable={geminiAvailable}
          opencodeAvailable={opencodeAvailable}
          qoderAvailable={qoderAvailable}
          onOpenExecutionEnvironment={onOpenExecutionEnvironment}
          onExecuteSession={onExecuteSession}
          onResumeSessionFromMonitorDrawer={onResumeSessionFromMonitorDrawer}
          onPrepareSessionForMonitorDrawer={onPrepareSessionForMonitorDrawer}
          onDispatchExecutionEnvironment={onDispatchExecutionEnvironment}
          onSendMessage={onSendMessage}
          onCancelSession={onCancelSession}
          onSwitchSession={onSwitchSession}
          onNewSession={onNewSession}
          onNewProjectSession={onNewProjectSession}
          onRespondToQuestion={onRespondToQuestion}
          onDismissQuestion={onDismissQuestion}
          onRespondToPermission={onRespondToPermission}
          onToggleTodo={onToggleTodo}
          onRestoreTodosFromTranscript={onRestoreTodosFromTranscript}
          onRestorePendingPermissionFromTranscript={onRestorePendingPermissionFromTranscript}
          onClearFollowups={onClearFollowups}
          onClearRevertItems={onClearRevertItems}
          onSendFollowup={onSendFollowup}
          onRestoreRevert={onRestoreRevert}
          paneCount={paneCount}
          extraPanes={extraPanes}
          primaryPaneRuntimeOverride={primaryPaneRuntimeOverride}
          onUpdatePaneRuntimeOverride={onUpdatePaneRuntimeOverride}
          onPaneRepositorySelect={onPaneRepositorySelect}
          onPaneProjectNewSession={onPaneProjectNewSession}
          onNewPaneSession={onNewPaneSession}
          onOpenWorkflowConfig={onOpenWorkflowConfig}
          onOpenBuiltinAssistant={onOpenBuiltinAssistant}
          onActivateAssistant={onActivateAssistant}
          onOpenAssistantsHub={onOpenAssistantsHub}
          onOpenRepositoryScheduledTasks={onOpenRepositoryScheduledTasks}
          employees={employees}
          mentionEmployees={mentionEmployees}
          composerProjectRoleTagOptions={composerProjectRoleTagOptions}
          composerProjectRepositoryMentionOptions={composerProjectRepositoryMentionOptions}
          composerHideEmployeesInAtMode={composerHideEmployeesInAtMode}
          workflowTasks={workflowTasks}
          taskPendingEmployeesByTaskId={taskPendingEmployeesByTaskId}
          workflowTemplates={workflowTemplates}
          workflowGraphsByWorkflowId={workflowGraphsByWorkflowId}
          workflowGraphStatusByWorkflowId={workflowGraphStatusByWorkflowId}
          onOpenTaskDetail={onOpenTaskDetail}
          panelBelowMessages={effectivePanelBelowMessages}
          panelBelowTerminal={effectivePanelBelowTerminal}
          centerView={centerView}
          hideMessages={hideMessages}
          hideSessionTools={hideSessionTools}
          resolvePaneAuxLayout={resolvePaneAuxLayoutWithTerminal}
          centerAuxPanelsNodeByPaneVersion={centerAuxLayoutVersionForHost}
          resolveTaskListOmcInvokeConcurrency={resolveTaskListOmcInvokeConcurrency}
          repositoryMainBindings={repositoryMainBindings}
          onAppendSystemMessage={onAppendSystemMessage}
          onAppendUserMessage={onAppendUserMessage}
          onNotifyOmcEmployeeDirectBatchTaskDone={onNotifyOmcEmployeeDirectBatchTaskDone}
          onPrepareFreshOmcEmployeeWorkerForDirectBatch={onPrepareFreshOmcEmployeeWorkerForDirectBatch}
          onRefreshHistorySessions={onRefreshHistorySessions}
          onDeleteHistorySession={onDeleteHistorySession}
          onOpenHistorySessionInInspector={onOpenHistorySessionInInspector}
          onRestoreHistorySessionAsMain={onRestoreHistorySessionAsMain}
          omcBatchPipelineActive={omcBatchPipelineActive}
          onReloadFullDiskTranscript={onReloadFullDiskTranscript}
          onLoadMoreTranscriptFromDisk={onLoadMoreTranscriptFromDisk}
          onCompactSessionHistory={onCompactSessionHistory}
          onStopSessionConversationTask={onStopSessionConversationTask}
          chatContextRepository={chatContextRepository}
          paneRepoTreeData={paneRepoTreeData}
          projectsById={projectsById}
          mainSessionForDataLink={mainSessionForDataLink}
          paneTopbarShared={paneTopbarShared}
        />
      ) : null}
      </div>

      {/* 收起时保留挂载以维持 PTY；打开时改由 panelBelowMessages（与文件同一中栏区域）承载。
          --hidden/--collapsed 必须 display:none，否则会在会话列底部露出 dock 高度的终端条。 */}
      {Array.from(terminalPanelByPane.entries())
        .filter(([paneIndex]) => !terminalCenter.visiblePaneIndexes.includes(paneIndex))
        .map(([paneIndex, node]) => (
          <div
            key={`terminal-keepalive-${paneIndex}`}
            className="app-claude-sessions-terminal-host app-claude-sessions-terminal-host--collapsed app-claude-sessions-terminal-host--hidden"
            aria-hidden
          >
            {node}
          </div>
        ))}
    </div>
  );
}

export const ClaudeSessions = memo(ClaudeSessionsShell, claudeSessionsShellPropsEqual);
