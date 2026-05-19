import { describe, expect, test } from "bun:test";
import type { SplitResult, TaskItem } from "../../types";
import { buildExecutionOrchestrationModel } from "./executionOrchestrationModel";

describe("buildExecutionOrchestrationModel", () => {
  test("projects split result into requirements, parallel groups and agent dispatches", () => {
    const result = split([
      task({
        id: "task-1",
        title: "JWT service",
        role: "backend",
        sourceRequirementIds: ["req-functional-1"],
        sourceRefs: ["auth/jwt.service.ts:42"],
      }),
      task({
        id: "task-2",
        title: "Auth UI",
        role: "frontend",
        dependencies: ["task-1"],
        sourceRequirementIds: ["req-functional-1"],
        sourceRefs: ["components/Auth.tsx:1"],
      }),
    ]);

    const model = buildExecutionOrchestrationModel(result);

    expect(model.requirements).toHaveLength(1);
    expect(model.requirements[0]?.taskIds).toEqual(["task-1", "task-2"]);
    expect(model.requirements[0]?.label).toBe("功能需求 1");
    expect(model.requirements[0]?.title).toBe("用户认证系统");
    expect(model.tasks.find((item) => item.id === "task-2")?.requirementLabel).toBe("用户认证系统");
    expect(model.parallelGroups.map((group) => group.taskIds)).toEqual([["task-1"], ["task-2"]]);
    expect(model.tasks.find((item) => item.id === "task-2")?.lane).toBe("waiting");
    expect(model.tasks.find((item) => item.id === "task-1")?.agentName).toBe("API-Agent");
    expect(model.agents.map((agent) => agent.title).sort()).toEqual(["backend-api", "frontend-app"]);
  });

  test("detects same-wave source file conflicts", () => {
    const result = split([
      task({
        id: "task-1",
        title: "Update auth state",
        sourceRefs: ["src/auth.ts:12"],
      }),
      task({
        id: "task-2",
        title: "Adjust auth guard",
        sourceRefs: ["src/auth.ts:45"],
      }),
    ]);

    const model = buildExecutionOrchestrationModel(result);

    expect(model.conflictWarnings).toHaveLength(1);
    expect(model.conflictWarnings[0]?.message).toContain("src/auth.ts");
    expect(model.tasks.find((item) => item.id === "task-1")?.conflictWarnings).toHaveLength(1);
  });
});

function split(tasks: TaskItem[]): SplitResult {
  return {
    source: {
      title: "Auth",
      background: [],
      goals: [],
      scenarios: [],
      functional: ["用户认证系统"],
      nonFunctional: [],
      acceptance: [],
      sourceType: "plain_text",
      sourceRef: null,
    },
    context: null,
    splitTasks: tasks,
    executableTasks: [],
    criticalPath: [],
    parallelGroups: [],
    unmetPreconditions: [],
  };
}

function task(overrides: Partial<TaskItem>): TaskItem {
  return {
    id: "task-1",
    title: "Task",
    description: "",
    role: "backend",
    size: "M",
    estimateDays: 1,
    dependencies: [],
    sourceRefs: [],
    sourceRequirementIds: [],
    subtasks: [],
    dod: [],
    executionStatus: "executable",
    flowStatus: "todo",
    ...overrides,
  };
}
