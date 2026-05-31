import { describe, expect, test } from "bun:test";
import type { EmployeeItem, Repository } from "../types";
import {
  resolveEngineForSession,
  resolveSessionExecutionEngine,
  resolveExecutionRepositoryPath,
} from "./sessionExecutionEngine";

const repo = (overrides: Partial<Repository> = {}): Repository =>
  ({
    id: 1,
    name: "demo",
    path: "/repo/demo",
    repositoryType: "frontend",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  }) as Repository;

const employee = (overrides: Partial<EmployeeItem> = {}): EmployeeItem =>
  ({
    id: "e1",
    name: "Alice",
    agentType: "executor",
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    displayOrder: 0,
    repositoryIds: [1],
    projectIds: [],
    ...overrides,
  }) as EmployeeItem;

describe("resolveSessionExecutionEngine", () => {
  test("defaults to claude for main session", () => {
    expect(
      resolveSessionExecutionEngine(
        { repositoryPath: "/repo/demo", repositoryName: "demo" },
        [repo()],
        [],
      ),
    ).toBe("claude");
  });

  test("uses repository executionEngine for main session", () => {
    expect(
      resolveSessionExecutionEngine(
        { repositoryPath: "/repo/demo", repositoryName: "demo" },
        [repo({ executionEngine: "codex" })],
        [],
      ),
    ).toBe("codex");
  });

  test("uses cursor executionEngine when configured", () => {
    expect(
      resolveSessionExecutionEngine(
        { repositoryPath: "/repo/demo", repositoryName: "demo" },
        [repo({ executionEngine: "cursor" })],
        [],
      ),
    ).toBe("cursor");
  });

  test("uses employee executionEngine for employee session", () => {
    expect(
      resolveSessionExecutionEngine(
        { repositoryPath: "/repo/demo", repositoryName: "demo / 员工:Alice" },
        [repo({ executionEngine: "claude" })],
        [employee({ executionEngine: "codex" })],
      ),
    ).toBe("codex");
  });

  test("uses activeRepository for project-root session", () => {
    expect(
      resolveSessionExecutionEngine(
        { repositoryPath: "/work/eco", repositoryName: "Project: eco" },
        [
          repo({ id: 1, name: "eco-ai-web", path: "/work/eco/eco-ai-web", executionEngine: "claude" }),
          repo({ id: 2, name: "eco-ai", path: "/work/eco/eco-ai", executionEngine: "codex" }),
        ],
        [],
        repo({ id: 2, name: "eco-ai", path: "/work/eco/eco-ai", executionEngine: "codex" }),
      ),
    ).toBe("codex");
  });

  test("resolveEngineForSession matches composer when project session uses sidebar repo", () => {
    const ecoAiWeb = repo({
      id: 1,
      name: "eco-ai-web",
      path: "/work/eco/eco-ai-web",
      executionEngine: "cursor",
    });
    expect(
      resolveEngineForSession(
        { repositoryPath: "/work/eco", repositoryName: "Project: eco" },
        [ecoAiWeb],
        [],
        ecoAiWeb,
      ),
    ).toBe("cursor");
  });

  test("resolves execution repository path from activeRepository for project session", () => {
    expect(
      resolveExecutionRepositoryPath(
        { repositoryPath: "/work/eco", repositoryName: "Project: eco" },
        [repo({ id: 1, name: "eco-ai-web", path: "/work/eco/eco-ai-web" })],
        [],
        repo({ id: 1, name: "eco-ai-web", path: "/work/eco/eco-ai-web" }),
      ),
    ).toBe("/work/eco/eco-ai-web");
  });
});
