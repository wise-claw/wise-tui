import { memo } from "react";
import type { ClaudeSession, SessionConversationTaskItem } from "../../types";
import type { DispatchRecordMeta } from "../../utils/claudeChatMessageDisplay";
import type { ChatMessageListRow } from "../../utils/claudeChatMessageListRows";
import { ClaudeChatMessageRow } from "./ClaudeChatMessageRow";
import { ClaudeSessionMonitorMessageRow } from "./ClaudeSessionMonitorMessageRow";
import { StreamingReplyHint } from "./Markdown";
import { TurnFilesChangedSummaryCard } from "./TurnFilesChangedSummaryCard";

interface Props {
  row: ChatMessageListRow;
  sessionId?: string;
  listVariant?: "chat" | "monitor";
  resolveExecutionEnvironmentDispatchTask?: (meta: DispatchRecordMeta) => SessionConversationTaskItem | null;
  onOpenTaskDetail?: (taskId: string) => void;
  onOpenHistorySessionInInspector?: (sessionId: string) => void;
  onOpenSessionConversationTaskDetail?: (task: SessionConversationTaskItem) => void;
  sessionsForDispatchLookup?: readonly ClaudeSession[];
}

function ChatMessageListRowContentInner({
  row,
  sessionId,
  listVariant = "chat",
  resolveExecutionEnvironmentDispatchTask,
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
  if (row.kind === "files-changed-summary") {
    if (listVariant === "monitor") return null;
    return <TurnFilesChangedSummaryCard files={row.files} />;
  }
  if (listVariant === "monitor") {
    return (
      <ClaudeSessionMonitorMessageRow
        sessionId={sessionId}
        msg={row.msg}
        streamingThisBubble={row.streamingThisBubble}
        mergedWithPrevious={row.mergedWithPrevious}
        toolUser={row.toolUser}
        resolveExecutionEnvironmentDispatchTask={resolveExecutionEnvironmentDispatchTask}
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
      resolveExecutionEnvironmentDispatchTask={resolveExecutionEnvironmentDispatchTask}
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
  if (prev.resolveExecutionEnvironmentDispatchTask !== next.resolveExecutionEnvironmentDispatchTask) return false;
  if (prev.sessionsForDispatchLookup !== next.sessionsForDispatchLookup) return false;
  if (prev.row === next.row) return true;
  if (prev.row.kind !== next.row.kind) return false;
  if (prev.row.kind === "thinking-hint" || next.row.kind === "thinking-hint") {
    return prev.row.kind === "thinking-hint" && next.row.kind === "thinking-hint";
  }
  if (prev.row.kind === "files-changed-summary" && next.row.kind === "files-changed-summary") {
    return prev.row.key === next.row.key && prev.row.files === next.row.files;
  }
  if (prev.row.kind !== "message" || next.row.kind !== "message") return false;
  return (
    prev.row.msg === next.row.msg &&
    prev.row.streamingThisBubble === next.row.streamingThisBubble &&
    prev.row.mergedWithPrevious === next.row.mergedWithPrevious &&
    prev.row.toolUser === next.row.toolUser
  );
}

export const ChatMessageListRowContent = memo(ChatMessageListRowContentInner, rowContentEqual);
