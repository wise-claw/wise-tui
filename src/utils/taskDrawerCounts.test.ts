import { describe, expect, test } from "bun:test";
import type { TrellisRequirementTaskRow } from "../services/trellisTaskBridge";
import {
  countDrawerExecutableTasks,
  listDrawerTrellisTasks,
} from "./taskDrawerCounts";

function trellisTask(
  partial: Partial<TrellisRequirementTaskRow> & Pick<TrellisRequirementTaskRow, "taskId" | "sourceKind" | "repositoryId">,
): TrellisRequirementTaskRow {
  return {
    dir: `/tmp/${partial.taskId}`,
    title: partial.taskId,
    status: partial.status ?? "planning",
    archived: partial.archived ?? false,
    parent: partial.parent ?? "parent-1",
    hasPrd: false,
    hasResearch: false,
    rootPath: "/work",
    clusterId: null,
    sourceRequirementIds: [],
    ...partial,
  };
}

describe("listDrawerTrellisTasks", () => {
  test("project scope keeps only workspace project-root tasks", () => {
    const tasks = [
      trellisTask({ taskId: "p1", sourceKind: "project", repositoryId: 1 }),
      trellisTask({ taskId: "r1", sourceKind: "projectRepository", repositoryId: 1 }),
      trellisTask({ taskId: "done", sourceKind: "project", repositoryId: 1, status: "completed" }),
    ];
    expect(listDrawerTrellisTasks(tasks).map((t) => t.taskId)).toEqual(["p1"]);
  });

  test("repository scope includes project and projectRepository rows for that repo", () => {
    const tasks = [
      trellisTask({ taskId: "p1", sourceKind: "project", repositoryId: 1 }),
      trellisTask({ taskId: "r1", sourceKind: "projectRepository", repositoryId: 1 }),
      trellisTask({ taskId: "other", sourceKind: "projectRepository", repositoryId: 2 }),
    ];
    expect(listDrawerTrellisTasks(tasks, { repositoryId: 1 }).map((t) => t.taskId).sort()).toEqual([
      "p1",
      "r1",
    ]);
  });
});

describe("countDrawerExecutableTasks", () => {
  test("matches Wise todo + Trellis runnable for drawer badge", () => {
    const trellis = [
      trellisTask({ taskId: "t1", sourceKind: "project", repositoryId: null }),
    ];
    const wise = [
      {
        id: "w1",
        title: "W",
        description: "",
        role: "backend" as const,
        size: "S" as const,
        estimateDays: 1,
        dependencies: [],
        sourceRefs: [],
        sourceRequirementIds: [],
        subtasks: [],
        dod: [],
        flowStatus: "todo" as const,
      },
      {
        id: "w2",
        title: "D",
        description: "",
        role: "backend" as const,
        size: "S" as const,
        estimateDays: 1,
        dependencies: [],
        sourceRefs: [],
        sourceRequirementIds: [],
        subtasks: [],
        dod: [],
        flowStatus: "done" as const,
      },
    ];
    expect(countDrawerExecutableTasks(wise, trellis)).toEqual({
      wiseTodo: 1,
      trellisRunnable: 1,
      total: 2,
    });
  });
});
