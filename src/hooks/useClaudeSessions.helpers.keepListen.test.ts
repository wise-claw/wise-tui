import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import { shouldKeepClaudeInvocationStreamAfterTurnComplete } from "./useClaudeSessions.helpers";

function session(overrides: Partial<ClaudeSession> & Pick<ClaudeSession, "id">): ClaudeSession {
  return {
    repositoryPath: "/repo",
    repositoryName: "repo",
    model: "sonnet",
    messages: [],
    status: "running",
    ...overrides,
  };
}

describe("shouldKeepClaudeInvocationStreamAfterTurnComplete", () => {
  test("keeps oneshot invocation listening until next send", () => {
    const sessions = [session({ id: "tab-1", connectionKind: "oneshot" })];
    const inflight = new Map([["inv-1", { tabId: "tab-1", detach: () => {} }]]);
    expect(
      shouldKeepClaudeInvocationStreamAfterTurnComplete({
        tabId: "tab-1",
        sessions,
        streamingProcessByTab: new Map(),
        claudeInvocationInflight: inflight,
        defaultConnectionKind: "oneshot",
      }),
    ).toBe(true);
  });

  test("keeps streaming resident while process registry entry exists", () => {
    const sessions = [session({ id: "tab-1", connectionKind: "streaming" })];
    expect(
      shouldKeepClaudeInvocationStreamAfterTurnComplete({
        tabId: "tab-1",
        sessions,
        streamingProcessByTab: new Map([["tab-1", { claudeSessionId: "sid" }]]),
        claudeInvocationInflight: new Map(),
        defaultConnectionKind: "oneshot",
      }),
    ).toBe(true);
  });
});
