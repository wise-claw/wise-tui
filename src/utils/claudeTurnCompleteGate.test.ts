import { describe, expect, test } from "bun:test";
import {
  isStaleClaudeCompleteForSession,
  resolveExpectedTurnNonceForTab,
  shouldApplyClaudeTurnComplete,
} from "./claudeTurnCompleteGate";

describe("shouldApplyClaudeTurnComplete", () => {
  test("accepts complete when turn nonce still expected", () => {
    expect(shouldApplyClaudeTurnComplete(true)).toBe(true);
  });

  test("drops stale complete after terminal fresh turn bumped nonce", () => {
    expect(shouldApplyClaudeTurnComplete(false)).toBe(false);
  });
});

describe("resolveExpectedTurnNonceForTab", () => {
  test("finds nonce after tab id migrates to Claude session id", () => {
    const nonce = resolveExpectedTurnNonceForTab({
      tabId: "wise-tab-1",
      sessionIdMap: new Map([["wise-tab-1", "claude-uuid"]]),
      nonceByTabId: new Map([["claude-uuid", 7]]),
      sessions: [{ id: "claude-uuid", claudeSessionId: "claude-uuid" }],
      boundNonce: 1,
    });
    expect(nonce).toBe(7);
  });

  test("falls back to bound nonce when map has no entry", () => {
    expect(
      resolveExpectedTurnNonceForTab({
        tabId: "tab-1",
        sessionIdMap: new Map(),
        nonceByTabId: new Map(),
        sessions: [{ id: "tab-1", claudeSessionId: null }],
        boundNonce: 3,
      }),
    ).toBe(3);
  });
});

describe("isStaleClaudeCompleteForSession", () => {
  test("drops cancel complete for previous Claude session after fresh turn cleared claudeSessionId", () => {
    expect(
      isStaleClaudeCompleteForSession(
        { id: "wise-tab-1", claudeSessionId: null },
        { sessionId: "old-claude-uuid", success: false },
      ),
    ).toBe(true);
  });

  test("accepts Codex complete keyed by Wise tab id when claudeSessionId is unset", () => {
    expect(
      isStaleClaudeCompleteForSession(
        { id: "wise-tab-1", claudeSessionId: null },
        { sessionId: "wise-tab-1", success: true },
      ),
    ).toBe(false);
  });

  test("drops complete for outdated claudeSessionId after reassignment", () => {
    expect(
      isStaleClaudeCompleteForSession(
        { id: "wise-tab-1", claudeSessionId: "new-claude-uuid" },
        { sessionId: "old-claude-uuid", success: false },
      ),
    ).toBe(true);
  });
});
