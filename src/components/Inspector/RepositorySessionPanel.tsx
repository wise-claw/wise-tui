import { CommentOutlined, LoadingOutlined } from "@ant-design/icons";
import { Spin } from "antd";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { ClaudeSession, Repository } from "../../types";
import { useClaudeSessionLiveSnapshot } from "../../stores/claudeSessionsLiveStore";
import { useDockSlice } from "../../hooks/useDockSlice";
import { ClaudeSessionMessagesColumn } from "../ClaudeSessions/ClaudeSessionMessagesColumn";
import { ClaudeChatComposerTray } from "../ClaudeSessions/ClaudeChatComposerTray";
import { prefetchNewSessionSurface } from "../ClaudeSessions/prefetchNewSessionSurface";
import type { MultiPaneSharedChatProps } from "../ClaudeSessions/ClaudeMultiPaneGrid";
import { InspectorCollapsibleSection } from "./InspectorCollapsibleSection";
import "./RepositorySessionPanel.css";

/**
 * 右栏「仓库会话」面板所需的共享回调与上下文。
 *
 * 与中栏多窗格共用同一套 `MultiPaneSharedChatProps`（所有回调均按 sessionId 参数化），
 * 面板内部将它们绑定到当前侧会话 id，模式与 `ClaudeMultiPaneGrid` 的窗格绑定一致。
 */
export interface RepositorySessionPanelProps {
  shared: MultiPaneSharedChatProps;
  /** 当前仓库绑定的侧会话 id；尚未创建时为 null。 */
  sessionId: string | null;
  /** 当前打开的仓库（用于 gitRepositoryPath 与标题展示）。 */
  repository: Repository | null;
  /** 侧会话尚未创建时由面板触发创建（展开且无 session 时调用）。 */
  onEnsureSession: () => void;
  /** composer `/new`、`/reset` 等本地斜杠命令 → 新建侧会话。返回的 Promise 用于按钮置 loading 直到创建完成。 */
  onCreateNewSession: () => void | Promise<unknown>;
  /** 侧会话正在创建中（用于禁用输入/展示加载态）。 */
  creating?: boolean;
}

/**
 * 右栏独立「仓库会话」面板：在待办事项之下渲染一条专属于当前仓库的 Claude 会话，
 * 复用中栏的会话运行时（`useClaudeSessions`）与 composer / 消息列表组件。
 *
 * - 侧会话通过 `createSession(repo.path, repo.name, { skipActivate: true, isSide: true })` 创建，
 *   不抢占中栏 active、不进中栏 tab 列表（`filterSessionsForWorkspace` 排除 `isSide`）、
 *   不写入 `repositoryMainSessionBindings`。
 * - 消息列表复用 `ClaudeSessionMessagesColumn`（虚拟列表，轻量）。
 * - 输入框复用 `ClaudeChatComposerTray`（= `ComposerRegion` 的 lazy 包装），回调按 sessionId 绑定。
 */
export const RepositorySessionPanel = memo(function RepositorySessionPanel({
  shared,
  sessionId,
  repository,
  onEnsureSession,
  onCreateNewSession,
  creating = false,
}: RepositorySessionPanelProps) {
  // 展开且尚未持有侧会话时，触发上层创建（仅一次/每仓库）。
  useEffect(() => {
    if (!sessionId && !creating) {
      onEnsureSession();
    }
  }, [sessionId, creating, onEnsureSession]);

  const title = repository?.name ? `仓库会话 · ${repository.name}` : "仓库会话";

  return (
    <InspectorCollapsibleSection
      sectionId="repositorySession"
      className="app-repository-session-panel"
      ariaLabel="仓库会话"
      title={title}
    >
      <div className="app-repository-session-panel__body">
        {sessionId ? (
          <RepositorySessionPanelContent
            shared={shared}
            sessionId={sessionId}
            repository={repository}
            onCreateNewSession={onCreateNewSession}
          />
        ) : (
          <div className="app-repository-session-panel__placeholder" aria-busy="true">
            <Spin size="small" />
            <span>正在准备仓库会话…</span>
          </div>
        )}
      </div>
    </InspectorCollapsibleSection>
  );
});

