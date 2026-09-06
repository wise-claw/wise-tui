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
  test("consumes completion delivered before invoke returns exactly once", async () => {
    const waiter = createClaudeTurnCompleteWaiter();
    waiter.resolve("tab", 1, true);
    await expect(waiter.wait("tab", 1, 10)).resolves.toEqual({ success: true });
    await expect(waiter.wait("tab", 1, 10)).rejects.toThrow(CLAUDE_TURN_WAIT_TIMEOUT_MESSAGE);
  });

  test("clear invalidates early results on cancel or close", async () => {
    const waiter = createClaudeTurnCompleteWaiter();
    waiter.resolve("tab", 1, true);
    waiter.clear("tab");
    await expect(waiter.wait("tab", 1, 10)).rejects.toThrow(CLAUDE_TURN_WAIT_TIMEOUT_MESSAGE);
  });

  test("late old results cannot replace a newer early completion", async () => {
    const waiter = createClaudeTurnCompleteWaiter();
    waiter.resolve("tab", 2, true);
    waiter.resolve("tab", 1, false);
    await expect(waiter.wait("tab", 2, 10)).resolves.toEqual({ success: true });
  });

  test("concurrent waiters resolve together without caching an already consumed completion", async () => {
    const waiter = createClaudeTurnCompleteWaiter();
    const first = waiter.wait("tab", 1, 100);
    const second = waiter.wait("tab", 1, 100);
    waiter.resolve("tab", 1, false);
    await expect(Promise.all([first, second])).resolves.toEqual([{ success: false }, { success: false }]);
    await expect(waiter.wait("tab", 1, 10)).rejects.toThrow(CLAUDE_TURN_WAIT_TIMEOUT_MESSAGE);
  });

});
