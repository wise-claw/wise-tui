import { describe, expect, test } from "bun:test";
import {
  clearChatScrollFileOpenLock,
  isChatScrollFileOpenLocked,
  rememberChatScrollBeforeFileOpen,
  takeChatScrollFileOpenAnchor,
} from "./claudeChatMessageScrollBridge";

describe("chat scroll file open anchor", () => {
  test("remember and take restores scroll anchor once", () => {
    rememberChatScrollBeforeFileOpen({ scrollTop: 420, messageId: "12" });
    expect(isChatScrollFileOpenLocked()).toBe(true);
    expect(takeChatScrollFileOpenAnchor()).toEqual({ scrollTop: 420, messageId: "12" });
    expect(takeChatScrollFileOpenAnchor()).toBeNull();
    clearChatScrollFileOpenLock();
    expect(isChatScrollFileOpenLocked()).toBe(false);
  });
});
