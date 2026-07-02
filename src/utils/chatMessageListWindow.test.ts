import { describe, expect, test } from "bun:test";
import type { ChatMessageListRow } from "./claudeChatMessageListRows";
import {
  findChatMessageRowIndexByMessageId,
  nextChatMessageVisibleCount,
  shouldReclaimOnBottom,
  sliceChatMessageListRows,
  visibleCountToIncludeRowIndex,
} from "./chatMessageListWindow";
import {
  CHAT_MESSAGE_LIST_COMPANION_MAX_VISIBLE,
  CHAT_MESSAGE_LIST_MAX_VISIBLE,
} from "../constants/claudeMessageList";
import { resolveWindowSizing } from "../hooks/useChatMessageListWindow";

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

  test("caps at maxVisible for incremental browsing", () => {
    // 不传 maxVisible 时使用默认 160
    expect(nextChatMessageVisibleCount(150, 300, 28)).toBe(160);
    // 显式 maxVisible 生效
    expect(nextChatMessageVisibleCount(150, 300, 28, 160)).toBe(160);
    expect(nextChatMessageVisibleCount(48, 300, 28, 160)).toBe(76);
    // cap 高于总量时受总量约束
    expect(nextChatMessageVisibleCount(100, 120, 50, 200)).toBe(120);
  });

  test("does not shrink when current already exceeds cap (ensureMessageVisible exempt path)", () => {
    // current=150 已超 companion cap=96：loadMoreOlder 不应回缩窗口
    expect(nextChatMessageVisibleCount(150, 300, 28, 96)).toBe(150);
    // current=170 超默认 cap=160：保持不缩
    expect(nextChatMessageVisibleCount(170, 300, 28, 160)).toBe(170);
  });

  test("unlimited maxVisible (transcriptMemoryUnlimited) does not cap incremental browsing", () => {
    // 全量磁盘重载后 maxVisible=Infinity：visibleCount 可持续增长，仅受 rowsLength 约束
    expect(nextChatMessageVisibleCount(150, 300, 28, Number.POSITIVE_INFINITY)).toBe(178);
    expect(nextChatMessageVisibleCount(280, 300, 28, Number.POSITIVE_INFINITY)).toBe(300);
    // 已达 rowsLength 时不再增长
    expect(nextChatMessageVisibleCount(300, 300, 28, Number.POSITIVE_INFINITY)).toBe(300);
  });
});

describe("shouldReclaimOnBottom", () => {
  const bottomPx = 64;
  test("reclaims when pinned to bottom and window expanded", () => {
    // scrollHeight=1000, clientHeight=600, 贴底 scrollTop=400 → 400+600=1000 >= 1000-64
    expect(shouldReclaimOnBottom(400, 600, 1000, 120, 48, bottomPx)).toBe(true);
  });

  test("does not reclaim when not near bottom", () => {
    // 200+600=800 < 1000-64=936
    expect(shouldReclaimOnBottom(200, 600, 1000, 120, 48, bottomPx)).toBe(false);
  });

  test("does not reclaim when visibleCount not expanded beyond initial", () => {
    expect(shouldReclaimOnBottom(400, 600, 1000, 48, 48, bottomPx)).toBe(false);
    expect(shouldReclaimOnBottom(400, 600, 1000, 40, 48, bottomPx)).toBe(false);
  });

  test("does not reclaim when scroll geometry invalid", () => {
    expect(shouldReclaimOnBottom(400, 0, 1000, 120, 48, bottomPx)).toBe(false);
    expect(shouldReclaimOnBottom(400, 600, 0, 120, 48, bottomPx)).toBe(false);
  });

  test("reclaims at exact threshold boundary", () => {
    // scrollTop + clientHeight === scrollHeight - bottomPx → 贴底（>=）
    const scrollHeight = 1000;
    const clientHeight = 600;
    const scrollTop = scrollHeight - clientHeight - bottomPx; // 336
    expect(shouldReclaimOnBottom(scrollTop, clientHeight, scrollHeight, 120, 48, bottomPx)).toBe(true);
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

describe("resolveWindowSizing", () => {
  test("primary profile uses primary maxVisible", () => {
    expect(resolveWindowSizing("primary").maxVisible).toBe(CHAT_MESSAGE_LIST_MAX_VISIBLE);
  });

  test("companion profile uses companion maxVisible", () => {
    expect(resolveWindowSizing("companion").maxVisible).toBe(CHAT_MESSAGE_LIST_COMPANION_MAX_VISIBLE);
  });

  test("transcriptMemoryUnlimited lifts maxVisible cap to Infinity", () => {
    expect(resolveWindowSizing("primary", undefined, true).maxVisible).toBe(Number.POSITIVE_INFINITY);
    expect(resolveWindowSizing("companion", undefined, true).maxVisible).toBe(Number.POSITIVE_INFINITY);
  });
});
