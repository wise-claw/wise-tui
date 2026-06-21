import type { ClaudeSession, TodoItem } from "../../types";
import type { ClaudeChatComposerTrayProps } from "./ClaudeChatComposerTray";
import { sessionChatChromeStructureKey } from "../../utils/sessionConversationTasks";

function listFingerprint(items: ReadonlyArray<{ id: string; text: string }>): string {
  if (items.length === 0) return "";
  return items.map((item) => `${item.id}:${item.text}`).join("\n");
}

function todosFingerprint(todos: TodoItem[]): string {
  if (todos.length === 0) return "";
  return todos.map((todo) => `${todo.id}:${todo.status}:${todo.content}`).join("\n");
}

function sessionComposerTrayKey(session: ClaudeSession): string {
  return [
    sessionChatChromeStructureKey(session),
    session.model?.trim() ?? "",
    session.connectionKind ?? "",
    session.repositoryPath ?? "",
  ].join("\n");
}

/** Composer 托盘 memo：忽略 ClaudeChat 内通知/队列等无关重渲染。 */
export function claudeChatComposerTrayPropsEqual(
  prev: ClaudeChatComposerTrayProps,
  next: ClaudeChatComposerTrayProps,
): boolean {
  if (prev.composerTrayRef !== next.composerTrayRef) return false;
  if (prev.backgroundInvocationDockEnabled !== next.backgroundInvocationDockEnabled) return false;
  if (sessionComposerTrayKey(prev.session) !== sessionComposerTrayKey(next.session)) return false;
  if (prev.gitRepositoryPath !== next.gitRepositoryPath) return false;
  if (prev.pendingExecutionTaskCount !== next.pendingExecutionTaskCount) return false;
  if (prev.sessionExecutionEngine !== next.sessionExecutionEngine) return false;
  if (prev.codexAvailable !== next.codexAvailable) return false;
  if (prev.cursorAvailable !== next.cursorAvailable) return false;
  if (prev.geminiAvailable !== next.geminiAvailable) return false;
  if (prev.opencodeAvailable !== next.opencodeAvailable) return false;
  if (prev.hideEmployeesInAtMode !== next.hideEmployeesInAtMode) return false;
  if (prev.paneIndex !== next.paneIndex) return false;
  if (prev.paneCount !== next.paneCount) return false;
  if (prev.paneRuntimeOverride !== next.paneRuntimeOverride) return false;
  if (prev.dualPaneRepositoryPicker !== next.dualPaneRepositoryPicker) return false;
  if (todosFingerprint(prev.todos) !== todosFingerprint(next.todos)) return false;
  if (listFingerprint(prev.followupItems) !== listFingerprint(next.followupItems)) return false;
  if (listFingerprint(prev.revertItems) !== listFingerprint(next.revertItems)) return false;
  if ((prev.questionRequest?.id ?? "") !== (next.questionRequest?.id ?? "")) return false;
  if (prev.questionRequestQueueLength !== next.questionRequestQueueLength) return false;
  if (prev.questionRequestStatus !== next.questionRequestStatus) return false;
  if (prev.questionRequestError !== next.questionRequestError) return false;
  if ((prev.permissionRequest?.id ?? "") !== (next.permissionRequest?.id ?? "")) return false;
  if (prev.permissionRequestStatus !== next.permissionRequestStatus) return false;
  if (prev.permissionRequestError !== next.permissionRequestError) return false;
  if (prev.questionDockTabs !== next.questionDockTabs) return false;
  if (prev.employeeMentions !== next.employeeMentions) return false;
  if (prev.teamMentions !== next.teamMentions) return false;
  if (prev.projectRoleTagOptions !== next.projectRoleTagOptions) return false;
  if (prev.projectRepositoryMentionOptions !== next.projectRepositoryMentionOptions) return false;
  if (prev.employeesForDispatchRoute !== next.employeesForDispatchRoute) return false;
  if (prev.draftBucketKey !== next.draftBucketKey) return false;

  const callbackKeys = [
    "onExecute",
    "onDispatchExecutionEnvironment",
    "onSessionModelChange",
    "onSessionConnectionKindChange",
    "onOpenExecutionEnvironment",
    "onSessionExecutionEngineChange",
    "onUpdatePaneRuntimeOverride",
    "onCancel",
    "respondQuestionAt",
    "dismissQuestionAt",
    "onRespondToPermission",
    "onClearTodos",
    "onToggleTodo",
    "onSendFollowup",
    "onClearFollowups",
    "onRestoreRevert",
    "onClearRevertItems",
    "onEnqueueAsPendingTask",
    "onTrackSendFlow",
    "onAppendSystemMessage",
    "onAppendUserMessage",
    "onCompactSessionHistory",
    "onCreateNewSession",
  ] as const satisfies ReadonlyArray<keyof ClaudeChatComposerTrayProps>;

  for (const key of callbackKeys) {
    if (!Object.is(prev[key], next[key])) return false;
  }
  return true;
}
