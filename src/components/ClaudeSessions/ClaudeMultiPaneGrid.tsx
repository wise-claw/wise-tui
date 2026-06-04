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
import { paneGridDimensions, type PaneCount, type PaneSlot } from "../../constants/mainLayoutWidths";
import { useInViewActive } from "../../hooks/useInView";
import { useDockSlice } from "../../hooks/useDockSlice";
import { isProjectRootSessionDisplayName } from "../../utils/repositoryMainSessionBinding";
import {
  MULTI_PANE_LAZY_UNMOUNT_MS,
  resolveCompanionMessageListWindow,
  shouldLazyMountMultiPaneExtraCells,
  shouldUseOffscreenRunningShell,
} from "../../utils/multiPanePerformance";
import { ClaudeSessionChatWithDock } from "./ClaudeSessionChatWithDock";
import { MultiPaneOffscreenRunningPane } from "./MultiPaneOffscreenRunningPane";
import { runPaneCreateTask } from "./paneCreateLoading";
import type { RefreshHistorySessionsScope } from "./ClaudeChat";

const TWO_PANE_MIN_WIDTH_PX = 460;

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
  onOpenExecutionEnvironment?: () => void;
  onCancelSession: (sessionId: string, opts?: { retractLastUserTurn?: boolean }) => void;
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
  onOpenWorkflowConfig?: () => void;
  onOpenBuiltinAssistant?: (assistantId: string) => void;
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
  onAddWorktreeRepositoryToProject?: (worktreePath: string) => void | Promise<void>;
  onReloadFullDiskTranscript?: (sessionId: string) => void | Promise<void>;
  onLoadMoreTranscriptFromDisk?: (sessionId: string) => void | Promise<void>;
  onCompactSessionHistory?: (sessionId: string) => void | Promise<void>;
  onStopSessionConversationTask?: (item: SessionConversationTaskItem) => void;
  missionContext?: {
    projectId?: string | null;
    rootPath?: string | null;
  };
}

interface MultiPanePrimaryPaneProps {
  session: ClaudeSession;
  activeSessionId: string;
  activeRepository: Repository;
  workflowTasks: WorkflowTaskItem[];
  shared: MultiPaneSharedChatProps;
  initialNotificationPanelCollapsed: boolean;
  onCreateNewSession: () => void;
  panelBelowMessages?: ReactNode;
}

