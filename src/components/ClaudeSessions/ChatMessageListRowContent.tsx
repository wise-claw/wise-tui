import { memo } from "react";
import type { ClaudeSession } from "../../types";
import type { ChatMessageListRow } from "../../utils/claudeChatMessageListRows";
import { ClaudeChatMessageRow } from "./ClaudeChatMessageRow";
import { ClaudeSessionMonitorMessageRow } from "./ClaudeSessionMonitorMessageRow";
import { StreamingReplyHint } from "./Markdown";

interface Props {
  row: ChatMessageListRow;
  listVariant?: "chat" | "monitor";
  onOpenTaskDetail?: (taskId: string) => void;
  onOpenHistorySessionInInspector?: (sessionId: string) => void;
  sessionsForDispatchLookup?: readonly ClaudeSession[];
}

function ChatMessageListRowContentInner({
  row,
  listVariant = "chat",
  onOpenTaskDetail,
  onOpenHistorySessionInInspector,
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
        msg={row.msg}
        streamingThisBubble={row.streamingThisBubble}
        mergedWithPrevious={row.mergedWithPrevious}
        toolUser={row.toolUser}
        onOpenTaskDetail={onOpenTaskDetail}
        onOpenHistorySessionInInspector={onOpenHistorySessionInInspector}
        sessionsForDispatchLookup={sessionsForDispatchLookup}
      />
    );
  }
  return (
    <ClaudeChatMessageRow
      msg={row.msg}
      streamingThisBubble={row.streamingThisBubble}
      mergedWithPrevious={row.mergedWithPrevious}
      toolUser={row.toolUser}
      onOpenTaskDetail={onOpenTaskDetail}
      onOpenHistorySessionInInspector={onOpenHistorySessionInInspector}
      sessionsForDispatchLookup={sessionsForDispatchLookup}
    />
  );
}

function rowContentEqual(prev: Readonly<Props>, next: Readonly<Props>): boolean {
  if (prev.listVariant !== next.listVariant) return false;
  if (prev.onOpenTaskDetail !== next.onOpenTaskDetail) return false;
  if (prev.onOpenHistorySessionInInspector !== next.onOpenHistorySessionInInspector) return false;
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
