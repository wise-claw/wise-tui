import type { ClaudeSession, QuestionRequest } from "../types";
import type { ClaudeSessionConnectionKind } from "../constants/claudeConnection";

export type ControlSessionContext = {
  ownerSessionId: string;
  session: ClaudeSession | undefined;
  tabSessionId: string;
  claudeSid: string | null;
};

export function resolveControlSessionContext(params: {
  ownerSessionId: string;
  sessions: ClaudeSession[];
  sessionIdMap: Map<string, string>;
}): ControlSessionContext {
  const session = params.sessions.find(
    (item) => item.id === params.ownerSessionId || item.claudeSessionId === params.ownerSessionId,
  );
  const tabSessionId = session?.id ?? params.ownerSessionId;
  const claudeSid = session?.claudeSessionId?.trim() ?? params.sessionIdMap.get(tabSessionId)?.trim() ?? null;
  return {
    ownerSessionId: params.ownerSessionId,
    session,
    tabSessionId,
    claudeSid,
  };
}

export function shouldPreferQuestionStdinControl(params: {
  session: ClaudeSession | undefined;
  claudeSid: string | null;
  defaultConnectionKind: ClaudeSessionConnectionKind;
  hasLiveStreamingProcess: boolean;
  sessionUsesStreamingConnection: (
    session: ClaudeSession,
    defaultConnectionKind: ClaudeSessionConnectionKind,
  ) => boolean;
}): boolean {
  return (
    params.hasLiveStreamingProcess ||
    Boolean(
      params.session &&
        params.sessionUsesStreamingConnection(params.session, params.defaultConnectionKind) &&
        params.claudeSid,
    )
  );
}

export function consumeNextTurnNonce(
  currentSeq: number,
  enabled: boolean,
): { nextSeq: number; turnNonce: number | null } {
  if (!enabled) {
    return { nextSeq: currentSeq, turnNonce: null };
  }
  const nextSeq = currentSeq + 1;
  return { nextSeq, turnNonce: nextSeq };
}

export async function handleProxyStreamingQuestionBranch(params: {
  proxyStreamingQuestion: boolean;
  claudeSid: string | null;
  tabSessionId: string;
  closeStreamingSession: (sessionId: string) => Promise<void>;
  streamingProcessByTab: Map<string, { claudeSessionId: string | null }>;
  streamingSessionStreamDetachByTab: Map<string, () => void>;
  detachClaudeInvocationStreamsForTab: (tabSessionId: string) => void;
  deliverQuestionAnswerViaResume: (
    ownerSessionId: string,
    qr: QuestionRequest,
    answers: string[],
    customAnswer?: string,
  ) => Promise<boolean>;
  ownerSessionId: string;
  qr: QuestionRequest;
  answers: string[];
  customAnswer?: string;
}): Promise<boolean> {
  if (!params.proxyStreamingQuestion) return false;
  if (params.claudeSid) {
    await params.closeStreamingSession(params.claudeSid).catch(() => {
      /* 可能已退出 */
    });
  }
  params.streamingProcessByTab.delete(params.tabSessionId);
  params.streamingSessionStreamDetachByTab.get(params.tabSessionId)?.();
  params.streamingSessionStreamDetachByTab.delete(params.tabSessionId);
  params.detachClaudeInvocationStreamsForTab(params.tabSessionId);
  await params.deliverQuestionAnswerViaResume(
    params.ownerSessionId,
    params.qr,
    params.answers,
    params.customAnswer,
  );
  return true;
}

export async function submitQuestionViaStdin(params: {
  tabSessionId: string;
  claudeSid: string | null;
  targetSessionId: string;
  nextTurnNonce: number | null;
  qr: QuestionRequest;
  answers: string[];
  customAnswer?: string;
  userAnswerText: string;
  preferStdinControlResponse: boolean;
  appendUserMessage: (sessionId: string, text: string) => void;
  expectedTurnNonceByTabId: Map<string, number>;
  setStreamingTargetId: (id: string | null) => void;
  markClaudeRegistryBootstrapWarmup: (claudeSessionId: string | null | undefined) => void;
  setStreamingProcessByTab: (tabId: string, claudeSessionId: string | null) => void;
  setSessionRunning: (tabSessionId: string) => void;
  prepareStreamingControlResponseListener: (
    tabSessionId: string,
    claudeSessionId: string,
    turnNonce: number,
  ) => Promise<void>;
  scheduleStreamStallTimer: (tabId: string) => void;
  submitClaudeStdinLine: (line: string, sessionId?: string) => Promise<void>;
  buildQuestionStdinLine: (
    questionId: string,
    answers: string[],
    customAnswer: string | undefined,
    request: Pick<QuestionRequest, "options"> | null | undefined,
  ) => string;
  isToolUseQuestionRequestId: (requestId: string) => boolean;
  sendStreamingUserMessage: (sessionId: string, message: string) => Promise<void>;
}): Promise<void> {
  params.appendUserMessage(params.tabSessionId, params.userAnswerText);
  if (params.nextTurnNonce !== null && params.claudeSid) {
    params.expectedTurnNonceByTabId.set(params.tabSessionId, params.nextTurnNonce);
    params.setStreamingTargetId(params.tabSessionId);
    params.markClaudeRegistryBootstrapWarmup(params.claudeSid);
    params.setStreamingProcessByTab(params.tabSessionId, params.claudeSid);
    params.setSessionRunning(params.tabSessionId);
    await params.prepareStreamingControlResponseListener(
      params.tabSessionId,
      params.claudeSid,
      params.nextTurnNonce,
    );
    params.scheduleStreamStallTimer(params.tabSessionId);
  }
  await params.submitClaudeStdinLine(
    params.buildQuestionStdinLine(params.qr.id, params.answers, params.customAnswer, params.qr),
    params.targetSessionId,
  );
  const needsStreamUserFallback =
    params.preferStdinControlResponse &&
    params.claudeSid &&
    params.userAnswerText.trim().length > 0 &&
    params.isToolUseQuestionRequestId(params.qr.id);
  if (needsStreamUserFallback) {
    const sid = params.claudeSid;
    if (!sid) return;
    await params.sendStreamingUserMessage(sid, params.userAnswerText).catch(() => {
      /* control_response 已写入时忽略重复用户行失败 */
    });
  }
}
