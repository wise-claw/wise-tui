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
import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  getClaudeSessionsSnapshot,
  useClaudeSessionsStructureKey,
} from "../../stores/claudeSessionsLiveStore";
import { ClaudeSessionsChatHost } from "./ClaudeSessionsChatHost";
import { Topbar } from "./Topbar";
export { Topbar, type TopbarProps } from "./Topbar";
import { pickSessionForRepositorySidebarSelect } from "../../utils/claudeSessionSelection";
import { filterSessionsForWorkspace, sessionMatchesProjectWorkspaceFocus } from "../../utils/projectSessionPanelFilter";
import {
  resolveBoundMainSessionId,
  resolveMainOwnerAgentNameForRepositoryPath,
} from "../../utils/repositoryMainSessionBinding";
import {
  isChatSurfaceReady,
  resolveChatContextRepository,
  resolveClaudePanelActiveSession,
  resolveClaudeWorkspaceMainSession,
} from "../../utils/workspaceSelectionState";
import { loadSessionOwnerHints } from "../../utils/sessionOwnerHints";
import type { ResolvePaneAuxLayout } from "./paneAuxLayout";
import type { WorkspaceMode, WorkspaceFocus } from "../../utils/workspaceMode";
import { type PaneCount, type PaneSlot } from "../../constants/mainLayoutWidths";
import type { PaneRepoTreeNode } from "./ClaudeMultiPaneGrid";
import { prefetchModule } from "../../utils/prefetchModule";
import { prefetchNewSessionSurface } from "./prefetchNewSessionSurface";
import "./index.css";

const TerminalPanelLazy = lazy(() =>
  import("../TerminalPanel").then((module) => ({ default: module.TerminalPanel })),
);

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
  geminiAvailable?: boolean;
  opencodeAvailable?: boolean;
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
  onCollapseTerminal?: () => void;
  onCloseTerminalPanel?: () => void;
  onSearch?: () => void;
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
  /** 多屏时按窗格解析文件等中栏辅助面板布局。 */
  resolvePaneAuxLayout?: ResolvePaneAuxLayout;
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
  onUpdateRepositoryExecutionEngine,
  onUpdateEmployeeExecutionEngine,
  codexAvailable = true,
  cursorAvailable = true,
  geminiAvailable = false,
  opencodeAvailable = false,
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
  onCollapseTerminal,
  onCloseTerminalPanel,
  onSearch,
  collapsed,
  rightCollapsed,
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
  hideMessages = false,
  hideSessionTools = false,
  resolvePaneAuxLayout,
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
}: Props) {
  const structureKey = useClaudeSessionsStructureKey();
  const [terminalFullscreen, setTerminalFullscreen] = useState(false);
  const incomingSessions = useMemo(() => getClaudeSessionsSnapshot(), [structureKey]);

  useEffect(() => {
    if (terminalCollapsed) {
      setTerminalFullscreen(false);
    }
  }, [terminalCollapsed]);

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
    if (paneCount > 1) {
      prefetchModule(() => import("./ClaudeMultiPaneGrid"), "ClaudeMultiPaneGrid");
    }
  }, [chatSurfaceReady, paneCount]);

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

  return (
    <div
      className={
        terminalFullscreen
          ? "app-claude-sessions app-claude-sessions--terminal-fullscreen"
          : "app-claude-sessions"
      }
    >
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
          onToggleRightPanel={onToggleRightPanel}
          rightPanelDefaultCollapsed={rightPanelDefaultCollapsed}
          onSetRightPanelDefaultCollapsed={onSetRightPanelDefaultCollapsed}
          onToggleTerminal={onToggleTerminal}
          onSearch={onSearch}
          collapsed={collapsed}
          rightCollapsed={rightCollapsed}
          terminalCollapsed={terminalCollapsed}
          terminalPanelMounted={terminalPanelMounted}
          onAutoFixRunError={(prompt) => onAutoFixRunErrorFromProps?.(prompt)}
          paneCount={paneCount}
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
          onUpdateRepositoryExecutionEngine={onUpdateRepositoryExecutionEngine}
          onUpdateEmployeeExecutionEngine={onUpdateEmployeeExecutionEngine}
          codexAvailable={codexAvailable}
          cursorAvailable={cursorAvailable}
          geminiAvailable={geminiAvailable}
          opencodeAvailable={opencodeAvailable}
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
          onClearTodos={onClearTodos}
          onToggleTodo={onToggleTodo}
          onRestoreTodosFromTranscript={onRestoreTodosFromTranscript}
          onRestorePendingPermissionFromTranscript={onRestorePendingPermissionFromTranscript}
          onClearFollowups={onClearFollowups}
          onClearRevertItems={onClearRevertItems}
          onSendFollowup={onSendFollowup}
          onRestoreRevert={onRestoreRevert}
          paneCount={paneCount}
          extraPanes={extraPanes}
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
          panelBelowMessages={panelBelowMessages}
          hideMessages={hideMessages}
          hideSessionTools={hideSessionTools}
          resolvePaneAuxLayout={resolvePaneAuxLayout}
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
        />
      ) : null}
      </div>

      {/* Terminal Panel：按需加载 ghostty-web；收起时仅隐藏 UI，保持 PTY 会话 */}
      {terminalPanelMounted && chatContextRepository && onToggleTerminal && (
        <div
          className={
            terminalCollapsed
              ? "app-claude-sessions-terminal-host app-claude-sessions-terminal-host--collapsed"
              : "app-claude-sessions-terminal-host"
          }
          aria-hidden={terminalCollapsed}
        >
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
              collapsed={terminalCollapsed}
              onCollapse={onCollapseTerminal ?? onToggleTerminal}
              onClose={onCloseTerminalPanel ?? onToggleTerminal}
              fullscreen={terminalFullscreen}
              onToggleFullscreen={() => setTerminalFullscreen((value) => !value)}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}

function claudeSessionsShellPropsEqual(prev: Props, next: Props): boolean {
  for (const key of Object.keys(prev) as (keyof Props)[]) {
    if (key === "sessions") continue;
    if (!Object.is(prev[key], next[key])) return false;
  }
  return true;
}

export const ClaudeSessions = memo(ClaudeSessionsShell, claudeSessionsShellPropsEqual);
