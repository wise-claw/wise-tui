import { describe, expect, test } from "bun:test";
import {
  getClaudeUsageUiStoreSnapshot,
  requestOpenSessionDataLink,
  requestOpenUsagePopover,
  subscribeClaudeUsageUiStore,
} from "./claudeUsageUiStore";

describe("claudeUsageUiStore", () => {
  test("notifies subscribers on open requests", () => {
    let calls = 0;
    const unsub = subscribeClaudeUsageUiStore(() => {
      calls += 1;
    });
    const before = getClaudeUsageUiStoreSnapshot();
    requestOpenUsagePopover();
    requestOpenSessionDataLink("insights");
    const after = getClaudeUsageUiStoreSnapshot();
    expect(after.usagePopoverOpenNonce).toBe(before.usagePopoverOpenNonce + 1);
    expect(after.sessionDataLinkOpenNonce).toBe(before.sessionDataLinkOpenNonce + 1);
    expect(after.sessionDataLinkInitialView).toBe("insights");
    expect(calls).toBeGreaterThanOrEqual(2);
    unsub();
  });
});
