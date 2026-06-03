import { InfoCircleOutlined } from "@ant-design/icons";
import { memo, type FocusEvent, type RefObject } from "react";
import type { ClaudeSession } from "../../types";
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
  onOpenTaskDetail?: (taskId: string) => void;
  onOpenHistorySessionInInspector?: (sessionId: string) => void;
  sessionsForDispatchLookup?: readonly ClaudeSession[];
  onMessagesBlur: (event: FocusEvent<HTMLDivElement>) => void;
  onNavigateMessage: () => void;
  onLoadMoreTranscriptStart: () => void;
  onLoadMoreTranscriptEnd: () => void;
  onFullTranscriptStart: () => void;
  onFullTranscriptEnd: () => void;
  messageListProfile?: "primary" | "companion";
  companionMessageListWindow?: { initialVisible: number; loadStep: number };
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
  if (prev.messagesScrollRef !== next.messagesScrollRef) return false;
  if (prev.messageListNavRef !== next.messageListNavRef) return false;
  if (prev.sessionsForDispatchLookup !== next.sessionsForDispatchLookup) return false;
  if (prev.onMessagesBlur !== next.onMessagesBlur) return false;
  if (prev.onNavigateMessage !== next.onNavigateMessage) return false;
  if (prev.onLoadMoreTranscriptFromDisk !== next.onLoadMoreTranscriptFromDisk) return false;
  if (prev.onReloadFullDiskTranscript !== next.onReloadFullDiskTranscript) return false;
  if (prev.onOpenTaskDetail !== next.onOpenTaskDetail) return false;
  if (prev.onOpenHistorySessionInInspector !== next.onOpenHistorySessionInInspector) return false;
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
  loadMoreTranscriptLoading,
  fullTranscriptLoading,
  onLoadMoreTranscriptFromDisk,
  onReloadFullDiskTranscript,
  onOpenTaskDetail,
  onOpenHistorySessionInInspector,
  sessionsForDispatchLookup,
  onMessagesBlur,
  onNavigateMessage,
  onLoadMoreTranscriptStart,
  onLoadMoreTranscriptEnd,
  onFullTranscriptStart,
  onFullTranscriptEnd,
  messageListProfile = "primary",
  companionMessageListWindow,
}: ClaudeChatMessagesPaneProps) {
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
      {session.diskTranscriptPartial && (onLoadMoreTranscriptFromDisk || onReloadFullDiskTranscript) ? (
        <div className="app-claude-messages-disk-partial" role="status">
          <InfoCircleOutlined className="app-claude-messages-disk-partial__icon" aria-hidden />
          <span className="app-claude-messages-disk-partial__text">尾部加载（省内存）</span>
          {onLoadMoreTranscriptFromDisk ? (
            <>
              <span className="app-claude-messages-disk-partial__sep" aria-hidden>
                ·
              </span>
              <button
                type="button"
                className="app-claude-messages-disk-partial__action"
                disabled={loadMoreTranscriptLoading}
                aria-label="加载更早轮次"
                onClick={() => {
                  onLoadMoreTranscriptStart();
                  void Promise.resolve(onLoadMoreTranscriptFromDisk(session.id)).finally(onLoadMoreTranscriptEnd);
                }}
              >
                {loadMoreTranscriptLoading ? "加载中…" : "更早"}
              </button>
            </>
          ) : null}
          {onReloadFullDiskTranscript ? (
            <>
              <span className="app-claude-messages-disk-partial__sep" aria-hidden>
                ·
              </span>
              <button
                type="button"
                className="app-claude-messages-disk-partial__action"
                disabled={fullTranscriptLoading}
                aria-label="加载完整历史"
                onClick={() => {
                  onFullTranscriptStart();
                  void Promise.resolve(onReloadFullDiskTranscript(session.id)).finally(onFullTranscriptEnd);
                }}
              >
                {fullTranscriptLoading ? "加载中…" : "完整历史"}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {session.messages.length === 0 ? (
        <div className="app-claude-messages-empty">
          <p>发送消息开始与 Claude Code 对话</p>
        </div>
      ) : (
        <ClaudeVirtualMessageList
          ref={messageListNavRef}
          session={session}
          showListEndThinkingHint={showListEndThinkingHint}
          scrollContainerRef={messagesScrollRef}
          onOpenTaskDetail={onOpenTaskDetail}
          onOpenHistorySessionInInspector={onOpenHistorySessionInInspector}
          sessionsForDispatchLookup={sessionsForDispatchLookup}
          onNavigate={onNavigateMessage}
          messageListProfile={messageListProfile}
          companionMessageListWindow={companionMessageListWindow}
        />
      )}
    </div>
  );
}, chatMessagesPanePropsEqual);
