import { useMemo, type RefObject } from "react";
import type { ClaudeSession } from "../../types";
import {
  buildChatMessageListRows,
  type ChatMessageListRow,
} from "../../utils/claudeChatMessageListRows";
import { ClaudeChatMessageRow } from "./ClaudeChatMessageRow";
import { ClaudeSessionMonitorMessageRow } from "./ClaudeSessionMonitorMessageRow";
import { StreamingReplyHint } from "./Markdown";

interface Props {
  session: ClaudeSession;
  showListEndThinkingHint: boolean;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  onOpenTaskDetail?: (taskId: string) => void;
  /** 主会话气泡 vs 监控/只读列（含时间戳头） */
  listVariant?: "chat" | "monitor";
}

function rowClassName(row: ChatMessageListRow, index: number): string {
  const parts = ["app-claude-messages-virtual-row"];
  if (index > 0 && row.kind !== "thinking-hint" && !row.mergedWithPrevious) {
    parts.push("app-claude-messages-virtual-row--group-start");
  }
  if (row.kind === "message" && row.mergedWithPrevious) {
    parts.push("app-claude-messages-virtual-row--merged");
  }
  return parts.join(" ");
}

export function ClaudeVirtualMessageList({
  session,
  showListEndThinkingHint,
  onOpenTaskDetail,
  listVariant = "chat",
}: Props) {
  const rows = useMemo(
    () =>
      buildChatMessageListRows(session.messages, {
        sessionStatus: session.status,
        showListEndThinkingHint,
      }),
    [session.messages, session.status, showListEndThinkingHint],
  );

  if (rows.length === 0) {
    return null;
  }

  return (
    <>
      {rows.map((row, index) => (
        <div key={row.key} className={rowClassName(row, index)}>
          {row.kind === "thinking-hint" ? (
            <div className="app-claude-messages-end-thinking">
              <StreamingReplyHint />
            </div>
          ) : listVariant === "monitor" ? (
            <ClaudeSessionMonitorMessageRow
              msg={row.msg}
              streamingThisBubble={row.streamingThisBubble}
              mergedWithPrevious={row.mergedWithPrevious}
              toolUser={row.toolUser}
              onOpenTaskDetail={onOpenTaskDetail}
            />
          ) : (
            <ClaudeChatMessageRow
              msg={row.msg}
              streamingThisBubble={row.streamingThisBubble}
              mergedWithPrevious={row.mergedWithPrevious}
              toolUser={row.toolUser}
              onOpenTaskDetail={onOpenTaskDetail}
            />
          )}
        </div>
      ))}
    </>
  );
}
