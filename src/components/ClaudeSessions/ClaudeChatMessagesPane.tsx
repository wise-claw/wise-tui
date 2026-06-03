import { InfoCircleOutlined } from "@ant-design/icons";
import { Button } from "antd";
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
          <span className="app-claude-messages-disk-partial__label">
            磁盘会话尾部加载（省内存），可逐步加载更早内容或读取完整历史。
          </span>
          <span className="app-claude-messages-disk-partial__actions">
            {onLoadMoreTranscriptFromDisk ? (
              <Button
                type="link"
                size="small"
                loading={loadMoreTranscriptLoading}
                onClick={() => {
                  onLoadMoreTranscriptStart();
                  void Promise.resolve(onLoadMoreTranscriptFromDisk(session.id)).finally(onLoadMoreTranscriptEnd);
                }}
              >
                加载更早轮次
              </Button>
            ) : null}
            {onReloadFullDiskTranscript ? (
              <Button
                type="link"
                size="small"
                loading={fullTranscriptLoading}
                onClick={() => {
                  onFullTranscriptStart();
                  void Promise.resolve(onReloadFullDiskTranscript(session.id)).finally(onFullTranscriptEnd);
                }}
              >
                加载完整历史
              </Button>
            ) : null}
          </span>
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
});
