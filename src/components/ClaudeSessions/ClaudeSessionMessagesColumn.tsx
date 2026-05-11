import { useEffect, useState, type RefObject } from "react";
import type { ClaudeMessage, ClaudeSession } from "../../types";
import {
  CLAUDE_MESSAGE_LIST_INITIAL_VISIBLE,
  CLAUDE_MESSAGE_LIST_LOAD_MORE_STEP,
} from "../../constants/claudeMessageListWindow";
import { MessagePartsDisplay } from "./MessageParts";
import { Markdown, StreamingReplyHint } from "./Markdown";
import { SystemMessageContent } from "./SystemMessageContent";
import { formatChatMessageListTime } from "../../utils/formatChatMessageListTime";
import "./index.css";

function isToolOnlyUserMessage(msg: ClaudeMessage): boolean {
  const parts = msg.parts;
  return msg.role === "user" && Array.isArray(parts) && parts.length > 0 && parts.every((p) => p.type === "tool_use");
}

function getMessageSenderGroupKey(msg: ClaudeMessage): string {
  if (msg.role === "system") return "system";
  if (msg.role === "assistant") return "assistant";
  if (msg.role === "user") {
    if (isToolOnlyUserMessage(msg)) return "assistant";
    return "user:normal";
  }
  return msg.role;
}

function systemMessagePlainText(msg: ClaudeMessage): string {
  const fromParts = msg.parts
    ?.filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n\n");
  if (fromParts?.trim()) return fromParts;
  return msg.content;
}

interface DispatchRecordMeta {
  dispatchType?: string;
  targetName?: string;
  targetSessionId?: string;
  taskId?: string;
  dispatchTime?: string;
}

function parseDispatchRecord(text: string): DispatchRecordMeta | null {
  const lines = text.split("\n").map((line) => line.trim());
  if (lines[0] !== "任务分发记录") return null;
  const meta: DispatchRecordMeta = {};
  for (const line of lines.slice(1)) {
    if (!line.startsWith("- ")) continue;
    const payload = line.slice(2);
    const idx = payload.indexOf("：");
    if (idx < 0) continue;
    const key = payload.slice(0, idx).trim();
    const value = payload.slice(idx + 1).trim();
    if (!value) continue;
    if (key === "类型") meta.dispatchType = value;
    if (key === "目标") meta.targetName = value;
    if (key === "分发会话") meta.targetSessionId = value;
    if (key === "任务ID") meta.taskId = value;
    if (key === "时间") meta.dispatchTime = value;
  }
  return meta;
}

interface Props {
  session: ClaudeSession;
  onOpenTaskDetail?: (taskId: string) => void;
  /** 为 true 时不做首屏条数截断，一次性展示全部消息（监控抽屉等只读窥屏） */
  showAllMessages?: boolean;
  /** 绑定到消息滚动容器，供父组件在内容增高时 `scrollTop = scrollHeight` */
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
}

