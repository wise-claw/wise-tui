import { describe, expect, test } from "bun:test";
import type { SplitResult, TaskItem } from "../../types";
import { moveTaskInExecutionPlan } from "./executionPlanAdjustments";

describe("moveTaskInExecutionPlan", () => {
  test("moves a task later by depending on same-wave peers", () => {
    const result = split([
      task("task-1"),
      task("task-2"),
      task("task-3"),
    ]);

    const next = moveTaskInExecutionPlan(result, "task-1", "later");

    expect(next?.splitTasks.find((task) => task.id === "task-1")?.dependencies).toEqual(["task-2", "task-3"]);
    expect(next?.parallelGroups).toEqual([["task-2", "task-3"], ["task-1"]]);
  });

  test("moves a task earlier by depending on the previous previous wave", () => {
    const result = split([
      task("task-1"),
      task("task-2", ["task-1"]),
      task("task-3", ["task-2"], { "task-2": "T3 waits for T2" }),
    ]);

    const next = moveTaskInExecutionPlan(result, "task-3", "earlier");

    expect(next?.splitTasks.find((task) => task.id === "task-3")?.dependencies).toEqual(["task-1"]);
    expect(next?.splitTasks.find((task) => task.id === "task-3")?.dependencyRationale).toBeUndefined();
    expect(next?.parallelGroups).toEqual([["task-1"], ["task-2", "task-3"]]);
  });

  test("returns null for boundary moves", () => {
    const result = split([task("task-1"), task("task-2", ["task-1"])]);

    expect(moveTaskInExecutionPlan(result, "task-1", "earlier")).toBeNull();
    expect(moveTaskInExecutionPlan(result, "task-2", "later")).toBeNull();
  });
});

function split(tasks: TaskItem[]): SplitResult {
  return {
    source: {
      title: "PRD",
      background: [],
      goals: [],
      scenarios: [],
      functional: [],
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

function task(id: string, dependencies: string[] = [], dependencyRationale?: Record<string, string>): TaskItem {
  return {
    id,
    title: id,
    description: "",
    role: "frontend",
    size: "M",
    estimateDays: 1,
    dependencies,
    dependencyRationale,
    sourceRefs: [],
    sourceRequirementIds: [],
    subtasks: [],
    dod: [],
    executionStatus: "executable",
    flowStatus: "todo",
  };
}
