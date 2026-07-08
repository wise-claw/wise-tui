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
import { Button, Empty, message, TreeSelect } from "antd";
import { LoadingOutlined } from "@ant-design/icons";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { ClaudeSessionConnectionKind } from "../../constants/claudeConnection";
import type { SessionExecutionEngine } from "../../types";
import type { RoleTagOption, RepositoryMentionOption } from "../../utils/projectRoleTagOptions";
import { MAIN_LAYOUT_MULTI_PANE_MIN_WIDTH_PX, paneGridDimensions, type PaneCount, type PaneSlot, paneSlotRuntimeOverride } from "../../constants/mainLayoutWidths";
import { markPaneActive, resetActivePaneIndex } from "../../stores/activePaneIndexStore";
import { useInViewActive } from "../../hooks/useInView";
import { useDockSlice } from "../../hooks/useDockSlice";
import { isProjectRootSessionDisplayName } from "../../utils/repositoryMainSessionBinding";
import {
  MULTI_PANE_LAZY_UNMOUNT_MS,
  resolveCompanionMessageListWindow,
  resolveCompanionPaneRenderDecision,
  shouldLazyMountMultiPaneExtraCells,
} from "../../utils/multiPanePerformance";
import {
  clampTwoPaneSplitRatio,
  DEFAULT_TWO_PANE_SPLIT_RATIO,
  formatTwoPaneSplitGridTemplateColumnsPx,
  resolveTwoPaneLeftWidthPx,
} from "../../utils/twoPaneSplitRatio";
import { ClaudeSessionChatWithDock } from "./ClaudeSessionChatWithDock";
import { MultiPaneOffscreenRunningPane } from "./MultiPaneOffscreenRunningPane";
import { runPaneCreateTask } from "./paneCreateLoading";
import type { RefreshHistorySessionsScope } from "./ClaudeChat";
import type { PaneAuxLayout, ResolvePaneAuxLayout } from "./paneAuxLayout";
import { Topbar, type PaneTopbarSharedProps } from "./Topbar";
import { CenterViewControlContext, useCenterView } from "./claudeChatHelpers";

const TWO_PANE_MIN_WIDTH_PX = MAIN_LAYOUT_MULTI_PANE_MIN_WIDTH_PX;

interface PaneRepoTreeNode {
  title: string;
  value: string;
  selectable: boolean;
  nodeType: "project" | "repo" | "group";
  projectId?: string;
  projectRootPath?: string;
  repositoryId?: number;
  children?: PaneRepoTreeNode[];
}

/** 为 extra pane 仓库解析其所属 project：优先与主会话一致的 preferred project，
 *  否则取第一个包含该仓库的 project。使顶栏 project scope 快捷操作在 extra pane
 *  也能正确加载（与 primary pane 行为一致）。 */
function resolveProjectForRepository(
  projects: ReadonlyArray<ProjectItem>,
  repositoryId: number | null | undefined,
  preferred: ProjectItem | null | undefined,
): ProjectItem | null {
  if (repositoryId == null) return preferred ?? null;
  if (preferred && preferred.repositoryIds.includes(repositoryId)) {
    return preferred;
  }
  for (const project of projects) {
    if (project.repositoryIds.includes(repositoryId)) {
      return project;
    }
  }
  return null;
}

function IconNewSession() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

interface SessionEmptyStateProps {
  title: string;
  hint: string;
  primaryAction?: {
    label: string;
    onClick: () => void;
    loading?: boolean;
    disabled?: boolean;
  };
  extraContent?: ReactNode;
}

function SessionEmptyState({ title, hint, primaryAction, extraContent }: SessionEmptyStateProps) {
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
        {primaryAction ? (
          <div className="app-claude-session-empty__actions">
            <Button
              type="primary"
              onClick={primaryAction.onClick}
              loading={primaryAction.loading}
              disabled={primaryAction.disabled}
            >
              {primaryAction.label}
            </Button>
          </div>
        ) : null}
      </Empty>
    </div>
  );
}

