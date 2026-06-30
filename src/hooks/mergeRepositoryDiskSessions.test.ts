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

  test("still migrates empty main session tab id to Claude session id", () => {
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

  test("preserves Wise tab id for main session that already has messages", () => {
    const claudeId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const main: ClaudeSession = {
      id: "wise-tab-main",
      claudeSessionId: claudeId,
      repositoryPath: REPO,
      repositoryName: "Project: eco",
      model: "sonnet",
      status: "idle",
      messages: [{ id: 1, role: "user", content: "hello", parts: [{ type: "text", text: "hello" }], timestamp: 1 }],
      createdAt: 1,
      pendingPrompt: "",
    };
    const disk = [diskSession(claudeId)];
    const next = mergeRepositoryDiskSessions([main], REPO, "eco-ai-web", disk, "sonnet");
    expect(next.find((session) => session.id === "wise-tab-main")).toBeDefined();
    expect(next.find((session) => session.id === "wise-tab-main")?.messages.length).toBe(1);
  });

  test("matches an existing empty session on disk and picks the newer createdAt (today bucket)", () => {
    // 仓库来回切换：内存有一条之前创建的老会话（messages.length === 0），
    // 磁盘 jsonl 的 updatedAtMs 是「今天」；不能被压回老 createdAt，否则
    // groupSessionsByDay 会把它分到「过去 7 天/更久」，看起来"随机"。
    const claudeId = "cccccccc-cccc-4000-8000-000000000001";
    const stored: ClaudeSession = {
      id: claudeId,
      claudeSessionId: claudeId,
      repositoryPath: REPO,
      repositoryName: "eco-ai-web",
      model: "sonnet",
      status: "completed",
      messages: [],
      createdAt: 1_600_000_000_000, // 上周
      pendingPrompt: "",
    };
    const disk: ClaudeDiskSessionItem[] = [
      { sessionId: claudeId, updatedAtMs: 1_700_000_000_000, preview: "今天活跃", modelHint: "sonnet" },
    ];
    const next = mergeRepositoryDiskSessions([stored], REPO, "eco-ai-web", disk, "sonnet");
    const merged = next.find((s) => s.claudeSessionId === claudeId);
    expect(merged).toBeDefined();
    expect(merged?.createdAt).toBe(1_700_000_000_000);
  });

  test("keeps Math.min semantics when an existing session already has messages in memory", () => {
    // 内存有消息的真实会话：createdAt 应取较早值，不被磁盘 mtime 推后。
    const claudeId = "cccccccc-cccc-4000-8000-000000000002";
    const stored: ClaudeSession = {
      id: claudeId,
      claudeSessionId: claudeId,
      repositoryPath: REPO,
      repositoryName: "eco-ai-web",
      model: "sonnet",
      status: "completed",
      messages: [{ id: 1, role: "user", content: "hi", parts: [{ type: "text", text: "hi" }], timestamp: 1 }],
      createdAt: 1_600_000_000_000,
      pendingPrompt: "",
    };
    const disk: ClaudeDiskSessionItem[] = [
      { sessionId: claudeId, updatedAtMs: 1_700_000_000_000, preview: "more", modelHint: "sonnet" },
    ];
    const next = mergeRepositoryDiskSessions([stored], REPO, "eco-ai-web", disk, "sonnet");
    const merged = next.find((s) => s.claudeSessionId === claudeId);
    expect(merged?.createdAt).toBe(1_600_000_000_000);
  });
});
