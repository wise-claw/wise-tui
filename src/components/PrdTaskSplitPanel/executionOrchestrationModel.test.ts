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
    expect(model.parallelGroups.map((group) => group.taskIds)).toEqual([["task-1"], ["task-2"]]);
    expect(model.tasks.find((item) => item.id === "task-2")?.lane).toBe("waiting");
    expect(model.agents.map((agent) => agent.title).sort()).toEqual(["backend-api", "frontend-app"]);
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
