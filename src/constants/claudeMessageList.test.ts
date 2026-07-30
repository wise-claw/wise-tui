import { describe, expect, test } from "bun:test";
import {
  CHAT_MESSAGE_LIST_INITIAL_VISIBLE,
  CHAT_MESSAGE_LIST_MAX_VISIBLE,
  CHAT_MESSAGE_LIST_RENDER_MODE,
  CHAT_MESSAGE_LIST_WINDOW_THRESHOLD,
} from "./claudeMessageList";

describe("claudeMessageList constants", () => {
  test("uses full-dom render mode with tail windowing", () => {
    expect(CHAT_MESSAGE_LIST_RENDER_MODE).toBe("full-dom");
    expect(CHAT_MESSAGE_LIST_WINDOW_THRESHOLD).toBeGreaterThan(0);
  });

  test("initial window covers the threshold so enabling it hides nothing", () => {
    // 行数 = 阈值 + 1 时窗口刚启用，初始窗口须能容纳全部行，
    // 否则一进入窗口化就出现「加载更早消息（还有 3 条）」这种无意义按钮。
    expect(CHAT_MESSAGE_LIST_INITIAL_VISIBLE).toBeGreaterThan(CHAT_MESSAGE_LIST_WINDOW_THRESHOLD);
    expect(CHAT_MESSAGE_LIST_INITIAL_VISIBLE).toBeLessThanOrEqual(CHAT_MESSAGE_LIST_MAX_VISIBLE);
  });
});
