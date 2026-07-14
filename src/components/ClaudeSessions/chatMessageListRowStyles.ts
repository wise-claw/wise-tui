import type { ChatMessageListRow } from "../../utils/claudeChatMessageListRows";

export function chatMessageListRowClassName(row: ChatMessageListRow, index: number): string {
  const parts = ["app-claude-messages-virtual-row"];
  if (index > 0 && row.kind !== "thinking-hint" && !row.mergedWithPrevious) {
    parts.push("app-claude-messages-virtual-row--group-start");
  }
  if (row.kind === "message" && row.mergedWithPrevious) {
    parts.push("app-claude-messages-virtual-row--merged");
  }
  if (row.kind === "message" && row.streamingThisBubble) {
    parts.push("app-claude-messages-virtual-row--streaming");
  }
  return parts.join(" ");
}
