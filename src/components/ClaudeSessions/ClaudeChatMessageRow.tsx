import { memo, useMemo, type ReactNode } from "react";
import type { ClaudeMessage, ClaudeSession, SessionConversationTaskItem } from "../../types";
import type { DispatchRecordMeta } from "../../utils/claudeChatMessageDisplay";
import { MessagePartsDisplay } from "./MessageParts";
import { Markdown } from "./Markdown";
import { SystemMessageContent } from "./SystemMessageContent";
import { assistantOrphanMarkdownText } from "../../utils/assistantOrphanMarkdown";
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

function ClaudeChatMessageRowInner({
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

  function renderSystemBody(): ReactNode {
    if (!systemPlainText) {
      return null;
    }
    if (!dispatchMeta) {
      return <SystemMessageContent text={systemPlainText} />;
    }
    return (
      <DispatchRecordMessage
        dispatch={dispatchMeta}
        sessionsForDispatchLookup={sessionsForDispatchLookup}
        resolveExecutionEnvironmentDispatchTask={resolveExecutionEnvironmentDispatchTask}
        onOpenHistorySessionInInspector={onOpenHistorySessionInInspector}
        onOpenTaskDetail={onOpenTaskDetail}
        onOpenSessionConversationTaskDetail={onOpenSessionConversationTaskDetail}
      />
    );
  }

  function renderChatBody() {
    const orphanMarkdown = msg.role === "assistant" ? assistantOrphanMarkdownText(msg) : "";
    if (msg.parts && msg.parts.length > 0) {
      return (
        <>
          <MessagePartsDisplay parts={msg.parts} streaming={streamingThisBubble} inlinePendingHint={false} />
          {orphanMarkdown ? (
            <div className="app-message-part app-message-part--text app-message-part--completion-summary">
              <Markdown text={orphanMarkdown} streaming={false} showPendingHint={false} />
            </div>
          ) : null}
        </>
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

  const showSender = !mergedWithPrevious && (toolUser || (msg.role !== "user" && msg.role !== "assistant"));
  const visibleBody = msg.role === "system" ? renderSystemBody() : renderNonSystemContent();
  if (!visibleBody || !hasRenderableChatMessageBody(msg)) {
    return null;
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
        {showSender ? (
          <div className="app-claude-message-header">
            <div className="app-claude-message-header-leading">
              <span className="app-claude-message-sender">
                {toolUser ? "工具" : "系统"}
              </span>
              <ChatMessageRowActions
                sessionId={sessionId}
                msg={msg}
                copyText={copyText}
                toolUser={toolUser}
                sessionsForDispatchLookup={sessionsForDispatchLookup}
              />
            </div>
          </div>
        ) : (
          <ChatMessageRowActions
            sessionId={sessionId}
            msg={msg}
            copyText={copyText}
            toolUser={toolUser}
            sessionsForDispatchLookup={sessionsForDispatchLookup}
            floating
          />
        )}
        <div className="app-claude-message-content">{visibleBody}</div>
      </div>
    </div>
  );
}

function rowPropsEqual(prev: Readonly<Props>, next: Readonly<Props>): boolean {
  return (
    prev.msg === next.msg &&
    prev.streamingThisBubble === next.streamingThisBubble &&
    prev.mergedWithPrevious === next.mergedWithPrevious &&
    prev.sessionId === next.sessionId &&
    prev.toolUser === next.toolUser &&
    prev.onOpenTaskDetail === next.onOpenTaskDetail &&
    prev.onOpenHistorySessionInInspector === next.onOpenHistorySessionInInspector &&
    prev.onOpenSessionConversationTaskDetail === next.onOpenSessionConversationTaskDetail &&
    prev.resolveExecutionEnvironmentDispatchTask === next.resolveExecutionEnvironmentDispatchTask &&
    prev.sessionsForDispatchLookup === next.sessionsForDispatchLookup
  );
}

export const ClaudeChatMessageRow = memo(ClaudeChatMessageRowInner, rowPropsEqual);
