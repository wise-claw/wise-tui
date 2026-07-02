import {
  memo,
  useCallback,
  useEffect,
  useRef,
  type FocusEvent,
  type RefObject,
  useSyncExternalStore,
} from "react";
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
  fullTranscriptLoading: boolean;
  onReloadFullDiskTranscript?: (sessionId: string) => void | Promise<void>;
  resolveExecutionEnvironmentDispatchTask?: (meta: DispatchRecordMeta) => SessionConversationTaskItem | null;
  onOpenTaskDetail?: (taskId: string) => void;
  onOpenHistorySessionInInspector?: (sessionId: string) => void;
  onOpenSessionConversationTaskDetail?: (task: SessionConversationTaskItem) => void;
  sessionsForDispatchLookup?: readonly ClaudeSession[];
  onMessagesBlur: (event: FocusEvent<HTMLDivElement>) => void;
  onNavigateMessage: () => void;
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
  if (prev.session.transcriptMemoryUnlimited !== next.session.transcriptMemoryUnlimited) return false;
  if (prev.showListEndThinkingHint !== next.showListEndThinkingHint) return false;
  if (prev.fullTranscriptLoading !== next.fullTranscriptLoading) return false;
  if (prev.messageListProfile !== next.messageListProfile) return false;
  if (prev.companionMessageListWindow !== next.companionMessageListWindow) return false;
  if (prev.sessionExecutionEngine !== next.sessionExecutionEngine) return false;
  if (prev.messagesScrollRef !== next.messagesScrollRef) return false;
  if (prev.messageListNavRef !== next.messageListNavRef) return false;
  if (prev.sessionsForDispatchLookup !== next.sessionsForDispatchLookup) return false;
  if (prev.onMessagesBlur !== next.onMessagesBlur) return false;
  if (prev.onNavigateMessage !== next.onNavigateMessage) return false;
  if (prev.onReloadFullDiskTranscript !== next.onReloadFullDiskTranscript) return false;
  if (prev.onOpenTaskDetail !== next.onOpenTaskDetail) return false;
  if (prev.onOpenHistorySessionInInspector !== next.onOpenHistorySessionInInspector) return false;
  if (prev.onOpenSessionConversationTaskDetail !== next.onOpenSessionConversationTaskDetail) return false;
  if (prev.resolveExecutionEnvironmentDispatchTask !== next.resolveExecutionEnvironmentDispatchTask) return false;
  if (prev.onFullTranscriptStart !== next.onFullTranscriptStart) return false;
  if (prev.onFullTranscriptEnd !== next.onFullTranscriptEnd) return false;
  if (prev.session === next.session) return true;
  const prevMessages = prev.session.messages;
  const nextMessages = next.session.messages;
  if (prevMessages.length !== nextMessages.length) return false;
  // 流式时末条引用每 tick 必变：先查末条短路，避免 O(n) 前缀扫描。
  if (prevMessages.length > 0 && prevMessages[prevMessages.length - 1] !== nextMessages[nextMessages.length - 1]) {
    return false;
  }
  for (let i = 0; i < prevMessages.length - 1; i += 1) {
    if (prevMessages[i] !== nextMessages[i]) return false;
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

  // 全量磁盘重载帧内同步锁:与 fullTranscriptLoading 跨帧锁配合去重,
  // 避免滚动事件在一帧内多次触发 onReloadFullDiskTranscript。
  const fullDiskLoadLockedRef = useRef(false);
  // 切会话时重置锁,避免上一次会话的未释锁阻塞新会话的首次加载。
  useEffect(() => {
    fullDiskLoadLockedRef.current = false;
  }, [session.id]);

  // 内存窗口耗尽(已展示全部内存 rows)时衔接磁盘全量重载,拉取更早落盘内容。
  // 统一由 useChatMessageListWindow 的同一 scroll 监听器触发,消除两条独立监听器的
  // rAF 时序竞争(原 useDiskTranscriptScrollLoad 与 window hook 抢占 scrollTop)。
  const handleWindowExhausted = useCallback(() => {
    // 全量重载后 diskTranscriptPartial 置 false，不再有更早内容可拉，防重复触发。
    if (!session.diskTranscriptPartial) return;
    // onReloadFullDiskTranscript 可选，未传入时无磁盘重载能力，直接返回（避免空跑 start/end）。
    if (!onReloadFullDiskTranscript) return;
    // ref 帧内同步锁 + state 跨帧锁双重去重。
    if (fullDiskLoadLockedRef.current || fullTranscriptLoading) return;
    fullDiskLoadLockedRef.current = true;
    onFullTranscriptStart();
    // onReloadFullDiskTranscript 返回 void | Promise<void>，用 Promise.resolve 统一接 finally。
    void Promise.resolve(onReloadFullDiskTranscript(session.id)).finally(() => {
      onFullTranscriptEnd();
      fullDiskLoadLockedRef.current = false;
    });
  }, [
    session.diskTranscriptPartial,
    session.id,
    fullTranscriptLoading,
    onFullTranscriptStart,
    onFullTranscriptEnd,
    onReloadFullDiskTranscript,
  ]);

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
          onWindowExhausted={handleWindowExhausted}
        />
      )}
    </div>
  );
}, chatMessagesPanePropsEqual);
