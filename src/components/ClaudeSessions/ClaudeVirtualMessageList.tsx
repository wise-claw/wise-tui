import { useLayoutEffect, useMemo, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ClaudeSession } from "../../types";
import {
  buildChatMessageListRows,
  type ChatMessageListRow,
} from "../../utils/claudeChatMessageListRows";
import { ClaudeChatMessageRow } from "./ClaudeChatMessageRow";
import { ClaudeSessionMonitorMessageRow } from "./ClaudeSessionMonitorMessageRow";
import { StreamingReplyHint } from "./Markdown";

const VIRTUAL_OVERSCAN = 8;
const ESTIMATE_SIZE_CHAT = 72;
const ESTIMATE_SIZE_MONITOR = 88;
const ESTIMATE_SIZE_THINKING = 36;

interface Props {
  session: ClaudeSession;
  showListEndThinkingHint: boolean;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  onOpenTaskDetail?: (taskId: string) => void;
  /** 主会话气泡 vs 监控/只读列（含时间戳头） */
  listVariant?: "chat" | "monitor";
}

function rowGroupStartClass(row: ChatMessageListRow, index: number): string {
  if (index === 0) return "";
  if (row.kind === "thinking-hint") return "";
  if (row.mergedWithPrevious) return "";
  return " app-claude-messages-virtual-row--group-start";
}

export function ClaudeVirtualMessageList({
  session,
  showListEndThinkingHint,
  scrollContainerRef,
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

  const measureFingerprint = useMemo(() => {
    if (session.messages.length === 0) return "empty";
    const last = session.messages[session.messages.length - 1]!;
    const partsTextLen =
      last.parts?.reduce((sum, part) => {
        if (part.type === "text" || part.type === "reasoning") return sum + part.text.length;
        return sum;
      }, 0) ?? 0;
    return `${rows.length}:${last.id}:${last.content.length}:${partsTextLen}:${showListEndThinkingHint}`;
  }, [session.messages, rows.length, showListEndThinkingHint]);

  const estimateSize = listVariant === "monitor" ? ESTIMATE_SIZE_MONITOR : ESTIMATE_SIZE_CHAT;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      if (!row) return estimateSize;
      return row.kind === "thinking-hint" ? ESTIMATE_SIZE_THINKING : estimateSize;
    },
    overscan: VIRTUAL_OVERSCAN,
    getItemKey: (index) => rows[index]!.key,
  });

  useLayoutEffect(() => {
    virtualizer.measure();
  }, [measureFingerprint, virtualizer]);

  if (rows.length === 0) {
    return null;
  }

  return (
    <div
      className="app-claude-messages-virtual-inner"
      data-wise-messages-virtual-inner
      style={{
        height: virtualizer.getTotalSize(),
        position: "relative",
        width: "100%",
      }}
    >
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const row = rows[virtualRow.index]!;
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className={`app-claude-messages-virtual-row${rowGroupStartClass(row, virtualRow.index)}`}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
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
        );
      })}
    </div>
  );
}
