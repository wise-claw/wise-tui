import { memo, type ReactNode } from "react";
import type { ClaudeMessage } from "../../types";
import { MessagePartsDisplay } from "./MessageParts";
import { Markdown } from "./Markdown";
import { SystemMessageContent } from "./SystemMessageContent";
import {
  parseDispatchRecord,
  systemMessagePlainText,
} from "../../utils/claudeChatMessageDisplay";
import { UserMessageCollapsibleBody } from "./UserMessageCollapsibleBody";

interface Props {
  msg: ClaudeMessage;
  streamingThisBubble: boolean;
  mergedWithPrevious: boolean;
  toolUser: boolean;
  onOpenTaskDetail?: (taskId: string) => void;
}

function ClaudeChatMessageRowInner({
  msg,
  streamingThisBubble,
  mergedWithPrevious,
  toolUser,
  onOpenTaskDetail,
}: Props) {
  function renderSystemBody(): ReactNode {
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
  }

  const showSender = !mergedWithPrevious && (toolUser || (msg.role !== "user" && msg.role !== "assistant"));

  function renderChatBody() {
    if (msg.parts && msg.parts.length > 0) {
      return (
        <MessagePartsDisplay parts={msg.parts} streaming={streamingThisBubble} inlinePendingHint={false} />
      );
    }
    return (
      <div className="app-message-part app-message-part--text">
        <Markdown text={msg.content} streaming={streamingThisBubble} showPendingHint={false} />
      </div>
    );
  }

  function renderNonSystemContent() {
    const body = renderChatBody();
    if (msg.role === "user" && !toolUser) {
      return <UserMessageCollapsibleBody>{body}</UserMessageCollapsibleBody>;
    }
    return body;
  }

  return (
    <div
      data-message-id={String(msg.id)}
      className={`app-claude-message app-claude-message--${msg.role}${toolUser ? " app-claude-message--tool-user" : ""}${mergedWithPrevious ? " app-claude-message--merged" : ""}`}
    >
      <div className="app-claude-message-avatar" aria-hidden={mergedWithPrevious ? true : undefined}>
        {toolUser ? "具" : msg.role === "user" ? "我" : msg.role === "assistant" ? "C" : "S"}
      </div>
      <div className="app-claude-message-body">
        {showSender && (
          <div className="app-claude-message-header">
            <span className="app-claude-message-sender">
              {toolUser ? "工具" : "系统"}
            </span>
          </div>
        )}
        <div className="app-claude-message-content">
          {msg.role === "system" ? renderSystemBody() : renderNonSystemContent()}
        </div>
      </div>
    </div>
  );
}

function rowPropsEqual(prev: Readonly<Props>, next: Readonly<Props>): boolean {
  return (
    prev.msg === next.msg &&
    prev.streamingThisBubble === next.streamingThisBubble &&
    prev.mergedWithPrevious === next.mergedWithPrevious &&
    prev.toolUser === next.toolUser &&
    prev.onOpenTaskDetail === next.onOpenTaskDetail
  );
}

export const ClaudeChatMessageRow = memo(ClaudeChatMessageRowInner, rowPropsEqual);
