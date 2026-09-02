import { afterEach, describe, expect, test } from "bun:test";
import {
  clearCodexRpcReasoningEffortStoreForTests,
  getCodexRpcReasoningEffort,
  pruneCodexRpcReasoningEffortSessions,
  setCodexRpcReasoningEffort,
  subscribeCodexRpcReasoningEffort,
} from "./codexRpcReasoningEffortStore";

afterEach(() => {
  clearCodexRpcReasoningEffortStoreForTests();
});

describe("codexRpcReasoningEffortStore", () => {
  test("按 session 记忆，默认 medium", () => {
    expect(getCodexRpcReasoningEffort("tab-a")).toBe("medium");
    setCodexRpcReasoningEffort("tab-a", "xhigh");
    expect(getCodexRpcReasoningEffort("tab-a")).toBe("xhigh");
    expect(getCodexRpcReasoningEffort("tab-b")).toBe("medium");
  });

  test("subscribe 在变更时通知", () => {
    let n = 0;
    const unsub = subscribeCodexRpcReasoningEffort(() => {
      n += 1;
    });
    setCodexRpcReasoningEffort("s1", "high");
    setCodexRpcReasoningEffort("s1", "high"); // no-op
    setCodexRpcReasoningEffort("s1", "low");
    unsub();
    setCodexRpcReasoningEffort("s1", "minimal");
    expect(n).toBe(2);
  });

  test("prune drops closed session preferences and preserves live ones", () => {
    setCodexRpcReasoningEffort("closed", "high");
    setCodexRpcReasoningEffort("live", "xhigh");

    expect(pruneCodexRpcReasoningEffortSessions(new Set(["live"]))).toBe(true);
    expect(getCodexRpcReasoningEffort("closed")).toBe("medium");
    expect(getCodexRpcReasoningEffort("live")).toBe("xhigh");
    expect(pruneCodexRpcReasoningEffortSessions(new Set(["live"]))).toBe(false);
  });
});
