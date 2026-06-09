import { useRef, type RefObject } from "react";
import type { ClaudeSession } from "../../types";
import { CHAT_MESSAGES_SCROLLING_CLASS } from "../../constants/chatScrollPerformance";
import {
  isClaudeChatSessionStreaming,
  useChatMessagesPointerBusy,
} from "../../hooks/useChatMessagesPointerBusy";
import { useChatMessageListRows } from "../../hooks/useChatMessageListRows";
import { useScrollEndClass } from "../../hooks/useScrollEndClass";
import { ChatMessageListVirtualBody } from "./ChatMessageListVirtualBody";
import "./index.css";

interface Props {
  session: ClaudeSession;
  onOpenTaskDetail?: (taskId: string) => void;
  onOpenHistorySessionInInspector?: (sessionId: string) => void;
  sessionsForDispatchLookup?: readonly ClaudeSession[];
  /** @deprecated 虚拟列表按条数阈值自动启用，该开关保留仅为兼容旧调用方 */
  showAllMessages?: boolean;
  /** 绑定到消息滚动容器，供父组件在内容增高时 `scrollTop = scrollHeight` */
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
}

export function ClaudeSessionMessagesColumn({
  session,
  onOpenTaskDetail,
  onOpenHistorySessionInInspector,
  sessionsForDispatchLookup,
  scrollContainerRef,
}: Props) {
  const internalScrollRef = useRef<HTMLDivElement>(null);
  const scrollRef = scrollContainerRef ?? internalScrollRef;
  const rows = useChatMessageListRows(session);
  const streamingActive = isClaudeChatSessionStreaming(session.status);
  useScrollEndClass(scrollRef, CHAT_MESSAGES_SCROLLING_CLASS, 240, {
    deferLiveSessionUpdates: true,
  });
  useChatMessagesPointerBusy(scrollRef, streamingActive);

  return (
    <div className="app-claude-chat app-claude-session-messages-column">
      <div ref={scrollRef} className="app-claude-messages">
        {rows.length === 0 ? (
          <div className="app-claude-messages-empty">
            <p>暂无消息</p>
          </div>
        ) : (
          <ChatMessageListVirtualBody
            rows={rows}
            scrollContainerRef={scrollRef}
            listResetKey={session.id}
            listVariant="monitor"
            onOpenTaskDetail={onOpenTaskDetail}
            onOpenHistorySessionInInspector={onOpenHistorySessionInInspector}
            sessionsForDispatchLookup={sessionsForDispatchLookup}
          />
        )}
      </div>
    </div>
  );
}