const MultiPanePrimaryPane = memo(function MultiPanePrimaryPane({
  session,
  activeSessionId,
  activeRepository,
  workflowTasks,
  shared,
  initialNotificationPanelCollapsed,
  onCreateNewSession,
  panelBelowMessages,
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

  return (
    <div className="app-claude-sessions__pane">
      <ClaudeSessionChatWithDock
        key={sessionId}
        session={session}
        activeSessionId={activeSessionId}
        sessions={shared.sessions}
        allSessionsForHistory={shared.allSessionsForHistory}
        repositories={shared.repositories}
        activeRepository={activeRepository}
        activeProject={shared.activeProject}
        initialNotificationPanelCollapsed={initialNotificationPanelCollapsed}
        onSwitchSession={shared.onSwitchSession}
        onCreateNewSession={onCreateNewSession}
        onOpenBuiltinAssistant={shared.onOpenBuiltinAssistant}
        onOpenAssistantsHub={shared.onOpenAssistantsHub}
        onSend={shared.onSend}
        onExecute={shared.onExecute}
        onDispatchExecutionEnvironment={shared.onDispatchExecutionEnvironment}
        onSessionModelChange={onSessionModelChange}
        onSessionConnectionKindChange={onSessionConnectionKindChange}
        onUpdateRepositoryExecutionEngine={shared.onUpdateRepositoryExecutionEngine}
        onUpdateEmployeeExecutionEngine={shared.onUpdateEmployeeExecutionEngine}
        codexAvailable={shared.codexAvailable}
        cursorAvailable={shared.cursorAvailable}
        onOpenExecutionEnvironment={shared.onOpenExecutionEnvironment}
        onCancel={onCancel}
        onCancelSessionById={shared.onCancelSession}
        respondQuestionAt={shared.onRespondToQuestion}
        dismissQuestionAt={shared.onDismissQuestion}
        onRespondToPermission={onRespondToPermission}
        onClearTodos={() => shared.onClearTodos(sessionId)}
        onToggleTodo={(todoId) => shared.onToggleTodo(sessionId, todoId)}
        onRestoreTodosFromTranscript={() => shared.onRestoreTodosFromTranscript(sessionId)}
        onRestorePendingPermissionFromTranscript={() =>
          shared.onRestorePendingPermissionFromTranscript(sessionId)
        }
        onClearFollowups={() => shared.onClearFollowups(sessionId)}
        onClearRevertItems={() => shared.onClearRevertItems(sessionId)}
        onSendFollowup={(id) => shared.onSendFollowup(sessionId, id)}
        onRestoreRevert={(id) => shared.onRestoreRevert(sessionId, id)}
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
            panelBelowMessages={panelBelowMessages}
            hideMessages={shared.hideMessages}
            hideSessionTools={shared.hideSessionTools}
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
        onAddWorktreeRepositoryToProject={shared.onAddWorktreeRepositoryToProject}
        onReloadFullDiskTranscript={shared.onReloadFullDiskTranscript}
        onLoadMoreTranscriptFromDisk={shared.onLoadMoreTranscriptFromDisk}
        onCompactSessionHistory={shared.onCompactSessionHistory}
        missionContext={shared.missionContext}
      />
    </div>
  );
}, (prev, next) =>
  prev.session === next.session &&
  prev.activeRepository.id === next.activeRepository.id &&
  prev.workflowTasks === next.workflowTasks &&
  prev.initialNotificationPanelCollapsed === next.initialNotificationPanelCollapsed &&
  prev.onCreateNewSession === next.onCreateNewSession &&
  prev.panelBelowMessages === next.panelBelowMessages &&
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
}

const MultiPaneExtraPaneCell = memo(
  function MultiPaneExtraPaneCell({
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
    /** 非焦点窗格在 running 时始终用精简壳，避免 IO 边界反复挂载完整 ClaudeChat。 */
    const pinOffscreenRunningShell =
      lazyEnabled && Boolean(paneSession) && Boolean(mustStayMounted) && !isActivePane;
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

    const deferHeavySubtree =
      lazyEnabled && mounted && Boolean(mustStayMounted) && (pinOffscreenRunningShell || !inView);
    const hidePaneMessages = shared.hideMessages || deferHeavySubtree;
    const useOffscreenRunningShell =
      (pinOffscreenRunningShell ||
        (lazyEnabled && !inView && Boolean(mustStayMounted))) &&
      shouldUseOffscreenRunningShell(paneCount) &&
      Boolean(paneSession) &&
      !offscreenDock.questionRequest;
    const companionMessageListWindow = useMemo(
      () => resolveCompanionMessageListWindow(paneCount),
      [paneCount],
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
        <div ref={lazyEnabled ? setPaneDivRef : undefined} className="app-claude-sessions__pane">
          <ClaudeSessionChatWithDock
            key={sessionId}
            session={paneSession}
            activeSessionId={activeSessionId}
            sessions={shared.sessions}
            allSessionsForHistory={shared.allSessionsForHistory}
            repositories={shared.repositories}
            activeRepository={resolvedRepo}
            activeProject={shared.activeProject}
            initialNotificationPanelCollapsed={initialNotificationPanelCollapsed}
            onSwitchSession={shared.onSwitchSession}
            onCreateNewSession={() => onCreatePaneSession(paneIdx)}
            onOpenBuiltinAssistant={shared.onOpenBuiltinAssistant}
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
            onOpenExecutionEnvironment={shared.onOpenExecutionEnvironment}
            onCancel={(opts) => shared.onCancelSession(sessionId, opts)}
            onCancelSessionById={shared.onCancelSession}
            respondQuestionAt={shared.onRespondToQuestion}
            dismissQuestionAt={shared.onDismissQuestion}
            onRespondToPermission={(response) => shared.onRespondToPermission(sessionId, response)}
            onClearTodos={() => shared.onClearTodos(sessionId)}
            onToggleTodo={(todoId) => shared.onToggleTodo(sessionId, todoId)}
            onRestoreTodosFromTranscript={() => shared.onRestoreTodosFromTranscript(sessionId)}
            onRestorePendingPermissionFromTranscript={() =>
              shared.onRestorePendingPermissionFromTranscript(sessionId)
            }
            onClearFollowups={() => shared.onClearFollowups(sessionId)}
            onClearRevertItems={() => shared.onClearRevertItems(sessionId)}
            onSendFollowup={(id) => shared.onSendFollowup(sessionId, id)}
            onRestoreRevert={(id) => shared.onRestoreRevert(sessionId, id)}
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
            hideMessages={hidePaneMessages}
            hideSessionTools={shared.hideSessionTools}
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
            onAddWorktreeRepositoryToProject={shared.onAddWorktreeRepositoryToProject}
            onReloadFullDiskTranscript={shared.onReloadFullDiskTranscript}
            onLoadMoreTranscriptFromDisk={shared.onLoadMoreTranscriptFromDisk}
            onCompactSessionHistory={shared.onCompactSessionHistory}
            dualPaneRepositoryPicker={dualPaneRepositoryPicker}
            missionContext={shared.missionContext}
            deferHeavySubtree={deferHeavySubtree}
            messageListProfile="companion"
            companionMessageListWindow={companionMessageListWindow}
          />
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
                dropdownClassName="app-claude-session-empty__repo-select-dropdown"
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
                    if (onPaneRepositorySelect) {
                      runPaneCreateTask(
                        Promise.resolve(onPaneRepositorySelect(paneIdx, Number(selected.slice(5)))),
                        paneIdx,
                        setCreatingPaneSlots,
                      );
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
    prev.projectsById === next.projectsById,
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
}: ClaudeMultiPaneGridProps) {
  const multiPanesRef = useRef<HTMLDivElement | null>(null);
  const [twoPaneLeftWidthPx, setTwoPaneLeftWidthPx] = useState<number | null>(null);

  const { rows, cols } = paneGridDimensions(paneCount);

  const resolveTwoPaneLeftWidthPx = useCallback(() => {
    const containerWidth = multiPanesRef.current?.clientWidth ?? 0;
    if (containerWidth <= 0) return null;
    const min = TWO_PANE_MIN_WIDTH_PX;
    const max = Math.max(min, containerWidth - TWO_PANE_MIN_WIDTH_PX);
    const fallback = Math.round(containerWidth / 2);
    const base = twoPaneLeftWidthPx ?? fallback;
    return Math.min(max, Math.max(min, base));
  }, [twoPaneLeftWidthPx]);

  const twoPaneLeft = paneCount === 2 ? resolveTwoPaneLeftWidthPx() : null;

  const handleResetTwoPaneSplit = useCallback(() => {
    if (paneCount !== 2) return;
    const containerWidth = multiPanesRef.current?.clientWidth ?? 0;
    if (containerWidth <= 0) return;
    setTwoPaneLeftWidthPx(Math.round(containerWidth / 2));
  }, [paneCount]);

  const handleStartTwoPaneResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (paneCount !== 2) return;
      const container = multiPanesRef.current;
      if (!container) return;
      const containerWidth = container.clientWidth;
      if (containerWidth <= 0) return;
      const min = TWO_PANE_MIN_WIDTH_PX;
      const max = Math.max(min, containerWidth - TWO_PANE_MIN_WIDTH_PX);
      const startLeft = resolveTwoPaneLeftWidthPx() ?? Math.round(containerWidth / 2);
      const startX = event.clientX;
      const pointerId = event.pointerId;
      event.preventDefault();
      container.setPointerCapture(pointerId);
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      const onMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - startX;
        const next = Math.min(max, Math.max(min, Math.round(startLeft + delta)));
        setTwoPaneLeftWidthPx(next);
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
    [paneCount, resolveTwoPaneLeftWidthPx],
  );

  useEffect(() => {
    if (paneCount !== 2) {
      setTwoPaneLeftWidthPx(null);
      return;
    }
    const next = resolveTwoPaneLeftWidthPx();
    if (next != null) setTwoPaneLeftWidthPx(next);
  }, [paneCount, resolveTwoPaneLeftWidthPx]);

  return (
    <div
      ref={multiPanesRef}
      className="app-claude-sessions__multi-panes"
      style={{
        gridTemplateColumns:
          paneCount === 2 && twoPaneLeft
            ? `${twoPaneLeft}px minmax(${TWO_PANE_MIN_WIDTH_PX}px, 1fr)`
            : `repeat(${cols}, 1fr)`,
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
        panelBelowMessages={panelBelowMessages}
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
        />
      ))}
      {paneCount === 2 ? (
        <div
          className="app-claude-sessions__two-pane-resizer"
          style={{ left: twoPaneLeft ? `${twoPaneLeft}px` : "50%" }}
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
