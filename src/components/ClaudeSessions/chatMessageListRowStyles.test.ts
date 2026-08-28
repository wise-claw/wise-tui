import { describe, expect, test } from "bun:test";
import type { ChatMessageListRow } from "../../utils/claudeChatMessageListRows";
import { chatMessageListRowClassName } from "./chatMessageListRowStyles";

const baseMessageRow = {
  kind: "message",
  key: "m1:0",
  originalIndex: 0,
  msg: {
    id: "m1",
    role: "assistant",
    content: "hi",
    timestamp: 1,
  },
  streamingThisBubble: false,
  mergedWithPrevious: false,
  toolUser: false,
} as ChatMessageListRow;

describe("chatMessageListRowClassName", () => {
  test("stream 行标记 --streaming，便于关闭 content-visibility", () => {
    const streamingRow = {
      ...baseMessageRow,
      streamingThisBubble: true,
    } as ChatMessageListRow;
    expect(chatMessageListRowClassName(streamingRow, 0)).toContain(
      "app-claude-messages-virtual-row--streaming",
    );
    expect(chatMessageListRowClassName(baseMessageRow, 0)).not.toContain(
      "app-claude-messages-virtual-row--streaming",
    );
  });

  test("仅非工具用户消息组标记为 sticky", () => {
    const userRow = {
      ...baseMessageRow,
      msg: { ...baseMessageRow.msg, role: "user" },
    } as ChatMessageListRow;
    expect(chatMessageListRowClassName(userRow, 0)).toContain(
      "app-claude-messages-virtual-row--user-sticky",
    );
    expect(
      chatMessageListRowClassName({ ...userRow, toolUser: true } as ChatMessageListRow, 1),
    ).not.toContain("app-claude-messages-virtual-row--user-sticky");
    expect(
      chatMessageListRowClassName({ ...userRow, mergedWithPrevious: true } as ChatMessageListRow, 1),
    ).not.toContain("app-claude-messages-virtual-row--user-sticky");
    expect(
      chatMessageListRowClassName(userRow, 0, { pinUserMessages: false }),
    ).not.toContain("app-claude-messages-virtual-row--user-sticky");
  });
});
