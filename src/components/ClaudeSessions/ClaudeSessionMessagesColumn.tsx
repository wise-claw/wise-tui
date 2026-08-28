import { useEffect, useRef, type RefObject } from "react";
import type { ClaudeSession } from "../../types";
import { CHAT_MESSAGES_SCROLLING_CLASS } from "../../constants/chatScrollPerformance";
import {
  isClaudeChatSessionStreaming,
  useChatMessagesPointerBusy,
} from "../../hooks/useChatMessagesPointerBusy";
import { useChatMessageListRows } from "../../hooks/useChatMessageListRows";
import { useScrollEndClass } from "../../hooks/useScrollEndClass";
import { ChatMessageListVirtualBody } from "./ChatMessageListVirtualBody";
import { ChatRepositoryProvider } from "./chatRepositoryContext";
import "./index.css";
import type { SessionDispatchLookup } from "../../utils/claudeChatMessageDisplay";

interface Props {
  session: ClaudeSession;
  onOpenTaskDetail?: (taskId: string) => void;
  onOpenHistorySessionInInspector?: (sessionId: string) => void;
  sessionsForDispatchLookup?: SessionDispatchLookup;
  /** @deprecated 虚拟列表按条数阈值自动启用，该开关保留仅为兼容旧调用方 */
  showAllMessages?: boolean;
  /** 绑定到消息滚动容器，供父组件在内容增高时 `scrollTop = scrollHeight` */
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  listVariant?: "chat" | "monitor";
  pinUserMessages?: boolean;
}

export function ClaudeSessionMessagesColumn({
  session,
  onOpenTaskDetail,
  onOpenHistorySessionInInspector,
  sessionsForDispatchLookup,
  scrollContainerRef,
  listVariant = "monitor",
  pinUserMessages = true,
}: Props) {
  const internalScrollRef = useRef<HTMLDivElement>(null);
  const scrollRef = scrollContainerRef ?? internalScrollRef;
  const rows = useChatMessageListRows(session);
  const streamingActive = isClaudeChatSessionStreaming(session.status);
  useScrollEndClass(scrollRef, CHAT_MESSAGES_SCROLLING_CLASS, 240, {
    deferLiveSessionUpdates: true,
  });
  useChatMessagesPointerBusy(scrollRef, streamingActive);

  // 流式执行中自动贴底（监控列）：仅运行/连接中跟随，历史/空闲会话不打扰；
  // 用户在流式期间上翻阅读时暂停，回到底部阈值内后继续跟随。
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc || !streamingActive) return;
    let pinned = true;
    let raf = 0;
    const maxScrollTop = () => Math.max(0, sc.scrollHeight - sc.clientHeight);
    const followTick = () => {
      raf = 0;
      const max = maxScrollTop();
      if (pinned && sc.scrollTop < max - 2) {
        sc.scrollTop = max;
      }
    };
    const onScroll = () => {
      pinned = maxScrollTop() - sc.scrollTop <= 24;
      if (raf === 0) raf = window.requestAnimationFrame(followTick);
    };
    sc.addEventListener("scroll", onScroll, { passive: true });
    // 虚拟窗口行替换/追加不一定触发 scroll：用 MutationObserver 补拍。
    const mo = new MutationObserver(() => {
      if (raf === 0) raf = window.requestAnimationFrame(followTick);
    });
    mo.observe(sc, { childList: true, subtree: true });
    raf = window.requestAnimationFrame(followTick);
    return () => {
      sc.removeEventListener("scroll", onScroll);
      mo.disconnect();
      if (raf !== 0) window.cancelAnimationFrame(raf);
    };
  }, [scrollRef, streamingActive]);

  return (
    <div className="app-claude-chat app-claude-session-messages-column">
      <div ref={scrollRef} className="app-claude-messages">
        {rows.length === 0 ? (
          <div className="app-claude-messages-empty">
            <p>暂无消息</p>
          </div>
        ) : (
          <ChatRepositoryProvider repositoryPath={session.repositoryPath}>
            <ChatMessageListVirtualBody
              rows={rows}
              scrollContainerRef={scrollRef}
              listResetKey={session.id}
              listVariant={listVariant}
              pinUserMessages={pinUserMessages}
              onOpenTaskDetail={onOpenTaskDetail}
              onOpenHistorySessionInInspector={onOpenHistorySessionInInspector}
              sessionsForDispatchLookup={sessionsForDispatchLookup}
              transcriptMemoryUnlimited={session.transcriptMemoryUnlimited}
            />
          </ChatRepositoryProvider>
        )}
      </div>
    </div>
  );
}
