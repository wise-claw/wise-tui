import { memo, useMemo, type ReactNode } from "react";
import type { ClaudeMessage, ClaudeSession, SessionConversationTaskItem } from "../../types";
import type { DispatchRecordMeta } from "../../utils/claudeChatMessageDisplay";
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
import { formatChatMessageListTime } from "../../utils/formatChatMessageListTime";

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
}: Props) {
  const copyText = useChatMessageCopyText(msg, sessionsForDispatchLookup);
  // timestamp 为消息创建时的原始值、流式期不变；memo 避免每 token 调用 Intl toLocaleString。
  const timeTitle = useMemo(
    () => new Date(msg.timestamp).toLocaleString("zh-CN"),
    [msg.timestamp],
  );
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

  // 非合并行（一组的首条）统一展示发送者标签 + 时间戳，便于扫读对话轮次；
  // 合并行（与上一条同发送者）仅保留浮动操作，纵向成组。
  const showHeader = !mergedWithPrevious;
  const senderLabel = toolUser
    ? "工具"
    : msg.role === "user"
      ? "我"
      : msg.role === "assistant"
        ? "Claude"
        : "系统";
  const visibleBody = msg.role === "system" ? renderSystemBody() : renderNonSystemContent();
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
        {showHeader ? (
          <div className="app-claude-message-header">
            <div className="app-claude-message-header-leading">
              <span className="app-claude-message-sender">{senderLabel}</span>
              <ChatMessageRowActions
                sessionId={sessionId}
                msg={msg}
                copyText={copyText}
                toolUser={toolUser}
                sessionsForDispatchLookup={sessionsForDispatchLookup}
              />
            </div>
            <span className="app-claude-message-time" title={timeTitle}>
              {formatChatMessageListTime(msg.timestamp)}
            </span>
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
