import { memo, type FocusEvent, type RefObject, useSyncExternalStore } from "react";
import type { SessionExecutionEngine } from "../../constants/sessionExecutionEngine";
import type { ClaudeSession, SessionConversationTaskItem } from "../../types";
import { buildSessionEmptyChatPrompt } from "../../utils/sessionExecutionEngine";
import type { DispatchRecordMeta } from "../../utils/claudeChatMessageDisplay";
import { CHAT_MESSAGES_SCROLLING_CLASS } from "../../constants/chatScrollPerformance";
import {
  isClaudeChatSessionStreaming,
  useChatMessagesPointerBusy,
} from "../../hooks/useChatMessagesPointerBusy";
import { useScrollEndClass } from "../../hooks/useScrollEndClass";
import { useDiskTranscriptScrollLoad } from "../../hooks/useDiskTranscriptScrollLoad";
import {
  isSessionTranscriptHydrating,
  subscribeSessionTranscriptHydrating,
} from "../../stores/claudeTranscriptHydrationStore";
import {
  ClaudeVirtualMessageList,
  type ChatMessageListNavigationHandle,
} from "./ClaudeVirtualMessageList";

export interface ClaudeChatMessagesPaneProps {
  session: ClaudeSession;
  messagesScrollRef: RefObject<HTMLDivElement | null>;
  messageListNavRef: RefObject<ChatMessageListNavigationHandle | null>;
  showListEndThinkingHint: boolean;
  loadMoreTranscriptLoading: boolean;
  fullTranscriptLoading: boolean;
  onLoadMoreTranscriptFromDisk?: (sessionId: string) => void | Promise<void>;
  onReloadFullDiskTranscript?: (sessionId: string) => void | Promise<void>;
  resolveExecutionEnvironmentDispatchTask?: (meta: DispatchRecordMeta) => SessionConversationTaskItem | null;
  onOpenTaskDetail?: (taskId: string) => void;
  onOpenHistorySessionInInspector?: (sessionId: string) => void;
  onOpenSessionConversationTaskDetail?: (task: SessionConversationTaskItem) => void;
  sessionsForDispatchLookup?: readonly ClaudeSession[];
  onMessagesBlur: (event: FocusEvent<HTMLDivElement>) => void;
  onNavigateMessage: () => void;
  onLoadMoreTranscriptStart: () => void;
  onLoadMoreTranscriptEnd: () => void;
  onFullTranscriptStart: () => void;
  onFullTranscriptEnd: () => void;
  messageListProfile?: "primary" | "companion";
  companionMessageListWindow?: { initialVisible: number; loadStep: number };
  sessionExecutionEngine?: SessionExecutionEngine;
}

function chatMessagesPanePropsEqual(
  prev: Readonly<ClaudeChatMessagesPaneProps>,
  next: Readonly<ClaudeChatMessagesPaneProps>,
): boolean {
  if (prev.session.id !== next.session.id) return false;
  if (prev.session.status !== next.session.status) return false;
  if (prev.session.diskTranscriptPartial !== next.session.diskTranscriptPartial) return false;
  if (prev.showListEndThinkingHint !== next.showListEndThinkingHint) return false;
  if (prev.loadMoreTranscriptLoading !== next.loadMoreTranscriptLoading) return false;
  if (prev.fullTranscriptLoading !== next.fullTranscriptLoading) return false;
  if (prev.messageListProfile !== next.messageListProfile) return false;
  if (prev.companionMessageListWindow !== next.companionMessageListWindow) return false;
  if (prev.sessionExecutionEngine !== next.sessionExecutionEngine) return false;
  if (prev.messagesScrollRef !== next.messagesScrollRef) return false;
  if (prev.messageListNavRef !== next.messageListNavRef) return false;
  if (prev.sessionsForDispatchLookup !== next.sessionsForDispatchLookup) return false;
  if (prev.onMessagesBlur !== next.onMessagesBlur) return false;
  if (prev.onNavigateMessage !== next.onNavigateMessage) return false;
  if (prev.onLoadMoreTranscriptFromDisk !== next.onLoadMoreTranscriptFromDisk) return false;
  if (prev.onReloadFullDiskTranscript !== next.onReloadFullDiskTranscript) return false;
  if (prev.onOpenTaskDetail !== next.onOpenTaskDetail) return false;
  if (prev.onOpenHistorySessionInInspector !== next.onOpenHistorySessionInInspector) return false;
  if (prev.onOpenSessionConversationTaskDetail !== next.onOpenSessionConversationTaskDetail) return false;
  if (prev.resolveExecutionEnvironmentDispatchTask !== next.resolveExecutionEnvironmentDispatchTask) return false;
  if (prev.onLoadMoreTranscriptStart !== next.onLoadMoreTranscriptStart) return false;
  if (prev.onLoadMoreTranscriptEnd !== next.onLoadMoreTranscriptEnd) return false;
  if (prev.onFullTranscriptStart !== next.onFullTranscriptStart) return false;
  if (prev.onFullTranscriptEnd !== next.onFullTranscriptEnd) return false;
  if (prev.session === next.session) return true;
  const prevMessages = prev.session.messages;
  const nextMessages = next.session.messages;
  if (prevMessages.length !== nextMessages.length) return false;
  for (let i = 0; i < prevMessages.length - 1; i += 1) {
    if (prevMessages[i] !== nextMessages[i]) return false;
  }
  if (prevMessages.length > 0 && prevMessages[prevMessages.length - 1] !== nextMessages[nextMessages.length - 1]) {
    return false;
  }
  return true;
}