/** 多屏各窗格共享的 ClaudeChat  props（不含 session 绑定字段）。 */
export interface MultiPaneSharedChatProps {
  sessions: ClaudeSession[];
  allSessionsForHistory: ClaudeSession[];
  repositories?: Repository[];
  activeProject?: ProjectItem | null;
  activeWorkspaceFocus?: import("../../utils/workspaceMode").WorkspaceFocus;
  activeRepositoryId?: number | null;
  workspaceMode?: import("../../utils/workspaceMode").WorkspaceMode;
  onSwitchSession: (sessionId: string, options?: { collapseSessionNotificationPanel?: boolean }) => void;
  onSend: (prompt: string) => void;
  onExecute: (
    sessionId: string,
    prompt: string,
    dispatchTarget?: Pick<PendingExecutionTask, "targetType" | "targetEmployeeName" | "targetWorkflowId" | "targetWorkflowName">,
    executeOptions?: ClaudeComposerExecuteBubbleOptions,
  ) => boolean | void | Promise<boolean | void>;
  onDispatchExecutionEnvironment?: (input: {
    prompt: string;
    userBubblePrompt?: string;
  }) => void | Promise<void>;
  onUpdateSessionModel: (sessionId: string, model: string) => void;
  onUpdateSessionConnectionKind: (sessionId: string, kind: ClaudeSessionConnectionKind) => void | Promise<void>;
  onUpdateRepositoryExecutionEngine?: (
    repositoryId: number,
    engine: SessionExecutionEngine,
  ) => void | Promise<void>;
  onUpdateEmployeeExecutionEngine?: (
    employeeId: string,
    engine: SessionExecutionEngine,
  ) => void | Promise<void>;
  codexAvailable: boolean;
  cursorAvailable: boolean;
  geminiAvailable: boolean;
  opencodeAvailable: boolean;
  onOpenExecutionEnvironment?: () => void;
  onCancelSession: (sessionId: string, opts?: { retractLastUserTurn?: boolean }) => void;
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
  onOpenWorkflowConfig?: () => void;
  onOpenBuiltinAssistant?: (assistantId: string) => void;
  onActivateAssistant?: (assistant: import("../../types/assistant").AssistantEntry) => void | Promise<void>;
  onOpenAssistantsHub?: () => void;
  onOpenRepositoryScheduledTasks?: () => void;
  employees: EmployeeItem[];
  mentionEmployees: EmployeeItem[];
  composerProjectRoleTagOptions: ReadonlyArray<RoleTagOption>;
  composerProjectRepositoryMentionOptions: ReadonlyArray<RepositoryMentionOption>;
  composerHideEmployeesInAtMode: boolean;
  taskPendingEmployeesByTaskId: Record<string, Array<{ employeeId: string; name: string }>>;
  workflowTemplates: WorkflowTemplateItem[];
  workflowGraphsByWorkflowId: Record<string, WorkflowGraph>;
  workflowGraphStatusByWorkflowId: Record<string, string>;
  onOpenTaskDetail?: (taskId: string) => void;
  hideMessages: boolean;
  hideSessionTools: boolean;
  resolveTaskListOmcInvokeConcurrency?: (session: ClaudeSession) => {
    concurrencyScopeKey: string;
    concurrencyLimit: number;
  } | null;
  repositoryMainBindings: Record<string, string>;
  onAppendSystemMessage?: (sessionId: string, text: string) => void;
  onAppendUserMessage?: (sessionId: string, text: string) => void;
  onNotifyOmcEmployeeDirectBatchTaskDone?: (input: {
    repositoryPath: string;
    repositoryDisplayName: string;
    employeeMessage: string;
  }) => void;
  onPrepareFreshOmcEmployeeWorkerForDirectBatch?: (input: {
    repositoryPath: string;
    repositoryDisplayName: string;
  }) => void | Promise<void>;
  onRefreshHistorySessions?: (scope: RefreshHistorySessionsScope) => void | Promise<void>;
  onDeleteHistorySession?: (sessionId: string) => Promise<void>;
  onOpenHistorySessionInInspector?: (sessionId: string) => void;
  onRestoreHistorySessionAsMain?: (sessionId: string) => void | Promise<void>;
  omcBatchPipelineActive: boolean;
  onReloadFullDiskTranscript?: (sessionId: string) => void | Promise<void>;
  onLoadMoreTranscriptFromDisk?: (sessionId: string) => void | Promise<void>;
  onCompactSessionHistory?: (sessionId: string) => void | Promise<void>;
  onStopSessionConversationTask?: (item: SessionConversationTaskItem) => void;
  paneCount: PaneCount;
  primaryPaneRuntimeOverride?: import("../../types/paneRuntimeOverride").PaneRuntimeOverride | null;
  onUpdatePaneRuntimeOverride?: (
    paneIndex: number,
    patch: Partial<import("../../types/paneRuntimeOverride").PaneRuntimeOverride>,
  ) => void;
  /** 多屏下每个 pane 顶栏共享的回调与状态（窗口级 + 会话级 + per-pane 搜索入口）。
   *  primary pane 展开后补全主会话仓库；extra pane 展开后将窗口级回调置 undefined。
   *  可选：非多屏路径（如仓库侧会话面板复用本类型）不提供，ClaudeMultiPaneGrid 渲染时判空。 */
  paneTopbarShared?: PaneTopbarSharedProps;
}

interface MultiPanePrimaryPaneProps {
  session: ClaudeSession;
  activeSessionId: string;
  activeRepository: Repository;
  workflowTasks: WorkflowTaskItem[];
  shared: MultiPaneSharedChatProps;
  initialNotificationPanelCollapsed: boolean;
  onCreateNewSession: () => void;
  paneAuxLayout: PaneAuxLayout;
}

