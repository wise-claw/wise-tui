import { describe, expect, test, beforeEach } from "bun:test";
import {
  __resetCodexApprovalStoreForTests,
  __setCodexApprovalPendingForTests,
  dismissCodexApprovalPending,
  getCodexApprovalPending,
  subscribeCodexApproval,
} from "./codexApprovalStore";
import type { CodexApprovalRequestPayload } from "../services/codexRpc";

function makePayload(
  overrides: Partial<CodexApprovalRequestPayload> = {},
): CodexApprovalRequestPayload {
  return {
    session_id: "sess-1",
    request_id: 7,
    type: "commandExecution",
    command: "ls",
    ...overrides,
  };
}

describe("codexApprovalStore", () => {
  beforeEach(() => {
    __resetCodexApprovalStoreForTests();
  });

  test("按 session 存取 pending，dismiss 仅清匹配 request_id", () => {
    __setCodexApprovalPendingForTests(makePayload());
    expect(getCodexApprovalPending("sess-1")?.request_id).toBe(7);
    expect(getCodexApprovalPending("other")).toBeNull();

    dismissCodexApprovalPending("sess-1", 999);
    expect(getCodexApprovalPending("sess-1")?.request_id).toBe(7);

    dismissCodexApprovalPending("sess-1", 7);
    expect(getCodexApprovalPending("sess-1")).toBeNull();
  });

  test("subscribe 在 pending 变化时通知", () => {
    let ticks = 0;
    const unsub = subscribeCodexApproval(() => {
      ticks += 1;
    });
    __setCodexApprovalPendingForTests(makePayload({ request_id: 1 }));
    __setCodexApprovalPendingForTests(makePayload({ request_id: 2 }));
    dismissCodexApprovalPending("sess-1", 2);
    unsub();
    expect(ticks).toBe(3);
  });
});