export const ClaudeChatMessagesPane = memo(function ClaudeChatMessagesPane({
  session,
  messagesScrollRef,
  messageListNavRef,
  showListEndThinkingHint,
  fullTranscriptLoading,
  onReloadFullDiskTranscript,
  onOpenTaskDetail,
  onOpenHistorySessionInInspector,
  onOpenSessionConversationTaskDetail,
  resolveExecutionEnvironmentDispatchTask,
  sessionsForDispatchLookup,
  onMessagesBlur,
  onNavigateMessage,
  onFullTranscriptStart,
  onFullTranscriptEnd,
  messageListProfile = "primary",
  companionMessageListWindow,
  sessionExecutionEngine = "claude",
}: ClaudeChatMessagesPaneProps) {
  const streamingActive = isClaudeChatSessionStreaming(session.status);
  const transcriptHydrating = useSyncExternalStore(
    subscribeSessionTranscriptHydrating,
    () => isSessionTranscriptHydrating(session.id),
    () => false,
  );
  useScrollEndClass(messagesScrollRef, CHAT_MESSAGES_SCROLLING_CLASS, 240, {
    deferLiveSessionUpdates: true,
  });
  useChatMessagesPointerBusy(messagesScrollRef, streamingActive);

  useDiskTranscriptScrollLoad({
    sessionId: session.id,
    diskTranscriptPartial: Boolean(session.diskTranscriptPartial),
    scrollContainerRef: messagesScrollRef,
    fullTranscriptLoading,
    onReloadFullDiskTranscript,
    onFullTranscriptStart,
    onFullTranscriptEnd,
  });

  return (
    <div
      ref={messagesScrollRef}
      className="app-claude-messages"
      tabIndex={-1}
      role="log"
      aria-label="对话消息"
      onPointerDownCapture={() => {
        const ae = document.activeElement;
        if (ae instanceof Element && ae.closest("[data-wise-composer-root] .ProseMirror")) {
          return;
        }
        messagesScrollRef.current?.focus({ preventScroll: true });
      }}
      onBlur={onMessagesBlur}
    >
      {session.messages.length === 0 ? (
        <div className="app-claude-messages-empty">
          <p>
            {transcriptHydrating
              ? "正在加载对话历史…"
              : buildSessionEmptyChatPrompt(sessionExecutionEngine)}
          </p>
        </div>
      ) : (
        <ClaudeVirtualMessageList
          ref={messageListNavRef}
          session={session}
          showListEndThinkingHint={showListEndThinkingHint}
          scrollContainerRef={messagesScrollRef}
          resolveExecutionEnvironmentDispatchTask={resolveExecutionEnvironmentDispatchTask}
          onOpenTaskDetail={onOpenTaskDetail}
          onOpenHistorySessionInInspector={onOpenHistorySessionInInspector}
          onOpenSessionConversationTaskDetail={onOpenSessionConversationTaskDetail}
          sessionsForDispatchLookup={sessionsForDispatchLookup}
          onNavigate={onNavigateMessage}
          messageListProfile={messageListProfile}
          companionMessageListWindow={companionMessageListWindow}
        />
      )}
    </div>
  );
}, chatMessagesPanePropsEqual);