const MultiPanePrimaryPane = memo(function MultiPanePrimaryPane({
  session,
  activeSessionId,
  activeRepository,
  workflowTasks,
  shared,
  initialNotificationPanelCollapsed,
  onCreateNewSession,
  paneAuxLayout,
}: MultiPanePrimaryPaneProps) {
  const sessionId = session.id;
  const onSessionModelChange = useCallback(
    (model: string) => shared.onUpdateSessionModel(sessionId, model),
    [shared, sessionId],
  );
  const onSessionConnectionKindChange = useCallback(
    (kind: ClaudeSessionConnectionKind) => void shared.onUpdateSessionConnectionKind(sessionId, kind),
    [shared, sessionId],
  );
  const onCancel = useCallback(
    (opts?: { retractLastUserTurn?: boolean }) => shared.onCancelSession(sessionId, opts),
    [shared, sessionId],
  );
  const onRespondToPermission = useCallback(
    (response: "allow_once" | "allow_always" | "deny") => shared.onRespondToPermission(sessionId, response),
    [shared, sessionId],
  );

  const { centerView, setCenterView, visible: centerSwitcherVisible } = useCenterView(
    paneAuxLayout.panelBelowMessages,
    paneAuxLayout.hideMessages,
  );

  return (
    <div
      className="app-claude-sessions__pane"
      onMouseDownCapture={() => markPaneActive(0)}
    >
      {shared.paneTopbarShared ? (
        <Topbar
          {...shared.paneTopbarShared}
          activeRepository={activeRepository}
          activeSessionRepositoryPath={session.repositoryPath?.trim() || activeRepository.path}
          repositories={shared.repositories}
          activeProject={shared.activeProject ?? null}
          activeWorkspaceFocus={shared.activeWorkspaceFocus ?? "repository"}
          mainSessionForDataLink={session}
          onSearch={() => shared.paneTopbarShared?.onSearchForRepository?.(activeRepository.path)}
          centerView={centerView}
          onCenterViewChange={setCenterView}
          centerSwitcherVisible={centerSwitcherVisible}
        />
      ) : null}
      <CenterViewControlContext.Provider value={setCenterView}>
      <ClaudeSessionChatWithDock
        key={sessionId}
        session={session}
        activeSessionId={activeSessionId}
        sessions={shared.sessions}
        allSessionsForHistory={shared.allSessionsForHistory}
        repositories={shared.repositories}
        activeRepository={activeRepository}
        activeProject={shared.activeProject}
        activeWorkspaceFocus={shared.activeWorkspaceFocus}
        activeRepositoryId={shared.activeRepositoryId}
        workspaceMode={shared.workspaceMode}
        initialNotificationPanelCollapsed={initialNotificationPanelCollapsed}
        onSwitchSession={shared.onSwitchSession}
        onCreateNewSession={onCreateNewSession}
        onOpenBuiltinAssistant={shared.onOpenBuiltinAssistant}
        onActivateAssistant={shared.onActivateAssistant}
        onOpenAssistantsHub={shared.onOpenAssistantsHub}
        onOpenRepositoryScheduledTasks={shared.onOpenRepositoryScheduledTasks}
        onSend={shared.onSend}
        onExecute={shared.onExecute}
        onDispatchExecutionEnvironment={shared.onDispatchExecutionEnvironment}
        onSessionModelChange={onSessionModelChange}
        onSessionConnectionKindChange={onSessionConnectionKindChange}
        onUpdateRepositoryExecutionEngine={shared.onUpdateRepositoryExecutionEngine}
        onUpdateEmployeeExecutionEngine={shared.onUpdateEmployeeExecutionEngine}
        codexAvailable={shared.codexAvailable}
        cursorAvailable={shared.cursorAvailable}
        geminiAvailable={shared.geminiAvailable}
        opencodeAvailable={shared.opencodeAvailable}
        onOpenExecutionEnvironment={shared.onOpenExecutionEnvironment}
        onCancel={onCancel}
        onCancelSessionById={shared.onCancelSession}
        respondQuestionAt={shared.onRespondToQuestion}
        dismissQuestionAt={shared.onDismissQuestion}
        onRespondToPermission={onRespondToPermission}
        onToggleTodo={(todoId) => shared.onToggleTodo(sessionId, todoId)}
        onRestoreTodosFromTranscript={() => shared.onRestoreTodosFromTranscript(sessionId)}
        onRestorePendingPermissionFromTranscript={() =>
          shared.onRestorePendingPermissionFromTranscript(sessionId)
        }
        onClearFollowups={() => shared.onClearFollowups(sessionId)}
        onClearRevertItems={() => shared.onClearRevertItems(sessionId)}
        onSendFollowup={(id) => shared.onSendFollowup(sessionId, id)}
        onRestoreRevert={(id) => shared.onRestoreRevert(sessionId, id)}
        onRespondToPermissionAt={shared.onRespondToPermission}
        onToggleTodoAt={shared.onToggleTodo}
        onClearFollowupsAt={shared.onClearFollowups}
        onClearRevertItemsAt={shared.onClearRevertItems}
        onSendFollowupAt={shared.onSendFollowup}
        onRestoreRevertAt={shared.onRestoreRevert}
        onOpenWorkflowConfig={shared.onOpenWorkflowConfig}
        employees={shared.employees}
        mentionEmployees={shared.mentionEmployees}
        projectRoleTagOptions={shared.composerProjectRoleTagOptions}
        projectRepositoryMentionOptions={shared.composerProjectRepositoryMentionOptions}
        hideEmployeesInAtMode={shared.composerHideEmployeesInAtMode}
        workflowTasks={workflowTasks}
        taskPendingEmployeesByTaskId={shared.taskPendingEmployeesByTaskId}
        workflowTemplates={shared.workflowTemplates}
        workflowGraphsByWorkflowId={shared.workflowGraphsByWorkflowId}
        workflowGraphStatusByWorkflowId={shared.workflowGraphStatusByWorkflowId}
            onOpenTaskDetail={shared.onOpenTaskDetail}
            panelBelowMessages={paneAuxLayout.panelBelowMessages}
            hideMessages={paneAuxLayout.hideMessages}
            hideSessionTools={paneAuxLayout.hideSessionTools}
            centerView={centerView}
            enableSessionNotificationFeed={false}
        resolveTaskListOmcInvokeConcurrency={shared.resolveTaskListOmcInvokeConcurrency}
        repositoryMainBindings={shared.repositoryMainBindings}
        onAppendSystemMessage={shared.onAppendSystemMessage}
        onAppendUserMessage={shared.onAppendUserMessage}
        onNotifyOmcEmployeeDirectBatchTaskDone={shared.onNotifyOmcEmployeeDirectBatchTaskDone}
        onPrepareFreshOmcEmployeeWorkerForDirectBatch={shared.onPrepareFreshOmcEmployeeWorkerForDirectBatch}
        onRefreshHistorySessions={shared.onRefreshHistorySessions}
        onDeleteHistorySession={shared.onDeleteHistorySession}
        onOpenHistorySessionInInspector={shared.onOpenHistorySessionInInspector}
        onStopSessionConversationTask={shared.onStopSessionConversationTask}
        onRestoreHistorySessionAsMain={shared.onRestoreHistorySessionAsMain}
        omcBatchPipelineActive={shared.omcBatchPipelineActive}
        onReloadFullDiskTranscript={shared.onReloadFullDiskTranscript}
        onLoadMoreTranscriptFromDisk={shared.onLoadMoreTranscriptFromDisk}
        onCompactSessionHistory={shared.onCompactSessionHistory}
        paneIndex={0}
        paneCount={shared.paneCount}
        paneRuntimeOverride={shared.primaryPaneRuntimeOverride}
        onUpdatePaneRuntimeOverride={shared.onUpdatePaneRuntimeOverride}
      />
      </CenterViewControlContext.Provider>
    </div>
  );
}, (prev, next) =>
  prev.session === next.session &&
  prev.activeRepository.id === next.activeRepository.id &&
  prev.workflowTasks === next.workflowTasks &&
  prev.initialNotificationPanelCollapsed === next.initialNotificationPanelCollapsed &&
  prev.onCreateNewSession === next.onCreateNewSession &&
  prev.paneAuxLayout === next.paneAuxLayout &&
  prev.shared === next.shared,
);

