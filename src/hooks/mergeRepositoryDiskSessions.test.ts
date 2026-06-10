import { describe, expect, test } from "bun:test";
import { mergeRepositoryDiskSessions } from "./useClaudeSessions";
import { buildExecutionEnvironmentWorkerRepositoryName } from "../utils/executionEnvironmentDispatch";
import type { ClaudeDiskSessionItem, ClaudeSession } from "../types";

const REPO = "/Users/dev/eco-ai-web";

function diskSession(sessionId: string): ClaudeDiskSessionItem {
  return {
    sessionId,
    updatedAtMs: 1_700_000_000_000,
    preview: "preview",
    modelHint: "sonnet",
  };
}

describe("mergeRepositoryDiskSessions", () => {
  test("preserves Wise tab id for terminal worker sessions", () => {
    const claudeId = "cf69232b-0000-4000-8000-000000000001";
    const worker: ClaudeSession = {
      id: "wise-tab-terminal-01",
      claudeSessionId: claudeId,
      repositoryPath: REPO,
      repositoryName: "eco-ai-web/员工:终端01",
      model: "sonnet",
      status: "running",
      messages: [{ role: "user", content: [{ type: "text", text: "do work" }] }],
      createdAt: 1,
      pendingPrompt: "",
    };
    const disk = [diskSession(claudeId)];
    const next = mergeRepositoryDiskSessions([worker], REPO, "eco-ai-web", disk, "sonnet");
    const merged = next.find((s) => s.id === "wise-tab-terminal-01");
    expect(merged).toBeDefined();
    expect(merged?.claudeSessionId).toBe(claudeId);
    expect(merged?.messages.length).toBe(1);
  });

  test("preserves Wise tab id for execution environment worker sessions", () => {
    const claudeId = "cf69232b-0000-4000-8000-000000000002";
    const worker: ClaudeSession = {
      id: "wise-tab-exec-env-1",
      claudeSessionId: claudeId,
      repositoryPath: REPO,
      repositoryName: buildExecutionEnvironmentWorkerRepositoryName("eco-ai-web", "你好", "claude"),
      model: "sonnet",
      status: "completed",
      messages: [{ role: "user", content: "你好", parts: [{ type: "text", text: "你好" }] }],
      createdAt: 1,
      pendingPrompt: "",
    };
    const disk = [diskSession(claudeId)];
    const next = mergeRepositoryDiskSessions([worker], REPO, "eco-ai-web", disk, "sonnet");
    const merged = next.find((s) => s.id === "wise-tab-exec-env-1");
    expect(merged).toBeDefined();
    expect(merged?.claudeSessionId).toBe(claudeId);
  });

  test("keeps terminal worker tabs after disk refresh even when messages were recycled", () => {
    const worker: ClaudeSession = {
      id: "wise-tab-terminal-02",
      claudeSessionId: "cf69232b-0000-4000-8000-000000000099",
      repositoryPath: REPO,
      repositoryName: "eco-ai-web/员工:终端02",
      model: "sonnet",
      status: "completed",
      messages: [],
      createdAt: 1,
      pendingPrompt: "",
    };
    const disk = Array.from({ length: 30 }, (_, index) =>
      diskSession(`disk-only-${index.toString().padStart(2, "0")}`),
    );
    const next = mergeRepositoryDiskSessions([worker], REPO, "eco-ai-web", disk, "sonnet");
    expect(next.some((session) => session.id === "wise-tab-terminal-02")).toBe(true);
  });

  test("still migrates main session tab id to Claude session id", () => {
    const main: ClaudeSession = {
      id: "wise-tab-main",
      claudeSessionId: null,
      repositoryPath: REPO,
      repositoryName: "eco-ai-web",
      model: "sonnet",
      status: "idle",
      messages: [],
      createdAt: 1,
      pendingPrompt: "",
    };
    const disk = [diskSession("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")];
    const next = mergeRepositoryDiskSessions([main], REPO, "eco-ai-web", disk, "sonnet");
    const merged = next.find((s) => s.claudeSessionId === "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(merged?.id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });
});
