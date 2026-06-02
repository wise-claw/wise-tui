import { extractLatestTodoWriteFromMessages, ingestPendingPermissionsFromSessionMessages, notificationHub } from "../notifications";
import type { ClaudeSession } from "../types";

export function restoreTodosFromTranscriptBySession(params: {
  sessionId: string;
  sessions: ClaudeSession[];
}): void {
  const session = params.sessions.find(
    (item) => item.id === params.sessionId || item.claudeSessionId === params.sessionId,
  );
  if (!session) return;
  const batch = extractLatestTodoWriteFromMessages(session.messages);
  if (!batch) return;
  notificationHub.restoreTodosFromTranscript(params.sessionId, batch.items, batch.merge);
  if (session.claudeSessionId && session.claudeSessionId !== params.sessionId) {
    notificationHub.restoreTodosFromTranscript(session.claudeSessionId, batch.items, batch.merge);
  }
}

export function restorePendingPermissionFromTranscriptBySession(params: {
  sessionId: string;
  sessions: ClaudeSession[];
}): void {
  const session = params.sessions.find(
    (item) => item.id === params.sessionId || item.claudeSessionId === params.sessionId,
  );
  if (!session) return;
  ingestPendingPermissionsFromSessionMessages(params.sessionId, session.messages);
  if (session.claudeSessionId && session.claudeSessionId !== params.sessionId) {
    ingestPendingPermissionsFromSessionMessages(session.claudeSessionId, session.messages);
  }
}

export function dismissQuestionBySession(params: {
  sessionId: string;
  respondToQuestion: (sessionId: string, answers: string[], customAnswer?: string) => Promise<void>;
}): void {
  const questionRequest = notificationHub.getDockSlice(params.sessionId).questionRequest;
  if (!questionRequest) return;
  const lifecycleStatus = notificationHub.getRequestLifecycle(questionRequest.id)?.status;
  const ownerSessionId = notificationHub.findRequestSessionId(questionRequest.id) ?? params.sessionId;
  if (lifecycleStatus === "expired" || lifecycleStatus === "failed") {
    notificationHub.userDismissNonPendingQuestionHeadAt(ownerSessionId);
    return;
  }
  void params.respondToQuestion(params.sessionId, []);
}
