import { describe, expect, test } from "bun:test";
import type { ChatMessageListRow } from "./claudeChatMessageListRows";
import {
  findChatMessageRowIndexByMessageId,
  nextChatMessageVisibleCount,
  sliceChatMessageListRows,
  visibleCountToIncludeRowIndex,
} from "./chatMessageListWindow";

function msgRow(id: number, key?: string): ChatMessageListRow {
  return {
    kind: "message",
    key: key ?? String(id),
    originalIndex: id,
    msg: { id, role: "assistant", content: "hi", timestamp: "" },
    streamingThisBubble: false,
    mergedWithPrevious: false,
    toolUser: false,
  };
}

describe("sliceChatMessageListRows", () => {
  test("returns all rows below threshold", () => {
    const rows = [msgRow(1), msgRow(2)];
    const slice = sliceChatMessageListRows(rows, 100, 80);
    expect(slice.windowActive).toBe(false);
    expect(slice.visibleRows).toHaveLength(2);
    expect(slice.hiddenRowCount).toBe(0);
  });

  test("keeps tail rows above threshold", () => {
    const rows = Array.from({ length: 120 }, (_, i) => msgRow(i));
    const slice = sliceChatMessageListRows(rows, 100, 80);
    expect(slice.windowActive).toBe(true);
    expect(slice.hiddenRowCount).toBe(20);
    expect(slice.visibleStartIndex).toBe(20);
    expect(slice.visibleRows).toHaveLength(100);
    expect(slice.visibleRows[0]?.msg.id).toBe(20);
    expect(slice.visibleRows.at(-1)?.msg.id).toBe(119);
  });
});

describe("nextChatMessageVisibleCount", () => {
  test("loads more without exceeding total", () => {
    expect(nextChatMessageVisibleCount(100, 120, 50)).toBe(120);
    expect(nextChatMessageVisibleCount(100, 200, 50)).toBe(150);
  });
});

describe("visibleCountToIncludeRowIndex", () => {
  test("expands window to include target row", () => {
    expect(visibleCountToIncludeRowIndex(10, 120, 100)).toBe(110);
    expect(visibleCountToIncludeRowIndex(50, 120, 100)).toBe(100);
  });
});

describe("findChatMessageRowIndexByMessageId", () => {
  test("finds message row index", () => {
    const rows = [msgRow(1), msgRow(42, "42:1")];
    expect(findChatMessageRowIndexByMessageId(rows, 42)).toBe(1);
    expect(findChatMessageRowIndexByMessageId(rows, 99)).toBe(-1);
  });
});
