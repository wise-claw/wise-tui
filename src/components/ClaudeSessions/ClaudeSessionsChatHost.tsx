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
import { Button, Empty, message } from "antd";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  resolveRepositoryForSession,
} from "../../utils/repositoryMainSessionBinding";
import type { WorkspaceMode, WorkspaceFocus } from "../../utils/workspaceMode";
import { shouldKeepProjectFocusWhenSwitchingSession } from "../../utils/workspaceSelectionState";
import { type PaneCount, type PaneSlot } from "../../constants/mainLayoutWidths";
import type { MultiPaneSharedChatProps, PaneRepoTreeNode } from "./ClaudeMultiPaneGrid";
import { runPaneCreateTask } from "./paneCreateLoading";
import { prefetchNewSessionSurface } from "./prefetchNewSessionSurface";
import { WorkspaceViewportLoading } from "../WorkspaceViewportLoading";
import type { ResolvePaneAuxLayout } from "./paneAuxLayout";

const ClaudeMultiPaneGridLazy = lazy(() =>
  import("./ClaudeMultiPaneGrid").then((module) => ({ default: module.ClaudeMultiPaneGrid })),
);
const ClaudeSessionChatWithDockLazy = lazy(() =>
  import("./ClaudeSessionChatWithDock").then((module) => ({
    default: module.ClaudeSessionChatWithDock,
  })),
);

