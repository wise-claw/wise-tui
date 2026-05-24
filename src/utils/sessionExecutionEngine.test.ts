import { describe, expect, test } from "bun:test";
import type { EmployeeItem, Repository } from "../types";
import { resolveSessionExecutionEngine } from "./sessionExecutionEngine";

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

  test("uses employee executionEngine for employee session", () => {
    expect(
      resolveSessionExecutionEngine(
        { repositoryPath: "/repo/demo", repositoryName: "demo / 员工:Alice" },
        [repo({ executionEngine: "claude" })],
        [employee({ executionEngine: "codex" })],
      ),
    ).toBe("codex");
  });
});
