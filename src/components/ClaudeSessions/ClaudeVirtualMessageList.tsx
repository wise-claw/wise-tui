import { useLayoutEffect, useMemo, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ClaudeSession } from "../../types";
import {
  buildChatMessageListRows,
  type ChatMessageListRow,
} from "../../utils/claudeChatMessageListRows";
import {
  buildVirtualMessageListStructureFingerprint,
  estimateVirtualChatRowSize,
} from "../../utils/claudeVirtualMessageRowEstimate";
import { ClaudeChatMessageRow } from "./ClaudeChatMessageRow";
import { ClaudeSessionMonitorMessageRow } from "./ClaudeSessionMonitorMessageRow";
import { StreamingReplyHint } from "./Markdown";

const VIRTUAL_OVERSCAN = 8;

interface Props {
  session: ClaudeSession;
  showListEndThinkingHint: boolean;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  onOpenTaskDetail?: (taskId: string) => void;
  /** 主会话气泡 vs 监控/只读列（含时间戳头） */
  listVariant?: "chat" | "monitor";
}

function virtualRowClassName(row: ChatMessageListRow, index: number): string {
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

  const listStructureFingerprint = useMemo(
    () => buildVirtualMessageListStructureFingerprint(rows, showListEndThinkingHint),
    [rows, showListEndThinkingHint],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      if (!row) return estimateVirtualChatRowSize({ kind: "thinking-hint", key: "thinking-hint" }, listVariant);
      return estimateVirtualChatRowSize(row, listVariant);
    },
    overscan: VIRTUAL_OVERSCAN,
    getItemKey: (index) => rows[index]!.key,
  });

  useLayoutEffect(() => {
    virtualizer.measure();
  }, [listStructureFingerprint, virtualizer]);

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
            className={virtualRowClassName(row, virtualRow.index)}
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