interface MultiPaneExtraPaneCellProps {
  slot: PaneSlot;
  paneIdx: number;
  paneCount: PaneCount;
  activeSessionId: string;
  paneSession: ClaudeSession | null;
  paneRepo: Repository | null;
  activeRepository: Repository;
  workflowTasks: WorkflowTaskItem[];
  shared: MultiPaneSharedChatProps;
  initialNotificationPanelCollapsed: boolean;
  isCreating: boolean;
  pickerOpen: boolean;
  projects: ProjectItem[];
  paneRepoTreeData: PaneRepoTreeNode[];
  projectsById: Map<string, ProjectItem>;
  onCreatePaneSession: (paneIdx: number) => void;
  onPickerOpenChange: (paneIdx: number, open: boolean) => void;
  setCreatingPaneSlots: Dispatch<SetStateAction<Record<number, boolean>>>;
  onPaneRepositorySelect?: (slotIndex: number, repositoryId: number) => void | Promise<void>;
  onPaneProjectNewSession?: (
    slotIndex: number,
    projectId: string,
    projects: ProjectItem[],
    options?: { rootPath?: string | null; projectName?: string | null },
  ) => void | Promise<void>;
  onNewPaneSession?: (slotIndex: number, repository: Repository) => void | Promise<void>;
  paneAuxLayout: PaneAuxLayout;
}

