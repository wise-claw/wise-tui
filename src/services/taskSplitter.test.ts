import { describe, expect, test } from "bun:test";
import type { PrdDocument, SplitResult, TaskItem } from "../types";
import { migrateStoredSplitResult } from "./taskSplitter";

function makePrd(): PrdDocument {
  return {
    title: "Feature",
    sourceType: "manual",
    sourceRef: null,
    background: [],
    goals: [],
    scenarios: [],
    functional: ["Build frontend web login UI", "Build backend API login endpoint"],
    nonFunctional: [],
    acceptance: [],
  };
}

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: "task-1",
    title: "Task",
    description: "Implement task",
    role: "frontend",
    size: "S",
    estimateDays: 1,
    dependencies: [],
    sourceRefs: [],
    sourceRequirementIds: ["req-functional-1"],
    subtasks: ["Build"],
    dod: ["Done"],
    executionStatus: "not_executable",
    executionStatusManual: false,
    flowStatus: "pending_review",
    ...overrides,
  };
}

describe("migrateStoredSplitResult", () => {
  test("deduplicates legacy duplicate split task ids before UI render", () => {
    const split: SplitResult = {
      source: makePrd(),
      context: null,
      splitTasks: [
        makeTask({ id: "task-1", title: "Frontend" }),
        makeTask({
          id: "task-1",
          title: "Backend",
          role: "backend",
          dependencies: ["task-1"],
          sourceRequirementIds: ["req-functional-2"],
        }),
      ],
      executableTasks: [
        makeTask({
          id: "exec-1",
          splitSourceTaskId: "task-1",
          dependencies: ["task-1"],
        }),
      ],
      criticalPath: [],
      parallelGroups: [],
      unmetPreconditions: [],
      taskAnchorDescriptors: {
        "task-1": {
          from: 0,
          to: 10,
          textHash: "hash",
          contextBefore: "Build frontend web login UI",
          contextAfter: "Build frontend web login UI",
        },
      },
      taskAnchorTexts: {
        "task-1": "Build frontend web login UI",
      },
      taskAnchorPositions: {
        "task-1": { from: 1, to: 2 },
      },
      claudeSplitMapping: {
        version: 1,
        taskRequirementLinks: [
          { taskId: "task-1", requirementIds: ["req-functional-1"] },
        ],
        capturedAtMs: 1,
      },
    };

    const migrated = migrateStoredSplitResult(split);

    expect(migrated.splitTasks.map((task) => task.id)).toEqual(["task-1", "task-1-2"]);
    expect(new Set(migrated.splitTasks.map((task) => task.id)).size).toBe(2);
    expect(migrated.executableTasks[0]?.dependencies).toEqual(["task-1"]);
    expect(migrated.executableTasks[0]?.splitSourceTaskId).toBe("task-1");
    expect(Object.keys(migrated.taskAnchorDescriptors ?? {})).toEqual(["task-1"]);
    expect(migrated.claudeSplitMapping?.taskRequirementLinks[0]?.taskId).toBe("task-1");
  });

  test("keeps unique task ids unchanged", () => {
    const split: SplitResult = {
      source: makePrd(),
      context: null,
      splitTasks: [makeTask({ id: "task-1" }), makeTask({ id: "task-2" })],
      executableTasks: [],
      criticalPath: [],
      parallelGroups: [],
      unmetPreconditions: [],
    };

    const migrated = migrateStoredSplitResult(split);

    expect(migrated.splitTasks.map((task) => task.id)).toEqual(["task-1", "task-2"]);
  });
});