function SessionEmptyState({
  title,
  hint,
  primaryAction,
}: {
  title: string;
  hint: string;
  primaryAction?: {
    label: string;
    onClick: () => void;
    loading?: boolean;
    disabled?: boolean;
  };
}) {
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

export interface ClaudeSessionsChatHostProps {
  /** 结构级会话快照（由 `ClaudeSessionsShell` 提供，不含流式正文）。 */
  incomingSessions: ClaudeSession[];
  /** 工作区过滤后的会话列表。 */
  sessions: ClaudeSession[];
  /** 当前面板活动会话（结构级）。 */
  activeSession: ClaudeSession | null;
  activeSessionId: string | null;
  activeRepository?: Repository;
  repositories?: Repository[];
  activeRepositoryId?: number | null;
  workspaceMode?: WorkspaceMode;
  activeProject?: ProjectItem | null;
  projects?: ProjectItem[];
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
  onSendMessage: (prompt: string) => void;
  onCancelSession: (sessionId: string, opts?: { retractLastUserTurn?: boolean }) => void;
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
  onRestoreRevert: (sessionId: string, id: string) => void;
  paneCount?: PaneCount;
  extraPanes?: PaneSlot[];
  primaryPaneRuntimeOverride?: import("../../types/paneRuntimeOverride").PaneRuntimeOverride | null;
  onUpdatePaneRuntimeOverride?: (
    paneIndex: number,
    patch: Partial<import("../../types/paneRuntimeOverride").PaneRuntimeOverride>,
  ) => void;
  onChangePaneCount?: (count: PaneCount) => void;
  onPaneRepositorySelect?: (paneIndex: number, repositoryId: number) => void;
  onPaneProjectNewSession?: (
    slotIndex: number,
    projectId: string,
    projects: ProjectItem[],
    options?: { rootPath?: string | null; projectName?: string | null },
  ) => void | Promise<void>;
  onNewPaneSession?: (paneIndex: number, repository: Repository) => void | Promise<void>;
  onOpenWorkflowConfig?: () => void;
  onOpenBuiltinAssistant?: (assistantId: string) => void;
  onActivateAssistant?: (assistant: import("../../types/assistant").AssistantEntry) => void | Promise<void>;
  onOpenAssistantsHub?: () => void;
  onOpenRepositoryScheduledTasks?: () => void;
  employees?: EmployeeItem[];
  mentionEmployees?: EmployeeItem[];
  composerProjectRoleTagOptions?: ReadonlyArray<import("../../utils/projectRoleTagOptions").RoleTagOption>;
  composerProjectRepositoryMentionOptions?: ReadonlyArray<
    import("../../utils/projectRoleTagOptions").RepositoryMentionOption
  >;
  composerHideEmployeesInAtMode?: boolean;
  workflowTasks?: WorkflowTaskItem[];
  taskPendingEmployeesByTaskId?: Record<string, Array<{ employeeId: string; name: string }>>;
  workflowTemplates?: WorkflowTemplateItem[];
  workflowGraphsByWorkflowId?: Record<string, WorkflowGraph>;
  workflowGraphStatusByWorkflowId?: Record<string, string>;
  onOpenTaskDetail?: (taskId: string) => void;
  panelBelowMessages?: React.ReactNode;
  hideMessages?: boolean;
  hideSessionTools?: boolean;
  resolvePaneAuxLayout?: ResolvePaneAuxLayout;
  resolveTaskListOmcInvokeConcurrency?: (session: ClaudeSession) => {
    concurrencyScopeKey: string;
    concurrencyLimit: number;
  } | null;
  repositoryMainBindings?: Record<string, string>;
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
  onRefreshHistorySessions?: (scope: import("./ClaudeChat").RefreshHistorySessionsScope) => void | Promise<void>;
  onDeleteHistorySession?: (sessionId: string) => Promise<void>;
  onOpenHistorySessionInInspector?: (sessionId: string) => void;
  onRestoreHistorySessionAsMain?: (sessionId: string) => void;
  omcBatchPipelineActive?: boolean;
  onReloadFullDiskTranscript?: (sessionId: string) => void | Promise<void>;
  onLoadMoreTranscriptFromDisk?: (sessionId: string) => void | Promise<void>;
  onCompactSessionHistory?: (sessionId: string) => void | Promise<void>;
  onStopSessionConversationTask?: (item: SessionConversationTaskItem) => void;
  chatContextRepository: Repository | undefined;
  paneRepoTreeData: PaneRepoTreeNode[];
  projectsById: Map<string, ProjectItem>;
  mainSessionForDataLink: ClaudeSession | null;
}

/** 聊天区壳层：不订阅 live；消息列表由 `ClaudeChatMessagesLiveHost` 独立更新。 */
export function ClaudeSessionsChatHost({
  incomingSessions,
  sessions,
  activeSession,
  activeSessionId,
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
  onSendMessage,
  onCancelSession,
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
  primaryPaneRuntimeOverride = null,
  onUpdatePaneRuntimeOverride,
  onPaneRepositorySelect,
  onPaneProjectNewSession,
  onNewPaneSession,
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
  chatContextRepository,
  paneRepoTreeData,
  projectsById,
  mainSessionForDataLink: _mainSessionForDataLink,
}: ClaudeSessionsChatHostProps) {
  const sessionById = useMemo(() => {
    const map = new Map<string, ClaudeSession>();
    for (const session of incomingSessions) {
      map.set(session.id, session);
    }
    return map;
  }, [incomingSessions]);

  const resolvedPaneSessions = useMemo(() => {
    return extraPanes.map((slot) => {
      if (!slot.sessionId) return null;
      return sessionById.get(slot.sessionId) ?? null;
    });
  }, [extraPanes, sessionById]);

  const resolvedPaneRepositories = useMemo(() => {
    return extraPanes.map((slot) => {
      if (slot.repositoryId == null) return chatContextRepository ?? null;
      return (repositories ?? []).find((r) => r.id === slot.repositoryId) ?? chatContextRepository ?? null;
    });
  }, [chatContextRepository, extraPanes, repositories]);

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

  const [pendingCollapseNotificationForSessionId, setPendingCollapseNotificationForSessionId] = useState<
    string | null
  >(null);
  const [paneRepoPickerOpenBySlot, setPaneRepoPickerOpenBySlot] = useState<Record<number, boolean>>({});
  const [creatingPaneSlots, setCreatingPaneSlots] = useState<Record<number, boolean>>({});
  const activeSessionWorkflowTasks = useMemo(
    () => (activeSession?.id ? workflowTasksByCreator.get(activeSession.id) ?? [] : []),
    [workflowTasksByCreator, activeSession?.id],
  );
  const paneWorkflowTasks = useMemo(() => {
    return extraPanes.map((slot) =>
      slot.sessionId ? workflowTasksByCreator.get(slot.sessionId) ?? [] : [],
    );
  }, [extraPanes, workflowTasksByCreator]);

  const [creatingPrimarySession, setCreatingPrimarySession] = useState(false);
  const creatingPrimarySessionRef = useRef(false);

  const resolveNewSessionRepository = useCallback((): Repository | null => {
    if (chatContextRepository) return chatContextRepository;
    if (activeRepository) return activeRepository;
    if (activeSession && repositories?.length) {
      return (
        resolveRepositoryForSession({
          session: activeSession,
          repositories,
          bindings: repositoryMainBindings,
          sessions,
          preferredRepositoryId: activeRepositoryId,
        }) ?? null
      );
    }
    return null;
  }, [
    activeRepository,
    activeRepositoryId,
    activeSession,
    chatContextRepository,
    repositories,
    repositoryMainBindings,
    sessions,
  ]);

  const handleCreatePrimarySession = useCallback(() => {
    if (creatingPrimarySessionRef.current) {
      return;
    }
    prefetchNewSessionSurface();
    creatingPrimarySessionRef.current = true;
    setCreatingPrimarySession(true);
    const finish = () => {
      creatingPrimarySessionRef.current = false;
      setCreatingPrimarySession(false);
    };

    void (async () => {
      try {
        if (activeWorkspaceFocus === "project" && activeProject && onNewProjectSession) {
          await onNewProjectSession(activeProject);
          return;
        }
        const targetRepository = resolveNewSessionRepository();
        if (!targetRepository) {
          message.warning("请先选择工作区或仓库");
          return;
        }
        await onNewSession(targetRepository);
      } catch (err) {
        message.error(err instanceof Error ? err.message : "新建会话失败");
      } finally {
        finish();
      }
    })();
  }, [
    activeProject,
    activeWorkspaceFocus,
    onNewProjectSession,
    onNewSession,
    resolveNewSessionRepository,
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
        const keepProjectFocus = shouldKeepProjectFocusWhenSwitchingSession({
          session: targetSession,
          activeWorkspaceFocus,
          activeProject,
          repositories,
          workspaceMode,
        });
        if (
          targetRepository &&
          targetRepository.id !== activeRepositoryId &&
          !keepProjectFocus
        ) {
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
      activeWorkspaceFocus,
      activeProject,
      workspaceMode,
      onSwitchSession,
    ],
  );

  const multiPaneSharedChatRef = useRef<MultiPaneSharedChatProps>({} as MultiPaneSharedChatProps);
  Object.assign(multiPaneSharedChatRef.current, {
    sessions,
    allSessionsForHistory: incomingSessions,
    repositories,
    activeProject,
    activeWorkspaceFocus,
    activeRepositoryId,
    workspaceMode,
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
    geminiAvailable,
    opencodeAvailable,
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
    onActivateAssistant,
    onOpenAssistantsHub,
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
    onReloadFullDiskTranscript,
    onLoadMoreTranscriptFromDisk,
    onCompactSessionHistory,
    onStopSessionConversationTask,
    paneCount,
    primaryPaneRuntimeOverride,
    onUpdatePaneRuntimeOverride,
  });

  useEffect(() => {
    if (
      pendingCollapseNotificationForSessionId !== null &&
      activeSessionId === pendingCollapseNotificationForSessionId
    ) {
      setPendingCollapseNotificationForSessionId(null);
    }
  }, [activeSessionId, pendingCollapseNotificationForSessionId]);

  if (!activeSession) {
    return (
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
    );
  }

  return (
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
          resolvePaneAuxLayout={resolvePaneAuxLayout}
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
          activeWorkspaceFocus={activeWorkspaceFocus}
          activeRepositoryId={activeRepositoryId}
          workspaceMode={workspaceMode}
          initialNotificationPanelCollapsed={
            pendingCollapseNotificationForSessionId === activeSession.id
          }
          onSwitchSession={handleSwitchToSession}
          onCreateNewSession={handleCreatePrimarySession}
          creatingNewSession={creatingPrimarySession}
          onOpenBuiltinAssistant={onOpenBuiltinAssistant}
          onActivateAssistant={onActivateAssistant}
          onOpenAssistantsHub={onOpenAssistantsHub}
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
          geminiAvailable={geminiAvailable}
          opencodeAvailable={opencodeAvailable}
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
          onReloadFullDiskTranscript={onReloadFullDiskTranscript}
          onLoadMoreTranscriptFromDisk={onLoadMoreTranscriptFromDisk}
          onCompactSessionHistory={onCompactSessionHistory}
        />
      )}
    </Suspense>
  );
}
