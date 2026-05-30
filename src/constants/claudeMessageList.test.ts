import { describe, expect, test } from "bun:test";
import {
  CHAT_MESSAGE_LIST_INITIAL_VISIBLE,
  CHAT_MESSAGE_LIST_RENDER_MODE,
  CHAT_MESSAGE_LIST_WINDOW_THRESHOLD,
} from "./claudeMessageList";

describe("claudeMessageList constants", () => {
  test("uses full-dom render mode with tail windowing", () => {
    expect(CHAT_MESSAGE_LIST_RENDER_MODE).toBe("full-dom");
    expect(CHAT_MESSAGE_LIST_WINDOW_THRESHOLD).toBeGreaterThan(0);
    expect(CHAT_MESSAGE_LIST_INITIAL_VISIBLE).toBeGreaterThan(CHAT_MESSAGE_LIST_WINDOW_THRESHOLD);
  });
});
