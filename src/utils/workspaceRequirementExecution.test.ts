import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import { createWorkspaceRequirementItem } from "../types/workspaceRequirements";
import { requirementExecutionSessions, requirementExecutionState } from "./workspaceRequirementExecution";

const item = { ...createWorkspaceRequirementItem("修复登录", 1, "1"), id: "req", executionSessionIds: ["first", "second"] };
const session = (id: string, status: ClaudeSession["status"], requirementId?: string): ClaudeSession => ({
  id, status, requirementId, claudeSessionId: null, repositoryPath: "/repo", repositoryName: "repo",
  model: "", messages: [], createdAt: 1, pendingPrompt: "",
});

describe("requirement execution projection", () => {
  test("keeps active work visible when a newer session failed", () => {
    expect(requirementExecutionState(item, [session("first", "running"), session("second", "error")])).toBe("running");
  });
  test("uses latest linked session, independently of snapshot order", () => {
    expect(requirementExecutionState(item, [session("second", "cancelled"), session("first", "completed")])).toBe("cancelled");
  });
  test("does not infer success from acceptance or a missing session", () => {
    expect(requirementExecutionState({ ...item, status: "done" }, [])).toBe("unavailable");
    expect(requirementExecutionState(item, [session("first", "completed")])).toBe("unavailable");
  });
  test("merges runtime links without duplicate history and excludes unrelated sessions", () => {
    const rows = requirementExecutionSessions(item, [session("second", "completed", "req"), session("third", "connecting", "req"), session("other", "running", "other")]);
    expect(rows.map((row) => row.sessionId)).toEqual(["first", "second", "third"]);
    expect(requirementExecutionState(item, rows.flatMap((row) => row.session ? [row.session] : []))).toBe("connecting");
  });
  test("distinguishes accepted dispatch from an unstarted requirement without claiming queued", () => {
    expect(requirementExecutionState({ ...item, executionSessionIds: [], lastDispatchedAt: null }, [])).toBe("not_started");
    expect(requirementExecutionState({ ...item, executionSessionIds: [], lastDispatchedAt: 5 }, [])).toBe("dispatched");
  });
  test("idle is not treated as successful execution", () => {
    expect(requirementExecutionState(item, [session("second", "idle")])).toBe("idle");
  });
});
