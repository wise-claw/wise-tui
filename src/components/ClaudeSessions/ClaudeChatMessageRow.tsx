import { memo, type ReactNode } from "react";
import type { ClaudeMessage, ClaudeSession, SessionConversationTaskItem } from "../../types";
import { MessagePartsDisplay } from "./MessageParts";
import { Markdown } from "./Markdown";
import { SystemMessageContent } from "./SystemMessageContent";
import {
  parseDispatchRecord,
  systemMessagePlainText,
} from "../../utils/claudeChatMessageDisplay";
import { DispatchRecordMessage } from "./DispatchRecordMessage";
import { UserMessageCollapsibleBody } from "./UserMessageCollapsibleBody";
import { ChatMessageRowActions } from "./ChatMessageRowActions";
import { useChatMessageCopyText } from "./useChatMessageCopyText";
import type { ExecutionEnvironmentDispatchRecord } from "../../stores/executionEnvironmentDispatchStore";

interface Props {
  sessionId?: string;
  msg: ClaudeMessage;
  streamingThisBubble: boolean;
  mergedWithPrevious: boolean;
  toolUser: boolean;
  anchorSession?: ClaudeSession | null;
  executionEnvironmentDispatchRecords?: readonly ExecutionEnvironmentDispatchRecord[];
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
  anchorSession,
  executionEnvironmentDispatchRecords,
  onOpenTaskDetail,
  onOpenHistorySessionInInspector,
  onOpenSessionConversationTaskDetail,
  sessionsForDispatchLookup,
}: Props) {
  const copyText = useChatMessageCopyText(msg, sessionsForDispatchLookup);

  function renderSystemBody(): ReactNode {
    const raw = systemMessagePlainText(msg);
    const dispatch = parseDispatchRecord(raw);
    if (!dispatch) {
      return <SystemMessageContent text={raw} />;
    }
    return (
      <DispatchRecordMessage
        dispatch={dispatch}
        sessionsForDispatchLookup={sessionsForDispatchLookup}
        anchorSession={anchorSession}
        executionEnvironmentDispatchRecords={executionEnvironmentDispatchRecords}
        onOpenHistorySessionInInspector={onOpenHistorySessionInInspector}
        onOpenTaskDetail={onOpenTaskDetail}
        onOpenSessionConversationTaskDetail={onOpenSessionConversationTaskDetail}
      />
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
    prev.sessionId === next.sessionId &&
    prev.toolUser === next.toolUser &&
    prev.onOpenTaskDetail === next.onOpenTaskDetail &&
    prev.onOpenHistorySessionInInspector === next.onOpenHistorySessionInInspector &&
    prev.onOpenSessionConversationTaskDetail === next.onOpenSessionConversationTaskDetail &&
    prev.anchorSession === next.anchorSession &&
    prev.executionEnvironmentDispatchRecords === next.executionEnvironmentDispatchRecords &&
    prev.sessionsForDispatchLookup === next.sessionsForDispatchLookup
  );
}

export const ClaudeChatMessageRow = memo(ClaudeChatMessageRowInner, rowPropsEqual);
