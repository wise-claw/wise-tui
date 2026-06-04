import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import { buildExecutionEnvironmentWorkerRepositoryName } from "./executionEnvironmentDispatch";
import {
  findExecutionEnvironmentWorkerInRepository,
  preservesWorkerWiseTabId,
  resolveSessionForExecuteKey,
} from "./sessionExecuteResolve";

function session(partial: Partial<ClaudeSession> & Pick<ClaudeSession, "id">): ClaudeSession {
  return {
    claudeSessionId: null,
    repositoryPath: "/repo",
    repositoryName: "repo",
    model: "sonnet",
    status: "completed",
    messages: [],
    createdAt: 1,
    pendingPrompt: "",
    ...partial,
  };
}

describe("preservesWorkerWiseTabId", () => {
  test("detects execution environment worker", () => {
    expect(preservesWorkerWiseTabId({ repositoryName: "wise/执行环境:claude:任务" })).toBe(true);
  });

  test("detects terminal employee worker", () => {
    expect(preservesWorkerWiseTabId({ repositoryName: "wise/员工:终端01" })).toBe(true);
  });
});

describe("resolveSessionForExecuteKey", () => {
  test("finds by wise tab id", () => {
    const worker = session({
      id: "tab-worker-1",
      claudeSessionId: "uuid-claude-1",
      repositoryName: "wise/执行环境:claude:你好",
    });
    expect(resolveSessionForExecuteKey([worker], "tab-worker-1")?.id).toBe("tab-worker-1");
  });

  test("finds by claude session id", () => {
    const worker = session({
      id: "uuid-claude-1",
      claudeSessionId: "uuid-claude-1",
      repositoryName: "wise/执行环境:claude:你好",
    });
    expect(resolveSessionForExecuteKey([worker], "uuid-claude-1")?.id).toBe("uuid-claude-1");
  });

  test("finds via sessionIdMap tab to claude", () => {
    const worker = session({
      id: "uuid-claude-1",
      claudeSessionId: "uuid-claude-1",
      repositoryName: "wise/执行环境:claude:你好",
    });
    const map = new Map([["tab-worker-1", "uuid-claude-1"]]);
    expect(resolveSessionForExecuteKey([worker], "tab-worker-1", map)?.id).toBe("uuid-claude-1");
  });
});

describe("findExecutionEnvironmentWorkerInRepository", () => {
  test("matches worker by task label when tab id drifted to claude session id", () => {
    const claudeId = "uuid-claude-2";
    const worker = session({
      id: claudeId,
      claudeSessionId: claudeId,
      repositoryPath: "/repo",
      repositoryName: buildExecutionEnvironmentWorkerRepositoryName("wise", "你好", "claude"),
    });
    const hit = findExecutionEnvironmentWorkerInRepository([worker], {
      workerSessionId: "tab-legacy-worker",
      repositoryPath: "/repo",
      taskLabel: "你好",
    });
    expect(hit?.id).toBe(claudeId);
  });
});
