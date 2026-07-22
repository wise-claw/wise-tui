import { memo, useMemo } from "react";
import type { ClaudeMessage, ClaudeSession, SessionConversationTaskItem } from "../../types";
import type { DispatchRecordMeta } from "../../utils/claudeChatMessageDisplay";
import { MessagePartsDisplay } from "./MessageParts";
import { Markdown } from "./Markdown";
import { SystemMessageContent } from "./SystemMessageContent";
import { formatChatMessageListTime } from "../../utils/formatChatMessageListTime";
import {
  hasRenderableChatMessageBody,
  isAssistantDisplayNoiseText,
  isBlankDisplayText,
  parseDispatchRecord,
  systemMessagePlainText,
} from "../../utils/claudeChatMessageDisplay";
import { DispatchRecordMessage } from "./DispatchRecordMessage";
import { UserMessageDisplayBody } from "./UserMessageDisplayBody";
import { ChatMessageRowActions } from "./ChatMessageRowActions";
import { useChatMessageCopyText } from "./useChatMessageCopyText";

interface Props {
  sessionId?: string;
  msg: ClaudeMessage;
  streamingThisBubble: boolean;
  mergedWithPrevious: boolean;
  toolUser: boolean;
  resolveExecutionEnvironmentDispatchTask?: (meta: DispatchRecordMeta) => SessionConversationTaskItem | null;
  onOpenTaskDetail?: (taskId: string) => void;
  onOpenHistorySessionInInspector?: (sessionId: string) => void;
  onOpenSessionConversationTaskDetail?: (task: SessionConversationTaskItem) => void;
  sessionsForDispatchLookup?: readonly ClaudeSession[];
}

function ClaudeSessionMonitorMessageRowInner({
  sessionId,
  msg,
  streamingThisBubble,
  mergedWithPrevious,
  toolUser,
  resolveExecutionEnvironmentDispatchTask,
  onOpenTaskDetail,
  onOpenHistorySessionInInspector,
  onOpenSessionConversationTaskDetail,
  sessionsForDispatchLookup,
}: Props) {
  const copyText = useChatMessageCopyText(msg, sessionsForDispatchLookup);
  const systemPlainText = useMemo(
    () => (msg.role === "system" ? systemMessagePlainText(msg) : ""),
    [msg],
  );
  const dispatchMeta = useMemo(
    () => (systemPlainText ? parseDispatchRecord(systemPlainText) : null),
    [systemPlainText],
  );

  function renderChatBody() {
    if (msg.parts && msg.parts.length > 0) {
      return (
        <MessagePartsDisplay parts={msg.parts} streaming={streamingThisBubble} inlinePendingHint={false} />
      );
    }
    const text = msg.content ?? "";
    if (isBlankDisplayText(text)) return null;
    if (msg.role === "assistant" && isAssistantDisplayNoiseText(text)) return null;
    return (
      <div className="app-message-part app-message-part--text">
        <Markdown text={text} streaming={streamingThisBubble} showPendingHint={false} />
      </div>
    );
  }

  function renderNonSystemContent() {
    if (msg.role === "user" && !toolUser) {
      return <UserMessageDisplayBody msg={msg} streaming={streamingThisBubble} />;
    }
    return renderChatBody();
  }

  const visibleBody =
    msg.role === "system"
      ? dispatchMeta
        ? (
            <DispatchRecordMessage
              dispatch={dispatchMeta}
              sessionsForDispatchLookup={sessionsForDispatchLookup}
              resolveExecutionEnvironmentDispatchTask={resolveExecutionEnvironmentDispatchTask}
              onOpenHistorySessionInInspector={onOpenHistorySessionInInspector}
              onOpenTaskDetail={onOpenTaskDetail}
              onOpenSessionConversationTaskDetail={onOpenSessionConversationTaskDetail}
            />
          )
        : systemPlainText
          ? <SystemMessageContent text={systemPlainText} />
          : null
      : renderNonSystemContent();
  if (!visibleBody || !hasRenderableChatMessageBody(msg)) {
    return null;
  }

  return (
    <div
      data-message-id={String(msg.id)}
      className={`app-claude-message app-claude-message--${msg.role}${toolUser ? " app-claude-message--tool-user" : ""}${mergedWithPrevious ? " app-claude-message--merged" : ""}${streamingThisBubble ? " app-claude-message--streaming" : ""}`}
    >
      <div className="app-claude-message-avatar" aria-hidden={mergedWithPrevious ? true : undefined}>
        {toolUser ? "具" : msg.role === "user" ? "我" : msg.role === "assistant" ? "C" : "S"}
      </div>
      <div className="app-claude-message-body">
        {!mergedWithPrevious ? (
          <span
            className="app-claude-message-time app-claude-message-time--overlay"
            title={new Date(msg.timestamp).toLocaleString("zh-CN")}
          >
            {formatChatMessageListTime(msg.timestamp)}
          </span>
        ) : null}
        <ChatMessageRowActions
          sessionId={sessionId}
          msg={msg}
          copyText={copyText}
          toolUser={toolUser}
          sessionsForDispatchLookup={sessionsForDispatchLookup}
          floating
        />
        <div className="app-claude-message-content">{visibleBody}</div>
      </div>
    </div>
  );
}

export const ClaudeSessionMonitorMessageRow = memo(ClaudeSessionMonitorMessageRowInner);
