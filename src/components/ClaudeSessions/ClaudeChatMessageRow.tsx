import { memo, useMemo, type ReactNode } from "react";
import type { ClaudeMessage, SessionConversationTaskItem } from "../../types";
import type { DispatchRecordMeta, SessionDispatchLookup } from "../../utils/claudeChatMessageDisplay";
import { MessagePartsDisplay } from "./MessageParts";
import { Markdown } from "./Markdown";
import { SystemMessageContent } from "./SystemMessageContent";
import { assistantOrphanMarkdownText, chatAssistantTextPartClassNames } from "../../utils/assistantOrphanMarkdown";
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
  sessionsForDispatchLookup?: SessionDispatchLookup;
  onReplayUserMessage?: (prompt: string) => void;
}

function renderAssistantMarkdownPart(
  text: string,
  streaming: boolean,
  partClassName?: string,
  markdownClassName?: string,
) {
  const classes = partClassName
    ? { partClassName, markdownClassName }
    : chatAssistantTextPartClassNames(text);
  return (
    <div className={classes.partClassName}>
      <Markdown
        text={text}
        streaming={streaming}
        showPendingHint={false}
        className={classes.markdownClassName}
      />
    </div>
  );
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
  onReplayUserMessage,
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
    // orphan Markdown 检测用于「完成后 content/parts 不同步」场景；流式期 parts 正在生成、跳过以避免每 token 跑遍历+正则。
    const orphanMarkdown =
      msg.role === "assistant" && !streamingThisBubble ? assistantOrphanMarkdownText(msg) : "";
    if (msg.parts && msg.parts.length > 0) {
      return (
        <>
          <MessagePartsDisplay parts={msg.parts} streaming={streamingThisBubble} inlinePendingHint={false} />
          {orphanMarkdown ? renderAssistantMarkdownPart(orphanMarkdown, false) : null}
        </>
      );
    }
    const text = msg.content ?? "";
    if (isBlankDisplayText(text)) return null;
    if (msg.role === "assistant" && isAssistantDisplayNoiseText(text)) return null;
    const { partClassName, markdownClassName } = chatAssistantTextPartClassNames(text);
    return renderAssistantMarkdownPart(text, streamingThisBubble, partClassName, markdownClassName);
  }

  function renderNonSystemContent() {
    if (msg.role === "user" && !toolUser) {
      return <UserMessageDisplayBody msg={msg} streaming={streamingThisBubble} />;
    }
    return renderChatBody();
  }

  // 用户消息使用独立的 sticky 行；滚动到下一条用户消息时，上一条会自然让位。
  const visibleBody = msg.role === "system" ? renderSystemBody() : renderNonSystemContent();
  if (!visibleBody || !hasRenderableChatMessageBody(msg)) {
    return null;
  }

  return (
    <div
      data-message-id={String(msg.id)}
      className={`app-claude-message app-claude-message--${msg.role}${toolUser ? " app-claude-message--tool-user" : ""}${!toolUser && msg.role === "user" && !mergedWithPrevious ? " app-claude-message--user-sticky" : ""}${mergedWithPrevious ? " app-claude-message--merged" : ""}${streamingThisBubble ? " app-claude-message--streaming" : ""}`}
    >
      <div className="app-claude-message-body">
        <ChatMessageRowActions
          sessionId={sessionId}
          msg={msg}
          copyText={copyText}
          toolUser={toolUser}
          sessionsForDispatchLookup={sessionsForDispatchLookup}
          onReplayUserMessage={msg.role === "user" && !toolUser ? onReplayUserMessage : undefined}
          floating
        />
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
    && prev.onReplayUserMessage === next.onReplayUserMessage
  );
}

export const ClaudeChatMessageRow = memo(ClaudeChatMessageRowInner, rowPropsEqual);