interface RepositorySessionPanelContentProps {
  shared: MultiPaneSharedChatProps;
  sessionId: string;
  repository: Repository | null;
  onCreateNewSession: () => void;
}

/**
 * 内容子树：在此处订阅 live session 与 dock，使流式/dock 更新只 reconcile 本子树，
 * 不波及右栏其它卡片（与 `ClaudeSessionChatWithDock` 同模式）。
 */
const RepositorySessionPanelContent = memo(function RepositorySessionPanelContent({
  shared,
  sessionId,
  repository,
  onCreateNewSession,
}: RepositorySessionPanelContentProps) {
  const session = useClaudeSessionLiveSnapshot(sessionId, true);
  const dock = useDockSlice(sessionId);
  const composerTrayRef = useRef<HTMLDivElement>(null);
  // 局部 creating：点击「新建会话」后立即置 true，直到 onCreateNewSession 返回。
  // 上层在创建成功后会把新 sessionId 注入；sessionId 变化时由 onSessionReplaced 兜底重置。
  const [creatingNewSession, setCreatingNewSession] = useState(false);
  // 防重入锁：与中栏 SessionQuickActionsBar 的 createInvokeLockRef 模式一致。
  const createInvokeLockRef = useRef(false);

  const handleNewSideSession = useCallback(() => {
    if (creatingNewSession || createInvokeLockRef.current) return;
    createInvokeLockRef.current = true;
    queueMicrotask(() => {
      createInvokeLockRef.current = false;
    });
    setCreatingNewSession(true);
    prefetchNewSessionSurface();
    void Promise.resolve(onCreateNewSession()).finally(() => {
      setCreatingNewSession(false);
    });
  }, [creatingNewSession, onCreateNewSession]);

  const handleNewSideSessionPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || creatingNewSession) return;
      event.preventDefault();
      handleNewSideSession();
    },
    [creatingNewSession, handleNewSideSession],
  );

  // 将共享回调绑定到当前侧会话 id（与 ClaudeMultiPaneGrid 窗格绑定模式一致）。
  const bound = useMemo(() => {
    const onSessionModelChange = (model: string) => shared.onUpdateSessionModel(sessionId, model);
    const onSessionConnectionKindChange = (kind: import("../../constants/claudeConnection").ClaudeSessionConnectionKind) =>
      void shared.onUpdateSessionConnectionKind(sessionId, kind);
    const onCancel = (opts?: { retractLastUserTurn?: boolean }) =>
      shared.onCancelSession(sessionId, opts);
    const onRespondToPermission = (response: "allow_once" | "allow_always" | "deny") =>
      shared.onRespondToPermission(sessionId, response);
    const onToggleTodo = (todoId: string) => shared.onToggleTodo(sessionId, todoId);
    const onClearFollowups = () => shared.onClearFollowups(sessionId);
    const onClearRevertItems = () => shared.onClearRevertItems(sessionId);
    const onSendFollowup = (id: string) => shared.onSendFollowup(sessionId, id);
    const onRestoreRevert = (id: string) => shared.onRestoreRevert(sessionId, id);
    // ComposerRegion 的 onExecute 第三参 consumePending 用于待执行队列；侧会话无队列，直接走共享派发。
    const onExecute: import("../ClaudeChatInput").ComposerRegionProps["onExecute"] = (
      sid,
      prompt,
      _consumePending,
      dispatchTarget,
      executeOptions,
    ) => shared.onExecute(sid, prompt, dispatchTarget, executeOptions);
    return {
      onSessionModelChange,
      onSessionConnectionKindChange,
      onCancel,
      onRespondToPermission,
      onToggleTodo,
      onClearFollowups,
      onClearRevertItems,
      onSendFollowup,
      onRestoreRevert,
      onExecute,
    };
  }, [shared, sessionId]);

  // 侧会话尚未在 live store 可见时（创建中）展示加载态。
  if (!session) {
    return (
      <div className="app-repository-session-panel__placeholder" aria-busy="true">
        <Spin size="small" />
        <span>正在加载会话…</span>
      </div>
    );
  }

  return (
    <div className="app-repository-session-panel__content">
      <div className="app-repository-session-panel__messages">
        <RepositorySessionMessagesShrinkable session={session} shared={shared} />
      </div>
      <div className="app-repository-session-panel__new-session">
        <button
          type="button"
          className={`app-session-quick-pill app-session-quick-pill--new-session${
            creatingNewSession ? " app-session-quick-pill--loading" : ""
          }`}
          disabled={creatingNewSession}
          aria-busy={creatingNewSession}
          aria-label={creatingNewSession ? "正在创建会话" : "新会话"}
          onMouseEnter={prefetchNewSessionSurface}
          onFocus={prefetchNewSessionSurface}
          onPointerDown={handleNewSideSessionPointerDown}
          onClick={handleNewSideSession}
        >
          <span className="app-session-quick-pill__icon app-session-quick-pill__icon--blue" aria-hidden>
            {creatingNewSession ? <LoadingOutlined spin /> : <CommentOutlined />}
          </span>
          <span className="app-session-quick-pill__label">
            {creatingNewSession ? "创建中..." : "新会话"}
          </span>
        </button>
      </div>
      <ClaudeChatComposerTray
        composerTrayRef={composerTrayRef as RefObject<HTMLDivElement | null>}
        backgroundInvocationDockEnabled={false}
        compactFooterChrome
        session={session}
        gitRepositoryPath={repository?.path}
        draftBucketKey={`side-${session.id}`}
        onExecute={bound.onExecute}
        onSessionModelChange={bound.onSessionModelChange}
        onSessionConnectionKindChange={bound.onSessionConnectionKindChange}
        onCancel={bound.onCancel}
        codexAvailable={shared.codexAvailable}
        cursorAvailable={shared.cursorAvailable}
        geminiAvailable={shared.geminiAvailable}
        opencodeAvailable={shared.opencodeAvailable}
        onOpenExecutionEnvironment={shared.onOpenExecutionEnvironment}
        onDispatchExecutionEnvironment={shared.onDispatchExecutionEnvironment}
        todos={dock.todos}
        questionRequest={dock.questionRequest}
        questionRequestStatus={dock.questionRequestStatus}
        questionRequestError={dock.questionRequestError}
        permissionRequest={dock.permissionRequest}
        permissionRequestStatus={dock.permissionRequestStatus}
        permissionRequestError={dock.permissionRequestError}
        followupItems={dock.followupItems}
        revertItems={dock.revertItems}
        respondQuestionAt={shared.onRespondToQuestion}
        dismissQuestionAt={shared.onDismissQuestion}
        onRespondToPermission={bound.onRespondToPermission}
        onToggleTodo={bound.onToggleTodo}
        onClearFollowups={bound.onClearFollowups}
        onClearRevertItems={bound.onClearRevertItems}
        onSendFollowup={bound.onSendFollowup}
        onRestoreRevert={bound.onRestoreRevert}
        employeeMentions={shared.mentionEmployees}
        teamMentions={[]}
        projectRoleTagOptions={shared.composerProjectRoleTagOptions}
        projectRepositoryMentionOptions={shared.composerProjectRepositoryMentionOptions}
        hideEmployeesInAtMode={shared.composerHideEmployeesInAtMode}
        employeesForDispatchRoute={shared.employees}
        pendingExecutionTaskCount={0}
        onAppendSystemMessage={shared.onAppendSystemMessage}
        onAppendUserMessage={shared.onAppendUserMessage}
        onCompactSessionHistory={shared.onCompactSessionHistory}
        onCreateNewSession={onCreateNewSession}
        paneIndex={0}
        paneCount={1}
      />
    </div>
  );
});

/**
 * 消息列表独立 memo：流式时 session 引用每次变更才重算行，避免 composer 子树被连带 reconcile。
 */
const RepositorySessionMessagesShrinkable = memo(function RepositorySessionMessagesShrinkable({
  session,
  shared,
}: {
  session: ClaudeSession;
  shared: MultiPaneSharedChatProps;
}) {
  const onOpenTaskDetail = useCallback((taskId: string) => shared.onOpenTaskDetail?.(taskId), [shared]);
  return (
    <ClaudeSessionMessagesColumn
      session={session}
      onOpenTaskDetail={onOpenTaskDetail}
      sessionsForDispatchLookup={shared.sessions}
    />
  );
});