const MultiPaneExtraPaneCell = memo(
  function MultiPaneExtraPaneCell({
    slot,
    paneIdx,
    paneCount,
    activeSessionId,
    paneSession,
    paneRepo,
    activeRepository,
    workflowTasks,
    shared,
    initialNotificationPanelCollapsed,
    isCreating,
    pickerOpen,
    projects,
    paneRepoTreeData,
    projectsById,
    onCreatePaneSession,
    onPickerOpenChange,
    setCreatingPaneSlots,
    onPaneRepositorySelect,
    onPaneProjectNewSession,
    onNewPaneSession,
    paneAuxLayout,
  }: MultiPaneExtraPaneCellProps) {
    const resolvedRepo = paneRepo ?? activeRepository;
    const lazyEnabled = shouldLazyMountMultiPaneExtraCells(paneCount);
    const mustStayMounted =
      paneSession?.status === "running" || paneSession?.status === "connecting";
    const offscreenDock = useDockSlice(lazyEnabled && paneSession ? paneSession.id : null);
    const isActivePane = paneSession?.id === activeSessionId;
    const [paneRef, inView] = useInViewActive(
      "80px",
      lazyEnabled && Boolean(paneSession),
      null,
      lazyEnabled ? { enterDebounceMs: 150, leaveDebounceMs: 2400 } : undefined,
    );
    const wasEverInViewRef = useRef(false);
    if (inView) {
      wasEverInViewRef.current = true;
    }
    const setPaneDivRef = useCallback(
      (node: HTMLDivElement | null) => {
        if (typeof paneRef === "function") {
          paneRef(node);
        }
      },
      [paneRef],
    );
    const [mounted, setMounted] = useState(() => !lazyEnabled);

    useEffect(() => {
      if (!lazyEnabled) {
        setMounted(true);
        return;
      }
      if (inView || mustStayMounted || wasEverInViewRef.current) {
        setMounted(true);
        return;
      }
      const timer = window.setTimeout(() => setMounted(false), MULTI_PANE_LAZY_UNMOUNT_MS);
      return () => window.clearTimeout(timer);
    }, [inView, lazyEnabled, mustStayMounted]);

    // 关键不变量：在屏窗格永远渲染完整 ClaudeChat（消息列表 + 输入框），
    // 仅离屏且运行中的窗格才降级为精简壳 / 推迟重型子树。
    const { useOffscreenRunningShell, deferHeavySubtree } = resolveCompanionPaneRenderDecision({
      paneCount,
      hasSession: Boolean(paneSession),
      isRunning: Boolean(mustStayMounted),
      isActivePane,
      inView,
      mounted,
      hasQuestionRequest: Boolean(offscreenDock.questionRequest),
    });
    const hidePaneMessages = paneAuxLayout.hideMessages || deferHeavySubtree;
    const { centerView, setCenterView, visible: centerSwitcherVisible } = useCenterView(
      paneAuxLayout.panelBelowMessages,
      hidePaneMessages,
    );
    const companionMessageListWindow = useMemo(
      () => resolveCompanionMessageListWindow(paneCount),
      [paneCount],
    );

    // extra pane 顶栏 project scope 快捷操作需要该仓库所属 project；优先与主会话一致
    // 的 shared.activeProject（若该仓为其成员），否则取第一个包含该仓库的 project。
    const paneProject = useMemo(
      () => resolveProjectForRepository(projects, resolvedRepo?.id, shared.activeProject ?? null),
      [projects, resolvedRepo?.id, shared.activeProject],
    );

    const dualPaneRepositoryPicker = useMemo(() => {
      if (!paneSession || !onPaneRepositorySelect || !resolvedRepo) return undefined;
      const sessionPath = (paneSession.repositoryPath ?? "").trim();
      let valueKey = `repo:${resolvedRepo.id}`;
      if (isProjectRootSessionDisplayName(paneSession.repositoryName ?? "")) {
        const byPath = projects.find((project) => (project.rootPath ?? "").trim() === sessionPath);
        if (byPath) valueKey = `project:${byPath.id}`;
        else {
          const byName = projects.find(
            (project) => (paneSession.repositoryName ?? "").trim() === `Project: ${project.name}`,
          );
          if (byName) valueKey = `project:${byName.id}`;
        }
      }
      return {
        repositories: shared.repositories ?? [],
        projects,
        valueKey,
        onSelectRepositoryId: (id: number) => {
          void onPaneRepositorySelect(paneIdx, id);
        },
        onSelectProjectId: onPaneProjectNewSession
          ? (projectId: string) => {
              void onPaneProjectNewSession(paneIdx, projectId, projects);
            }
          : undefined,
      };
    }, [onPaneProjectNewSession, onPaneRepositorySelect, paneIdx, paneSession, projects, resolvedRepo, shared.repositories]);

    if (paneSession) {
      const sessionId = paneSession.id;
      if (useOffscreenRunningShell) {
        return (
          <div
            ref={setPaneDivRef}
            className="app-claude-sessions__pane app-claude-sessions__pane--offscreen-running-host"
            data-pane-session-id={sessionId}
          >
            <MultiPaneOffscreenRunningPane
              session={paneSession}
              permissionRequest={offscreenDock.permissionRequest}
              onCancel={(opts) => shared.onCancelSession(sessionId, opts)}
              onRespondToPermission={(response) => shared.onRespondToPermission(sessionId, response)}
            />
          </div>
        );
      }
      if (lazyEnabled && !mounted) {
        return (
          <div
            ref={setPaneDivRef}
            className="app-claude-sessions__pane app-claude-sessions__pane--lazy-placeholder"
            data-pane-session-id={sessionId}
          >
            <div className="app-claude-sessions__pane-lazy-copy">
              <span className="app-claude-sessions__pane-lazy-title">
                {paneSession.repositoryName?.trim() || resolvedRepo.name || "执行会话"}
              </span>
              <span className="app-claude-sessions__pane-lazy-hint">窗格在视口外，已暂停渲染以节省内存</span>
            </div>
          </div>
        );
      }
      return (
        <div
          ref={lazyEnabled ? setPaneDivRef : undefined}
          className="app-claude-sessions__pane"
          onMouseDownCapture={() => markPaneActive(paneIdx + 1)}
        >
          {shared.paneTopbarShared ? (
            <Topbar
              {...shared.paneTopbarShared}
              // extra pane 不渲染窗口级按钮（侧栏 / 内置终端 / 多屏切换 / RemoteEntry）。
              // 置 undefined 时 Topbar 内 `onXxx && (...)` 判定为假即不渲染。
              onToggleSidebar={undefined}
              onToggleTerminal={undefined}
              onChangePaneCount={undefined}
              onOpenRemoteChannels={undefined}
              activeRepository={resolvedRepo}
              activeSessionRepositoryPath={paneSession.repositoryPath?.trim() || resolvedRepo?.path}
              repositories={shared.repositories}
              activeProject={paneProject}
              activeWorkspaceFocus="repository"
              mainSessionForDataLink={paneSession}
              onSearch={() => shared.paneTopbarShared?.onSearchForRepository?.(resolvedRepo?.path ?? "")}
              centerView={centerView}
              onCenterViewChange={setCenterView}
              centerSwitcherVisible={centerSwitcherVisible}
            />
          ) : null}
          <CenterViewControlContext.Provider value={setCenterView}>
          <ClaudeSessionChatWithDock
            key={sessionId}
            session={paneSession}
            activeSessionId={activeSessionId}
            sessions={shared.sessions}
            allSessionsForHistory={shared.allSessionsForHistory}
            repositories={shared.repositories}
            activeRepository={resolvedRepo}
            activeProject={shared.activeProject}
            activeWorkspaceFocus={shared.activeWorkspaceFocus}
            activeRepositoryId={shared.activeRepositoryId}
            workspaceMode={shared.workspaceMode}
            initialNotificationPanelCollapsed={initialNotificationPanelCollapsed}
            onSwitchSession={shared.onSwitchSession}
            onCreateNewSession={() => onCreatePaneSession(paneIdx)}
            onOpenBuiltinAssistant={shared.onOpenBuiltinAssistant}
            onActivateAssistant={shared.onActivateAssistant}
            onOpenAssistantsHub={shared.onOpenAssistantsHub}
            onOpenRepositoryScheduledTasks={shared.onOpenRepositoryScheduledTasks}
            onSend={shared.onSend}
            onExecute={shared.onExecute}
            onDispatchExecutionEnvironment={shared.onDispatchExecutionEnvironment}
            onSessionModelChange={(model) => shared.onUpdateSessionModel(sessionId, model)}
            onSessionConnectionKindChange={(kind) => void shared.onUpdateSessionConnectionKind(sessionId, kind)}
            onUpdateRepositoryExecutionEngine={shared.onUpdateRepositoryExecutionEngine}
            onUpdateEmployeeExecutionEngine={shared.onUpdateEmployeeExecutionEngine}
            codexAvailable={shared.codexAvailable}
        cursorAvailable={shared.cursorAvailable}
        geminiAvailable={shared.geminiAvailable}
        opencodeAvailable={shared.opencodeAvailable}
            onOpenExecutionEnvironment={shared.onOpenExecutionEnvironment}
            onCancel={(opts) => shared.onCancelSession(sessionId, opts)}
            onCancelSessionById={shared.onCancelSession}
            respondQuestionAt={shared.onRespondToQuestion}
            dismissQuestionAt={shared.onDismissQuestion}
            onRespondToPermission={(response) => shared.onRespondToPermission(sessionId, response)}
            onToggleTodo={(todoId) => shared.onToggleTodo(sessionId, todoId)}
            onRestoreTodosFromTranscript={() => shared.onRestoreTodosFromTranscript(sessionId)}
            onRestorePendingPermissionFromTranscript={() =>
              shared.onRestorePendingPermissionFromTranscript(sessionId)
            }
            onClearFollowups={() => shared.onClearFollowups(sessionId)}
            onClearRevertItems={() => shared.onClearRevertItems(sessionId)}
            onSendFollowup={(id) => shared.onSendFollowup(sessionId, id)}
            onRestoreRevert={(id) => shared.onRestoreRevert(sessionId, id)}
            onRespondToPermissionAt={shared.onRespondToPermission}
            onToggleTodoAt={shared.onToggleTodo}
            onClearFollowupsAt={shared.onClearFollowups}
            onClearRevertItemsAt={shared.onClearRevertItems}
            onSendFollowupAt={shared.onSendFollowup}
            onRestoreRevertAt={shared.onRestoreRevert}
            onOpenWorkflowConfig={shared.onOpenWorkflowConfig}
            employees={shared.employees}
            mentionEmployees={shared.mentionEmployees}
            projectRoleTagOptions={shared.composerProjectRoleTagOptions}
            projectRepositoryMentionOptions={shared.composerProjectRepositoryMentionOptions}
            hideEmployeesInAtMode={shared.composerHideEmployeesInAtMode}
            workflowTasks={workflowTasks}
            taskPendingEmployeesByTaskId={shared.taskPendingEmployeesByTaskId}
            workflowTemplates={shared.workflowTemplates}
            workflowGraphsByWorkflowId={shared.workflowGraphsByWorkflowId}
            workflowGraphStatusByWorkflowId={shared.workflowGraphStatusByWorkflowId}
            onOpenTaskDetail={shared.onOpenTaskDetail}
            panelBelowMessages={paneAuxLayout.panelBelowMessages}
            hideMessages={hidePaneMessages}
            hideSessionTools={paneAuxLayout.hideSessionTools}
            centerView={centerView}
            enableSessionNotificationFeed={false}
            resolveTaskListOmcInvokeConcurrency={shared.resolveTaskListOmcInvokeConcurrency}
            repositoryMainBindings={shared.repositoryMainBindings}
            onAppendSystemMessage={shared.onAppendSystemMessage}
            onAppendUserMessage={shared.onAppendUserMessage}
            onNotifyOmcEmployeeDirectBatchTaskDone={shared.onNotifyOmcEmployeeDirectBatchTaskDone}
            onPrepareFreshOmcEmployeeWorkerForDirectBatch={shared.onPrepareFreshOmcEmployeeWorkerForDirectBatch}
            onRefreshHistorySessions={shared.onRefreshHistorySessions}
            onDeleteHistorySession={shared.onDeleteHistorySession}
            onOpenHistorySessionInInspector={shared.onOpenHistorySessionInInspector}
            onStopSessionConversationTask={shared.onStopSessionConversationTask}
            onRestoreHistorySessionAsMain={shared.onRestoreHistorySessionAsMain}
            omcBatchPipelineActive={shared.omcBatchPipelineActive}
            onReloadFullDiskTranscript={shared.onReloadFullDiskTranscript}
            onLoadMoreTranscriptFromDisk={shared.onLoadMoreTranscriptFromDisk}
            onCompactSessionHistory={shared.onCompactSessionHistory}
            dualPaneRepositoryPicker={dualPaneRepositoryPicker}
            deferHeavySubtree={deferHeavySubtree}
            messageListProfile="companion"
            companionMessageListWindow={companionMessageListWindow}
            paneIndex={paneIdx + 1}
            paneCount={paneCount}
            paneRuntimeOverride={paneSlotRuntimeOverride(slot)}
            onUpdatePaneRuntimeOverride={shared.onUpdatePaneRuntimeOverride}
          />
          </CenterViewControlContext.Provider>
        </div>
      );
    }

    if (paneAuxLayout.panelBelowMessages) {
      return (
        <div className="app-claude-sessions__pane app-claude-sessions__pane--file-only">
          {paneAuxLayout.panelBelowMessages}
        </div>
      );
    }

    return (
      <div className="app-claude-sessions__pane">
        <SessionEmptyState
          title="窗格执行会话尚未就绪"
          hint="选择仓库后自动创建隔离会话，或点击下方按钮新建。"
          extraContent={
            (onPaneRepositorySelect || onPaneProjectNewSession) &&
            (paneRepoTreeData.length > 0 || (shared.repositories && shared.repositories.length > 0)) ? (
              <TreeSelect
                className="app-claude-session-empty__repo-select"
                placeholder="选择工作区 / 仓库"
                value={resolvedRepo?.id != null ? `repo:${resolvedRepo.id}` : undefined}
                open={pickerOpen}
                disabled={isCreating}
                treeData={paneRepoTreeData}
                treeLine
                showSearch
                treeNodeFilterProp="title"
                popupMatchSelectWidth={false}
                listHeight={320}
                onOpenChange={(open) => onPickerOpenChange(paneIdx, open)}
                classNames={{ popup: { root: "app-claude-session-empty__repo-select-dropdown" } }}
                treeTitleRender={(node) => {
                  const treeNode = node as unknown as PaneRepoTreeNode;
                  const nodeValue = String(node.value ?? "");
                  const repoIdFromValue = nodeValue.startsWith("repo:") ? Number(nodeValue.slice(5)) : null;
                  const projectIdFromValue = nodeValue.startsWith("project:") ? nodeValue.slice(8) : null;
                  const projectRootPath =
                    projectsById.get((projectIdFromValue ?? "").trim())?.rootPath?.trim() ||
                    treeNode.projectRootPath?.trim() ||
                    null;
                  const projectName = String(treeNode.title ?? "").trim() || null;
                  const canCreate =
                    repoIdFromValue != null
                      ? Boolean(onNewPaneSession)
                      : projectIdFromValue != null
                        ? Boolean(onPaneProjectNewSession)
                        : false;
                  return (
                    <div className="app-claude-session-empty__repo-node">
                      <span className="app-claude-session-empty__repo-node-title">
                        {String(treeNode.title ?? "")}
                      </span>
                      {canCreate ? (
                        <button
                          type="button"
                          className="app-claude-session-empty__repo-node-create"
                          disabled={isCreating}
                          aria-label={`新建${treeNode.nodeType === "project" ? "工作区" : "仓库"}执行会话`}
                          title={`新建${treeNode.nodeType === "project" ? "工作区" : "仓库"}执行会话`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (isCreating) return;
                            onPickerOpenChange(paneIdx, false);
                            if (repoIdFromValue != null && onNewPaneSession) {
                              const selectedRepo = (shared.repositories ?? []).find(
                                (repo) => repo.id === repoIdFromValue,
                              );
                              if (selectedRepo) {
                                runPaneCreateTask(
                                  Promise.resolve(onNewPaneSession(paneIdx, selectedRepo)),
                                  paneIdx,
                                  setCreatingPaneSlots,
                                );
                              } else {
                                message.warning("未找到所选仓库");
                              }
                              return;
                            }
                            if (projectIdFromValue && onPaneProjectNewSession) {
                              const pickedProject = projectsById.get(projectIdFromValue.trim());
                              runPaneCreateTask(
                                Promise.resolve(
                                  onPaneProjectNewSession(
                                    paneIdx,
                                    projectIdFromValue,
                                    pickedProject ? [pickedProject] : projects,
                                    { rootPath: projectRootPath, projectName },
                                  ),
                                ),
                                paneIdx,
                                setCreatingPaneSlots,
                              );
                            }
                          }}
                        >
                          {isCreating ? <LoadingOutlined /> : <IconNewSession />}
                        </button>
                      ) : null}
                    </div>
                  );
                }}
                onSelect={(value) => {
                  const selected = String(value ?? "");
                  if (isCreating || !selected) return;
                  onPickerOpenChange(paneIdx, false);
                  if (selected.startsWith("repo:")) {
                    const repoId = Number(selected.slice(5));
                    const selectedRepo = (shared.repositories ?? []).find((repo) => repo.id === repoId);
                    if (selectedRepo && onNewPaneSession) {
                      runPaneCreateTask(
                        Promise.resolve(onNewPaneSession(paneIdx, selectedRepo)),
                        paneIdx,
                        setCreatingPaneSlots,
                      );
                    } else {
                      message.warning("未找到所选仓库");
                    }
                    return;
                  }
                  if (selected.startsWith("project:") && onPaneProjectNewSession) {
                    const pickedProject = projectsById.get(selected.slice(8).trim());
                    runPaneCreateTask(
                      Promise.resolve(
                        onPaneProjectNewSession(
                          paneIdx,
                          selected.slice(8),
                          pickedProject ? [pickedProject] : projects,
                          {
                            rootPath: pickedProject?.rootPath ?? null,
                            projectName: pickedProject?.name ?? null,
                          },
                        ),
                      ),
                      paneIdx,
                      setCreatingPaneSlots,
                    );
                  }
                }}
                style={{ width: "100%", marginBottom: 12 }}
              />
            ) : undefined
          }
          primaryAction={
            onNewPaneSession && resolvedRepo
              ? {
                  label: isCreating ? "创建中..." : "新建执行会话",
                  onClick: () => onCreatePaneSession(paneIdx),
                  loading: isCreating,
                  disabled: isCreating,
                }
              : undefined
          }
        />
      </div>
    );
  },
  (prev, next) =>
    prev.paneIdx === next.paneIdx &&
    prev.paneCount === next.paneCount &&
    prev.slot.slotId === next.slot.slotId &&
    prev.slot.sessionId === next.slot.sessionId &&
    prev.slot.repositoryId === next.slot.repositoryId &&
    prev.paneSession === next.paneSession &&
    prev.paneRepo?.id === next.paneRepo?.id &&
    prev.workflowTasks === next.workflowTasks &&
    prev.initialNotificationPanelCollapsed === next.initialNotificationPanelCollapsed &&
    prev.isCreating === next.isCreating &&
    prev.pickerOpen === next.pickerOpen &&
    prev.shared === next.shared &&
    prev.paneRepoTreeData === next.paneRepoTreeData &&
    prev.projectsById === next.projectsById &&
    prev.paneAuxLayout.panelBelowMessages === next.paneAuxLayout.panelBelowMessages &&
    prev.paneAuxLayout.hideMessages === next.paneAuxLayout.hideMessages &&
    prev.paneAuxLayout.hideSessionTools === next.paneAuxLayout.hideSessionTools,
);

