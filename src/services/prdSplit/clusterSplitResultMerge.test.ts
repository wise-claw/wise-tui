import { describe, expect, test } from "bun:test";
import type { PrdDocument, SplitResult, TaskItem } from "../../types";
import { mergeClusterSplitResults, namespaceClusterSplitResult } from "./clusterSplitResultMerge";

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
    ...overrides,
  };
}

function makeSplit(overrides: Partial<SplitResult> = {}): SplitResult {
  const prd = makePrd();
  return {
    source: prd,
    context: null,
    splitTasks: [makeTask()],
    executableTasks: [],
    criticalPath: [],
    parallelGroups: [],
    unmetPreconditions: [],
    ...overrides,
  };
}

describe("cluster split result merge", () => {
  test("namespaces task ids and dependency references for multi-cluster merges", () => {
    const result = namespaceClusterSplitResult("cluster-fe", makeSplit({
      splitTasks: [
        makeTask({ id: "task-1" }),
        makeTask({
          id: "task-2",
          dependencies: ["task-1"],
          sourceRequirementIds: ["req-functional-2"],
        }),
      ],
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
          { taskId: "task-2", requirementIds: ["req-functional-2"] },
        ],
        capturedAtMs: 1,
      },
    }));

    expect(result.splitTasks.map((task) => task.id)).toEqual(["cluster-fe-task-1", "cluster-fe-task-2"]);
    expect(result.splitTasks[1]?.dependencies).toEqual(["cluster-fe-task-1"]);
    expect(Object.keys(result.taskAnchorDescriptors ?? {})).toEqual(["cluster-fe-task-1"]);
    expect(Object.keys(result.taskAnchorTexts ?? {})).toEqual(["cluster-fe-task-1"]);
    expect(Object.keys(result.taskAnchorPositions ?? {})).toEqual(["cluster-fe-task-1"]);
    expect(result.claudeSplitMapping?.taskRequirementLinks.map((link) => link.taskId)).toEqual([
      "cluster-fe-task-1",
      "cluster-fe-task-2",
    ]);
    expect(result.claudeSplitMapping?.idRemap).toEqual([
      { from: "task-1", to: "cluster-fe-task-1" },
      { from: "task-2", to: "cluster-fe-task-2" },
    ]);
  });

  test("merges multiple successful cluster outputs without duplicate task ids", () => {
    const prd = makePrd();
    const result = mergeClusterSplitResults(
      prd,
      { mode: "project", projectId: "p1", projectName: "Wise" },
      [
        {
          clusterId: "cluster-fe",
          result: makeSplit({
            source: prd,
            splitTasks: [
              makeTask({
                id: "task-1",
                title: "Frontend",
                sourceRequirementIds: ["req-functional-1"],
              }),
            ],
          }),
        },
        {
          clusterId: "cluster-api",
          result: makeSplit({
            source: prd,
            splitTasks: [
              makeTask({
                id: "task-1",
                title: "Backend",
                role: "backend",
                sourceRequirementIds: ["req-functional-2"],
              }),
            ],
          }),
        },
      ],
      "# Feature\n\n- Build frontend web login UI\n- Build backend API login endpoint",
    );

    expect(result.splitTasks.map((task) => task.id)).toEqual([
      "cluster-fe-task-1",
      "cluster-api-task-1",
    ]);
    expect(new Set(result.splitTasks.map((task) => task.id)).size).toBe(2);
    expect(result.parallelGroups.flat()).toEqual(expect.arrayContaining([
      "cluster-fe-task-1",
      "cluster-api-task-1",
    ]));
    expect(result.taskAnchorTexts?.["cluster-fe-task-1"]).toBe("Build frontend web login UI");
    expect(result.taskAnchorTexts?.["cluster-api-task-1"]).toBe("Build backend API login endpoint");
  });

  test("keeps single-cluster ids unchanged", () => {
    const prd = makePrd();
    const result = mergeClusterSplitResults(
      prd,
      null,
      [{ clusterId: "cluster-fe", result: makeSplit({ source: prd }) }],
      "# Feature",
    );

    expect(result.splitTasks.map((task) => task.id)).toEqual(["task-1"]);
  });
});
