import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import { reconcileSessionStatusesWithRunningRegistry } from "./claudeSessionState";

function session(overrides: Partial<ClaudeSession> & Pick<ClaudeSession, "id">): ClaudeSession {
  return {
    repositoryPath: "/tmp/repo",
    repositoryName: "repo",
    model: "auto",
    messages: [],
    status: "idle",
    connectionKind: "oneshot",
    ...overrides,
  };
}

describe("reconcileSessionStatusesWithRunningRegistry", () => {
  test("matches Cursor oneshot by Wise tab id when claudeSessionId is empty", () => {
    const sessions = [session({ id: "session_tab_1", status: "running" })];
    const runningIds = new Set<string>();
    const knownIds = new Set(["session_tab_1"]);

    const next = reconcileSessionStatusesWithRunningRegistry(
      sessions,
      runningIds,
      null,
      knownIds,
    );

    expect(next[0]?.status).toBe("idle");
  });

  test("keeps cancelled status when registry still lists tab id as running", () => {
    const sessions = [session({ id: "session_tab_1", status: "cancelled" })];
    const runningIds = new Set(["session_tab_1"]);

    const next = reconcileSessionStatusesWithRunningRegistry(sessions, runningIds);

    expect(next[0]?.status).toBe("cancelled");
  });
});
