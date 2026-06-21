import { describe, expect, test } from "bun:test";
import type { ClaudeSession, Repository } from "../types";
import {
  resolveExecutionEnvironmentDispatchAnchorSessionId,
  resolveMonitorRepositoryPath,
} from "./executionEnvironmentDispatchAnchor";

function session(overrides: Partial<ClaudeSession> & { id: string }): ClaudeSession {
  return {
    id: overrides.id,
    repositoryPath: overrides.repositoryPath ?? "/repo/wise-tui",
    repositoryName: overrides.repositoryName ?? "wise-tui",
    status: overrides.status ?? "idle",
    messages: overrides.messages ?? [],
    createdAt: overrides.createdAt ?? 1,
    ...overrides,
  } as ClaudeSession;
}

const repositories: Repository[] = [
  {
    id: 1,
    name: "wise-tui",
    path: "/repo/wise-tui",
    repositoryType: "frontend",
    createdAt: "",
    updatedAt: "",
  },
];

describe("resolveMonitorRepositoryPath", () => {
  test("prefers anchor main session repository path over worker tab", () => {
    const main = session({ id: "main-1", repositoryPath: "/repo/wise-tui", repositoryName: "wise-tui" });
    const worker = session({
      id: "worker-1",
      repositoryPath: "/repo/wise-tui",
      repositoryName: "wise-tui/员工:终端1",
    });
    const path = resolveMonitorRepositoryPath({
      activeSessionId: worker.id,
      sessions: [main, worker],
      repositoryMainSessionBindings: { "/repo/wise-tui": main.id },
      repositories,
      employeeItems: [],
      dispatchTasks: [],
    });
    expect(path).toBe("/repo/wise-tui");
  });

  test("falls back to employee item repository path", () => {
    const path = resolveMonitorRepositoryPath({
      activeSessionId: null,
      sessions: [],
      repositoryMainSessionBindings: {},
      repositories,
      employeeItems: [{ repositoryPath: "/repo/wise-tui" }],
      dispatchTasks: [],
    });
    expect(path).toBe("/repo/wise-tui");
  });
});

describe("resolveExecutionEnvironmentDispatchAnchorSessionId", () => {
  test("maps terminal worker active tab to repository main session", () => {
    const main = session({ id: "main-1" });
    const worker = session({
      id: "worker-1",
      repositoryName: "wise-tui/员工:终端1",
    });
    const anchor = resolveExecutionEnvironmentDispatchAnchorSessionId({
      activeSessionId: worker.id,
      sessions: [main, worker],
      repositoryMainSessionBindings: { "/repo/wise-tui": main.id },
      repositories,
    });
    expect(anchor).toBe("main-1");
  });
});
