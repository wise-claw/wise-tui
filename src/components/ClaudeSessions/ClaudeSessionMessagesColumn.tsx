import { useMemo, useRef, type RefObject } from "react";
import type { ClaudeSession } from "../../types";
import { shouldShowListEndThinkingHint } from "../../utils/claudeChatMessageListRows";
import { ClaudeVirtualMessageList } from "./ClaudeVirtualMessageList";
import "./index.css";

interface Props {
  session: ClaudeSession;
  onOpenTaskDetail?: (taskId: string) => void;
  /** @deprecated 虚拟列表已渲染全部可展示消息，该开关保留仅为兼容旧调用方 */
  showAllMessages?: boolean;
  /** 绑定到消息滚动容器，供父组件在内容增高时 `scrollTop = scrollHeight` */
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
}

export function ClaudeSessionMessagesColumn({
  session,
  onOpenTaskDetail,
  scrollContainerRef,
}: Props) {
  const internalScrollRef = useRef<HTMLDivElement>(null);
  const scrollRef = scrollContainerRef ?? internalScrollRef;

  const showListEndThinkingHint = useMemo(
    () => shouldShowListEndThinkingHint(session.messages, session.status),
    [session.messages, session.status],
  );

  return (
    <div className="app-claude-chat app-claude-session-messages-column">
      <div ref={scrollRef} className="app-claude-messages">
        {session.messages.length === 0 ? (
          <div className="app-claude-messages-empty">
            <p>暂无消息</p>
          </div>
        ) : (
          <ClaudeVirtualMessageList
            session={session}
            showListEndThinkingHint={showListEndThinkingHint}
            scrollContainerRef={scrollRef}
            onOpenTaskDetail={onOpenTaskDetail}
            listVariant="monitor"
          />
        )}
      </div>
    </div>
  );
}
