import { memo } from "react";
import type { ClaudeSession, SessionConversationTaskItem } from "../../types";
import type { ChatMessageListRow } from "../../utils/claudeChatMessageListRows";
import { ClaudeChatMessageRow } from "./ClaudeChatMessageRow";
import { ClaudeSessionMonitorMessageRow } from "./ClaudeSessionMonitorMessageRow";
import { StreamingReplyHint } from "./Markdown";
import type { ExecutionEnvironmentDispatchRecord } from "../../stores/executionEnvironmentDispatchStore";

interface Props {
  row: ChatMessageListRow;
  sessionId?: string;
  listVariant?: "chat" | "monitor";
  anchorSession?: ClaudeSession | null;
  executionEnvironmentDispatchRecords?: readonly ExecutionEnvironmentDispatchRecord[];
  onOpenTaskDetail?: (taskId: string) => void;
  onOpenHistorySessionInInspector?: (sessionId: string) => void;
  onOpenSessionConversationTaskDetail?: (task: SessionConversationTaskItem) => void;
  sessionsForDispatchLookup?: readonly ClaudeSession[];
}

function ChatMessageListRowContentInner({
  row,
  sessionId,
  listVariant = "chat",
  anchorSession,
  executionEnvironmentDispatchRecords,
  onOpenTaskDetail,
  onOpenHistorySessionInInspector,
  onOpenSessionConversationTaskDetail,
  sessionsForDispatchLookup,
}: Props) {
  if (row.kind === "thinking-hint") {
    return (
      <div className="app-claude-messages-end-thinking">
        <StreamingReplyHint />
      </div>
    );
  }
  if (listVariant === "monitor") {
    return (
      <ClaudeSessionMonitorMessageRow
        sessionId={sessionId}
        msg={row.msg}
        streamingThisBubble={row.streamingThisBubble}
        mergedWithPrevious={row.mergedWithPrevious}
        toolUser={row.toolUser}
        anchorSession={anchorSession}
        executionEnvironmentDispatchRecords={executionEnvironmentDispatchRecords}
        onOpenTaskDetail={onOpenTaskDetail}
        onOpenHistorySessionInInspector={onOpenHistorySessionInInspector}
        onOpenSessionConversationTaskDetail={onOpenSessionConversationTaskDetail}
        sessionsForDispatchLookup={sessionsForDispatchLookup}
      />
    );
  }
  return (
    <ClaudeChatMessageRow
      sessionId={sessionId}
      msg={row.msg}
      streamingThisBubble={row.streamingThisBubble}
      mergedWithPrevious={row.mergedWithPrevious}
      toolUser={row.toolUser}
      anchorSession={anchorSession}
      executionEnvironmentDispatchRecords={executionEnvironmentDispatchRecords}
      onOpenTaskDetail={onOpenTaskDetail}
      onOpenHistorySessionInInspector={onOpenHistorySessionInInspector}
      onOpenSessionConversationTaskDetail={onOpenSessionConversationTaskDetail}
      sessionsForDispatchLookup={sessionsForDispatchLookup}
    />
  );
}

function rowContentEqual(prev: Readonly<Props>, next: Readonly<Props>): boolean {
  if (prev.sessionId !== next.sessionId) return false;
  if (prev.listVariant !== next.listVariant) return false;
  if (prev.onOpenTaskDetail !== next.onOpenTaskDetail) return false;
  if (prev.onOpenHistorySessionInInspector !== next.onOpenHistorySessionInInspector) return false;
  if (prev.onOpenSessionConversationTaskDetail !== next.onOpenSessionConversationTaskDetail) return false;
  if (prev.anchorSession !== next.anchorSession) return false;
  if (prev.executionEnvironmentDispatchRecords !== next.executionEnvironmentDispatchRecords) return false;
  if (prev.sessionsForDispatchLookup !== next.sessionsForDispatchLookup) return false;
  if (prev.row === next.row) return true;
  if (prev.row.kind !== next.row.kind) return false;
  if (prev.row.kind === "thinking-hint" || next.row.kind === "thinking-hint") {
    return prev.row.kind === "thinking-hint" && next.row.kind === "thinking-hint";
  }
  return (
    prev.row.msg === next.row.msg &&
    prev.row.streamingThisBubble === next.row.streamingThisBubble &&
    prev.row.mergedWithPrevious === next.row.mergedWithPrevious &&
    prev.row.toolUser === next.row.toolUser
  );
}

export const ChatMessageListRowContent = memo(ChatMessageListRowContentInner, rowContentEqual);