export function ClaudeSessionMessagesColumn({
  session,
  onOpenTaskDetail,
  showAllMessages = false,
  scrollContainerRef,
}: Props) {
  const [visibleMessageCount, setVisibleMessageCount] = useState(() =>
    showAllMessages
      ? session.messages.length
      : Math.min(session.messages.length, CLAUDE_MESSAGE_LIST_INITIAL_VISIBLE),
  );

  useEffect(() => {
    if (showAllMessages) {
      setVisibleMessageCount(session.messages.length);
      return;
    }
    setVisibleMessageCount(Math.min(session.messages.length, CLAUDE_MESSAGE_LIST_INITIAL_VISIBLE));
  }, [session.id, showAllMessages, showAllMessages ? session.messages.length : 0]);

  const hiddenMessageCount = showAllMessages
    ? 0
    : Math.max(0, session.messages.length - visibleMessageCount);
  const visibleMessages =
    showAllMessages || hiddenMessageCount === 0 ? session.messages : session.messages.slice(-visibleMessageCount);

  const sessionLastIndex = session.messages.length - 1;
  const sessionLastMessage = sessionLastIndex >= 0 ? session.messages[sessionLastIndex]! : null;
  const showListEndThinkingHint =
    session.status === "running" &&
    sessionLastMessage !== null &&
    (sessionLastMessage.role === "user" || sessionLastMessage.role === "assistant");

  return (
    <div className="app-claude-chat app-claude-session-messages-column">
      <div ref={scrollContainerRef} className="app-claude-messages">
        {session.messages.length === 0 ? (
          <div className="app-claude-messages-empty">
            <p>暂无消息</p>
          </div>
        ) : null}
        {!showAllMessages && hiddenMessageCount > 0 ? (
          <div className="app-claude-messages-load-more">
            <button
              type="button"
              className="app-claude-messages-load-more__btn"
              onClick={() => {
                setVisibleMessageCount((prev) =>
                  Math.min(session.messages.length, prev + CLAUDE_MESSAGE_LIST_LOAD_MORE_STEP),
                );
              }}
            >
              显示更早消息（{hiddenMessageCount} 条）
            </button>
          </div>
        ) : null}
        {visibleMessages.map((msg, index) => {
          const originalIndex = hiddenMessageCount + index;
          const streamingThisBubble =
            session.status === "running" &&
            msg.role === "assistant" &&
            originalIndex === sessionLastIndex;

          const toolUser = isToolOnlyUserMessage(msg);
          const prevInSession = originalIndex > 0 ? session.messages[originalIndex - 1] : undefined;
          const mergedWithPrevious =
            prevInSession !== undefined && getMessageSenderGroupKey(prevInSession) === getMessageSenderGroupKey(msg);
          return (
            <div
              key={msg.id}
              data-message-id={String(msg.id)}
              className={`app-claude-message app-claude-message--${msg.role}${toolUser ? " app-claude-message--tool-user" : ""}${mergedWithPrevious ? " app-claude-message--merged" : ""}`}
            >
              <div className="app-claude-message-avatar" aria-hidden={mergedWithPrevious ? true : undefined}>
                {toolUser ? "具" : msg.role === "user" ? "我" : msg.role === "assistant" ? "C" : "S"}
              </div>
              <div className="app-claude-message-body">
                {mergedWithPrevious ? null : (
                  <div className="app-claude-message-header">
                    <span className="app-claude-message-sender">
                      {toolUser ? "工具" : msg.role === "user" ? "我" : msg.role === "assistant" ? "Claude" : "系统"}
                    </span>
                    <span className="app-claude-message-time" title={new Date(msg.timestamp).toLocaleString("zh-CN")}>
                      {formatChatMessageListTime(msg.timestamp)}
                    </span>
                  </div>
                )}
                <div className="app-claude-message-content">
                  {msg.role === "system"
                    ? (() => {
                        const raw = systemMessagePlainText(msg);
                        const dispatch = parseDispatchRecord(raw);
                        if (!dispatch) {
                          return <SystemMessageContent text={raw} />;
                        }
                        return (
                          <div className="app-system-dispatch-card">
                            <div className="app-system-dispatch-card__head">
                              <div className="app-system-dispatch-card__title">任务分发记录</div>
                            </div>
                            <div className="app-system-dispatch-card__meta">
                              <div className="app-system-dispatch-card__meta-row">
                                <span className="app-system-dispatch-card__meta-label">类型</span>
                                <span className="app-system-dispatch-card__meta-value">{dispatch.dispatchType ?? "-"}</span>
                              </div>
                              <div className="app-system-dispatch-card__meta-row">
                                <span className="app-system-dispatch-card__meta-label">目标</span>
                                <span className="app-system-dispatch-card__meta-value">{dispatch.targetName ?? "-"}</span>
                              </div>
                              {dispatch.dispatchTime ? (
                                <div className="app-system-dispatch-card__meta-row">
                                  <span className="app-system-dispatch-card__meta-label">时间</span>
                                  <span className="app-system-dispatch-card__meta-value">{dispatch.dispatchTime}</span>
                                </div>
                              ) : null}
                            </div>
                            <div className="app-system-dispatch-card__actions">
                              {dispatch.taskId ? (
                                <button
                                  type="button"
                                  className="app-system-dispatch-card__btn"
                                  onClick={() => onOpenTaskDetail?.(dispatch.taskId!)}
                                >
                                  查看任务详情
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })()
                    : msg.parts && msg.parts.length > 0 ? (
                      <MessagePartsDisplay parts={msg.parts} streaming={streamingThisBubble} inlinePendingHint={false} />
                    ) : (
                      <div className="app-message-part app-message-part--text">
                        <Markdown
                          text={msg.content}
                          streaming={streamingThisBubble}
                          showPendingHint={false}
                        />
                      </div>
                    )}
                </div>
              </div>
            </div>
          );
        })}
        {showListEndThinkingHint ? (
          <div className="app-claude-messages-end-thinking">
            <StreamingReplyHint />
          </div>
        ) : null}
      </div>
    </div>
  );
}
