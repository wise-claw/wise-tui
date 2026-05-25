import { describe, expect, test } from "bun:test";
import type { TrellisRequirementWorkspaceSnapshot } from "../services/trellisTaskBridge";
import {
  countRunnableTrellisTasksInSnapshot,
  countSplitTodoExecutableTasks,
  isRunnableTrellisRequirementTask,
} from "./requirementWorkspaceExecutable";

describe("isRunnableTrellisRequirementTask", () => {
  test("requires parent and non-terminal status", () => {
    expect(
      isRunnableTrellisRequirementTask({
        taskId: "t1",
        dir: "/tmp/t1",
        title: "Child",
        status: "in_progress",
        archived: false,
        parent: "parent-1",
        hasPrd: false,
        hasResearch: false,
        rootPath: "/repo",
        sourceKind: "projectRepository",
        repositoryId: 1,
        clusterId: null,
        sourceRequirementIds: [],
      }),
    ).toBe(true);
  });

  test("rejects root tasks and completed tasks", () => {
    const base = {
      taskId: "t1",
      dir: "/tmp/t1",
      title: "Task",
      hasPrd: false,
      hasResearch: false,
      rootPath: "/repo",
      sourceKind: "projectRepository" as const,
      repositoryId: 1,
      clusterId: null,
      sourceRequirementIds: [] as string[],
      archived: false,
    };
    expect(isRunnableTrellisRequirementTask({ ...base, status: "completed", parent: "p1" })).toBe(false);
    expect(isRunnableTrellisRequirementTask({ ...base, status: "in_progress", parent: "" })).toBe(false);
  });
});

describe("countRunnableTrellisTasksInSnapshot", () => {
  test("legacy helper still counts all runnable tasks in snapshot", () => {
    const snapshot: TrellisRequirementWorkspaceSnapshot = {
      sources: [],
      prds: [],
      tasks: [
        {
          taskId: "a",
          dir: "/a",
          title: "A",
          status: "in_progress",
          archived: false,
          parent: "root",
          hasPrd: false,
          hasResearch: false,
          rootPath: "/repo-a",
          sourceKind: "projectRepository",
          repositoryId: 1,
          clusterId: null,
          sourceRequirementIds: [],
        },
        {
          taskId: "b",
          dir: "/b",
          title: "B",
          status: "in_progress",
          archived: false,
          parent: "root",
          hasPrd: false,
          hasResearch: false,
          rootPath: "/repo-b",
          sourceKind: "projectRepository",
          repositoryId: 2,
          clusterId: null,
          sourceRequirementIds: [],
        },
      ],
    };

    expect(countRunnableTrellisTasksInSnapshot(snapshot)).toBe(2);
    expect(countRunnableTrellisTasksInSnapshot(snapshot, { repositoryId: 1 })).toBe(1);
  });
});

describe("countSplitTodoExecutableTasks", () => {
  test("counts only todo flow status", () => {
    expect(
      countSplitTodoExecutableTasks([
        { id: "1", title: "A", description: "", role: "backend", size: "S", estimateDays: 1, dependencies: [], sourceRefs: [], sourceRequirementIds: [], subtasks: [], dod: [], flowStatus: "todo" },
        { id: "2", title: "B", description: "", role: "backend", size: "S", estimateDays: 1, dependencies: [], sourceRefs: [], sourceRequirementIds: [], subtasks: [], dod: [], flowStatus: "done" },
        { id: "3", title: "C", description: "", role: "backend", size: "S", estimateDays: 1, dependencies: [], sourceRefs: [], sourceRequirementIds: [], subtasks: [], dod: [], flowStatus: "in_progress" },
      ]),
    ).toBe(2);
  });
});