export interface ClaudeMultiPaneGridProps {
  paneCount: PaneCount;
  activeSession: ClaudeSession;
  activeRepository: Repository;
  extraPanes: PaneSlot[];
  resolvedPaneSessions: (ClaudeSession | null)[];
  resolvedPaneRepositories: (Repository | null)[];
  activeSessionWorkflowTasks: WorkflowTaskItem[];
  paneWorkflowTasks: WorkflowTaskItem[][];
  shared: MultiPaneSharedChatProps;
  projects: ProjectItem[];
  paneRepoTreeData: PaneRepoTreeNode[];
  projectsById: Map<string, ProjectItem>;
  pendingCollapseNotificationForSessionId: string | null;
  creatingPaneSlots: Record<number, boolean>;
  paneRepoPickerOpenBySlot: Record<number, boolean>;
  onCreatePrimarySession: () => void;
  onCreatePaneSession: (paneIdx: number) => void;
  onPickerOpenChange: (paneIdx: number, open: boolean) => void;
  setCreatingPaneSlots: Dispatch<SetStateAction<Record<number, boolean>>>;
  onPaneRepositorySelect?: (slotIndex: number, repositoryId: number) => void | Promise<void>;
  onPaneProjectNewSession?: (
    slotIndex: number,
    projectId: string,
    projects: ProjectItem[],
    options?: { rootPath?: string | null; projectName?: string | null },
  ) => void | Promise<void>;
  onNewPaneSession?: (slotIndex: number, repository: Repository) => void | Promise<void>;
  panelBelowMessages?: ReactNode;
  resolvePaneAuxLayout?: ResolvePaneAuxLayout;
}

