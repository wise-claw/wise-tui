import { describe, expect, test } from "bun:test";
import type { TaskItem } from "../../types";
import type { WorkflowFacade } from "../../types/workflow";
import {
  buildMaterializedExecutionWaves,
  runMaterializedSplitTasksFanout,
} from "./executionFanout";
import type { WriteClusterTasksOutput } from "./trellisWriter";

describe("buildMaterializedExecutionWaves", () => {
  test("maps source task ids to materialized Trellis task refs and remaps dependencies", () => {
    const waves = buildMaterializedExecutionWaves({
      projectRootPath: "/work/project",
      sourceTasks: [
        task("task-a", "API"),
        task("task-b", "UI", ["task-a"]),
      ],
      materializedResult: materialized(),
      parallelGroups: [["task-a"], ["task-b"]],
    });

    expect(waves.map((wave) => wave.taskIds)).toEqual([["task-a"], ["task-b"]]);
    expect(waves[0]?.workflowTasks[0]?.id).toBe(".trellis/tasks/05-19-prd/05-19-api");
    expect(waves[1]?.workflowTasks[0]?.id).toBe(".trellis/tasks/05-19-prd/05-19-ui");
    expect(waves[1]?.workflowTasks[0]?.dependencies).toEqual([
      ".trellis/tasks/05-19-prd/05-19-api",
    ]);
  });

  test("adds materialized tasks missing from parallelGroups to a final wave", () => {
    const waves = buildMaterializedExecutionWaves({
      projectRootPath: "/work/project",
      sourceTasks: [
        task("task-a", "API"),
        task("task-b", "UI"),
      ],
      materializedResult: materialized(),
      parallelGroups: [["task-a"]],
    });

    expect(waves.map((wave) => wave.taskIds)).toEqual([["task-a"], ["task-b"]]);
  });
});

describe("runMaterializedSplitTasksFanout", () => {
  test("runs waves in sequence and reuses the workflowRunId returned by the first wave", async () => {
    const calls: Array<{ waveIndex: number; taskIds: string[]; boundWorkflowRunId: string | null }> = [];
    const snapshots: string[] = [];

    const result = await runMaterializedSplitTasksFanout({
      facade: {} as WorkflowFacade,
      sessionId: "prd-split:parent",
      repositoryPath: "/repo/web",
      projectRootPath: "/work/project",
      sourceTasks: [
        task("task-a", "API"),
        task("task-b", "UI", ["task-a"]),
      ],
      materializedResult: materialized(),
      parallelGroups: [["task-a"], ["task-b"]],
      onSnapshot: (snapshot) => {
        snapshots.push(`${snapshot.status}:${snapshot.doneCount}:${snapshot.failedCount}`);
      },
      runWaveBatch: async ({ tasks, waveIndex, boundWorkflowRunId }) => {
        calls.push({ waveIndex, taskIds: tasks.map((task) => task.id), boundWorkflowRunId });
        return {
          message: `wave ${waveIndex} done`,
          workflowRunId: "wf-1",
          taskCount: tasks.length,
          templateId: "trellis",
          subagentType: "trellis-implement",
          concurrency: tasks.length,
          doneCount: tasks.length,
          failedCount: 0,
        };
      },
    });

    expect(calls).toEqual([
      {
        waveIndex: 0,
        taskIds: [".trellis/tasks/05-19-prd/05-19-api"],
        boundWorkflowRunId: null,
      },
      {
        waveIndex: 1,
        taskIds: [".trellis/tasks/05-19-prd/05-19-ui"],
        boundWorkflowRunId: "wf-1",
      },
    ]);
    expect(result.status).toBe("succeeded");
    expect(result.doneCount).toBe(2);
    expect(result.workflowRunId).toBe("wf-1");
    expect(snapshots.at(-1)).toBe("succeeded:2:0");
  });

  test("stops before the next wave when a wave fails", async () => {
    const calls: number[] = [];

    const result = await runMaterializedSplitTasksFanout({
      facade: {} as WorkflowFacade,
      sessionId: "prd-split:parent",
      repositoryPath: "/repo/web",
      projectRootPath: "/work/project",
      sourceTasks: [
        task("task-a", "API"),
        task("task-b", "UI", ["task-a"]),
      ],
      materializedResult: materialized(),
      parallelGroups: [["task-a"], ["task-b"]],
      runWaveBatch: async ({ tasks, waveIndex }) => {
        calls.push(waveIndex);
        return {
          message: `wave ${waveIndex} failed`,
          workflowRunId: "wf-1",
          taskCount: tasks.length,
          templateId: "trellis",
          subagentType: "trellis-implement",
          concurrency: tasks.length,
          doneCount: 0,
          failedCount: 1,
        };
      },
    });

    expect(calls).toEqual([0]);
    expect(result.status).toBe("failed");
    expect(result.failedCount).toBe(1);
  });

  test("fails when materialized output does not include every source task", async () => {
    const broken = materialized();
    broken.childTasks = broken.childTasks.filter((task) => task.sourceTaskId !== "task-b");

    await expect(runMaterializedSplitTasksFanout({
      facade: {} as WorkflowFacade,
      sessionId: "prd-split:parent",
      repositoryPath: "/repo/web",
      projectRootPath: "/work/project",
      sourceTasks: [
        task("task-a", "API"),
        task("task-b", "UI", ["task-a"]),
      ],
      materializedResult: broken,
      parallelGroups: [["task-a"], ["task-b"]],
      runWaveBatch: async () => {
        throw new Error("should not dispatch incomplete materialized output");
      },
    })).rejects.toThrow("task-b");
  });
});

function materialized(): WriteClusterTasksOutput {
  return {
    parentTaskName: "05-19-prd",
    childTaskNames: ["05-19-api", "05-19-ui"],
    childTasks: [
      {
        sourceTaskId: "task-a",
        taskName: "05-19-api",
        taskPath: "/work/project/.trellis/tasks/05-19-prd/05-19-api",
      },
      {
        sourceTaskId: "task-b",
        taskName: "05-19-ui",
        taskPath: "/work/project/.trellis/tasks/05-19-prd/05-19-ui",
      },
    ],
    warnings: [],
  };
}

function task(id: string, title: string, dependencies: string[] = []): TaskItem {
  return {
    id,
    title,
    description: "",
    role: "frontend",
    size: "M",
    estimateDays: 1,
    dependencies,
    sourceRefs: [],
    sourceRequirementIds: [],
    subtasks: [],
    dod: [],
    executionStatus: "executable",
    flowStatus: "todo",
  };
}
