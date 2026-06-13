import { describe, expect, test } from "bun:test";
import {
  CLAUDE_TURN_WAIT_CANCELLED_MESSAGE,
  CLAUDE_TURN_WAIT_TIMEOUT_MESSAGE,
  createClaudeTurnCompleteWaiter,
  isClaudeTurnWaitControlError,
} from "./claudeTurnCompleteWaiter";

describe("createClaudeTurnCompleteWaiter", () => {
  test("resolves wait when matching tab and nonce complete", async () => {
    const waiter = createClaudeTurnCompleteWaiter();
    const promise = waiter.wait("tab-1", 3);
    waiter.resolve("tab-1", 3, true);
    await expect(promise).resolves.toEqual({ success: true });
  });

  test("ignores resolve for different nonce", async () => {
    const waiter = createClaudeTurnCompleteWaiter();
    const promise = waiter.wait("tab-1", 3, 50);
    waiter.resolve("tab-1", 4, true);
    waiter.resolve("tab-1", 3, false);
    await expect(promise).resolves.toEqual({ success: false });
  });

  test("clear rejects pending waiters", async () => {
    const waiter = createClaudeTurnCompleteWaiter();
    const promise = waiter.wait("tab-1", 1);
    waiter.clear("tab-1");
    await expect(promise).rejects.toThrow(CLAUDE_TURN_WAIT_CANCELLED_MESSAGE);
  });

  test("isClaudeTurnWaitControlError recognizes internal wait errors", () => {
    expect(isClaudeTurnWaitControlError(new Error(CLAUDE_TURN_WAIT_TIMEOUT_MESSAGE))).toBe(true);
    expect(isClaudeTurnWaitControlError(new Error(CLAUDE_TURN_WAIT_CANCELLED_MESSAGE))).toBe(true);
    expect(isClaudeTurnWaitControlError(new Error("API rate limit"))).toBe(false);
  });
});