export const ClaudeMultiPaneGrid = memo(function ClaudeMultiPaneGrid({
  paneCount,
  activeSession,
  activeRepository,
  extraPanes,
  resolvedPaneSessions,
  resolvedPaneRepositories,
  activeSessionWorkflowTasks,
  paneWorkflowTasks,
  shared,
  projects,
  paneRepoTreeData,
  projectsById,
  pendingCollapseNotificationForSessionId,
  creatingPaneSlots,
  paneRepoPickerOpenBySlot,
  onCreatePrimarySession,
  onCreatePaneSession,
  onPickerOpenChange,
  setCreatingPaneSlots,
  onPaneRepositorySelect,
  onPaneProjectNewSession,
  onNewPaneSession,
  panelBelowMessages,
  resolvePaneAuxLayout,
}: ClaudeMultiPaneGridProps) {
  const resolveLayout = useCallback(
    (paneIndex: number): PaneAuxLayout => {
      if (resolvePaneAuxLayout) {
        return resolvePaneAuxLayout(paneIndex);
      }
      return {
        panelBelowMessages: paneIndex === 0 ? panelBelowMessages : undefined,
        hideMessages: shared.hideMessages,
        hideSessionTools: shared.hideSessionTools,
      };
    },
    [panelBelowMessages, resolvePaneAuxLayout, shared.hideMessages, shared.hideSessionTools],
  );
  const primaryPaneAuxLayout = resolveLayout(0);
  const multiPanesRef = useRef<HTMLDivElement | null>(null);
  const [twoPaneSplitRatio, setTwoPaneSplitRatio] = useState(DEFAULT_TWO_PANE_SPLIT_RATIO);
  const [twoPaneContainerWidthPx, setTwoPaneContainerWidthPx] = useState(0);
  const prevPaneCountRef = useRef(paneCount);

  const { rows, cols } = paneGridDimensions(paneCount);

  const twoPaneLeftWidthPx =
    paneCount === 2 && twoPaneContainerWidthPx > 0
      ? resolveTwoPaneLeftWidthPx(
          twoPaneSplitRatio,
          twoPaneContainerWidthPx,
          TWO_PANE_MIN_WIDTH_PX,
        )
      : null;

  const handleResetTwoPaneSplit = useCallback(() => {
    setTwoPaneSplitRatio(DEFAULT_TWO_PANE_SPLIT_RATIO);
  }, []);

  const handleStartTwoPaneResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (paneCount !== 2) return;
      const container = multiPanesRef.current;
      if (!container) return;
      const pointerId = event.pointerId;
      event.preventDefault();
      container.setPointerCapture(pointerId);
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      const onMove = (moveEvent: PointerEvent) => {
        const rect = container.getBoundingClientRect();
        if (rect.width <= 0) return;
        const ratio = (moveEvent.clientX - rect.left) / rect.width;
        setTwoPaneSplitRatio(clampTwoPaneSplitRatio(ratio, rect.width, TWO_PANE_MIN_WIDTH_PX));
      };
      const finish = () => {
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        try {
          if (container.hasPointerCapture(pointerId)) {
            container.releasePointerCapture(pointerId);
          }
        } catch {
          /* pointer already released */
        }
      };
      const onUp = () => finish();
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
      window.addEventListener("pointercancel", onUp, { once: true });
    },
    [paneCount],
  );

  useEffect(() => {
    const prev = prevPaneCountRef.current;
    prevPaneCountRef.current = paneCount;
    if (paneCount === 2 && prev !== 2) {
      setTwoPaneSplitRatio(DEFAULT_TWO_PANE_SPLIT_RATIO);
    }
    // 屏数变化是显著的布局切换：重置最近聚焦 pane，避免残留旧索引（可能已超出新屏数
    // 或指向非预期 pane）导致文件树点击路由错位；之后 fallback primary，直到用户再次聚焦某屏。
    resetActivePaneIndex();
  }, [paneCount]);

  useEffect(() => {
    if (paneCount !== 2) {
      setTwoPaneContainerWidthPx(0);
      return;
    }
    const el = multiPanesRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const syncContainerWidth = (width: number) => {
      if (width <= 0) return;
      setTwoPaneContainerWidthPx(width);
      setTwoPaneSplitRatio((current) =>
        clampTwoPaneSplitRatio(current, width, TWO_PANE_MIN_WIDTH_PX),
      );
    };

    syncContainerWidth(el.clientWidth);
    let rafId: number | null = null;
    const ro = new ResizeObserver(() => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        syncContainerWidth(el.clientWidth);
      });
    });

    ro.observe(el);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [paneCount]);

  const twoPaneGridColumns =
    paneCount === 2 && twoPaneLeftWidthPx != null
      ? formatTwoPaneSplitGridTemplateColumnsPx(twoPaneLeftWidthPx)
      : `repeat(${cols}, minmax(0, 1fr))`;

  return (
    <div
      ref={multiPanesRef}
      className={`app-claude-sessions__multi-panes${
        paneCount === 2 ? " app-claude-sessions__multi-panes--two-pane" : ""
      }`}
      style={{
        gridTemplateColumns: twoPaneGridColumns,
        gridTemplateRows: rows > 1 ? `repeat(${rows}, 1fr)` : undefined,
      }}
    >
      <MultiPanePrimaryPane
        session={activeSession}
        activeSessionId={activeSession.id}
        activeRepository={activeRepository}
        workflowTasks={activeSessionWorkflowTasks}
        shared={shared}
        initialNotificationPanelCollapsed={
          pendingCollapseNotificationForSessionId === activeSession.id
        }
        onCreateNewSession={onCreatePrimarySession}
        paneAuxLayout={primaryPaneAuxLayout}
      />
      {extraPanes.map((slot, paneIdx) => (
        <MultiPaneExtraPaneCell
          key={slot.slotId}
          slot={slot}
          paneIdx={paneIdx}
          paneCount={paneCount}
          activeSessionId={activeSession.id}
          paneSession={resolvedPaneSessions[paneIdx] ?? null}
          paneRepo={resolvedPaneRepositories[paneIdx] ?? activeRepository}
          activeRepository={activeRepository}
          workflowTasks={paneWorkflowTasks[paneIdx] ?? []}
          shared={shared}
          initialNotificationPanelCollapsed={
            resolvedPaneSessions[paneIdx]?.id === pendingCollapseNotificationForSessionId
          }
          isCreating={Boolean(creatingPaneSlots[paneIdx])}
          pickerOpen={Boolean(paneRepoPickerOpenBySlot[paneIdx])}
          projects={projects}
          paneRepoTreeData={paneRepoTreeData}
          projectsById={projectsById}
          onCreatePaneSession={onCreatePaneSession}
          onPickerOpenChange={onPickerOpenChange}
          setCreatingPaneSlots={setCreatingPaneSlots}
          onPaneRepositorySelect={onPaneRepositorySelect}
          onPaneProjectNewSession={onPaneProjectNewSession}
          onNewPaneSession={onNewPaneSession}
          paneAuxLayout={resolveLayout(paneIdx + 1)}
        />
      ))}
      {paneCount === 2 && twoPaneLeftWidthPx != null ? (
        <div
          className="app-claude-sessions__two-pane-resizer"
          style={{ left: `${twoPaneLeftWidthPx}px` }}
          onPointerDown={handleStartTwoPaneResize}
          onDoubleClick={handleResetTwoPaneSplit}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整双屏分栏宽度"
        />
      ) : null}
    </div>
  );
});

export type { PaneRepoTreeNode };
