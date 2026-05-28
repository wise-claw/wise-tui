import { useMemo, useRef, type RefObject } from "react";
import type { ClaudeSession } from "../../types";
import {
  buildChatMessageListRows,
  shouldShowListEndThinkingHint,
} from "../../utils/claudeChatMessageListRows";
import { ClaudeSessionMonitorMessageRow } from "./ClaudeSessionMonitorMessageRow";
import { StreamingReplyHint } from "./Markdown";
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
  const rows = useMemo(
    () =>
      buildChatMessageListRows(session.messages, {
        sessionStatus: session.status,
        showListEndThinkingHint,
      }),
    [session.messages, session.status, showListEndThinkingHint],
  );

  return (
    <div className="app-claude-chat app-claude-session-messages-column">
      <div ref={scrollRef} className="app-claude-messages">
        {rows.length === 0 ? (
          <div className="app-claude-messages-empty">
            <p>暂无消息</p>
          </div>
        ) : (
          rows.map((row, index) => {
            const classNames = ["app-claude-messages-virtual-row"];
            if (index > 0 && row.kind !== "thinking-hint" && !row.mergedWithPrevious) {
              classNames.push("app-claude-messages-virtual-row--group-start");
            }
            if (row.kind === "message" && row.mergedWithPrevious) {
              classNames.push("app-claude-messages-virtual-row--merged");
            }
            return (
              <div key={row.key} className={classNames.join(" ")}>
                {row.kind === "thinking-hint" ? (
                  <div className="app-claude-messages-end-thinking">
                    <StreamingReplyHint />
                  </div>
                ) : (
                  <ClaudeSessionMonitorMessageRow
                    msg={row.msg}
                    streamingThisBubble={row.streamingThisBubble}
                    mergedWithPrevious={row.mergedWithPrevious}
                    toolUser={row.toolUser}
                    onOpenTaskDetail={onOpenTaskDetail}
                  />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
