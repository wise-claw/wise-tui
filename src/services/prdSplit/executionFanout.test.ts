import { describe, expect, test } from "bun:test";
import type { TaskItem } from "../../types";
import type { WorkflowFacade } from "../../types/workflow";
import {
  buildExecutionFanoutLoopStages,
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
    const calls: Array<{ waveIndex: number; taskIds: string[]; boundWorkflowRunId: string | null; stage: string }> = [];
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
      runWaveBatch: async ({ tasks, waveIndex, boundWorkflowRunId, stage }) => {
        calls.push({ waveIndex, taskIds: tasks.map((task) => task.id), boundWorkflowRunId, stage });
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
        stage: "implement",
      },
      {
        waveIndex: 1,
        taskIds: [".trellis/tasks/05-19-prd/05-19-ui"],
        boundWorkflowRunId: "wf-1",
        stage: "implement",
      },
    ]);
    expect(result.status).toBe("succeeded");
    expect(result.doneCount).toBe(2);
    expect(result.workflowRunId).toBe("wf-1");
    expect(result.workflowRunIds).toEqual(["wf-1"]);
    expect(result.lifecycleStages).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "run", status: "done" }),
      expect.objectContaining({ key: "verify", status: "active" }),
      expect.objectContaining({ key: "spec", status: "waiting" }),
    ]));
    expect(snapshots.at(-1)).toBe("succeeded:2:0");
  });

  test("runs a verify batch after successful implementation when requested", async () => {
    const verifyCalls: Array<{ stage: string; subagentType: string; taskIds: string[]; boundWorkflowRunId: string | null }> = [];

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
      verifyAfterRun: true,
      runWaveBatch: async ({ tasks, waveIndex, boundWorkflowRunId }) => ({
        message: `wave ${waveIndex} done`,
        workflowRunId: boundWorkflowRunId ?? "wf-1",
        taskCount: tasks.length,
        templateId: "trellis",
        subagentType: "trellis-implement",
        concurrency: tasks.length,
        doneCount: tasks.length,
        failedCount: 0,
      }),
      runVerifyBatch: async ({ tasks, boundWorkflowRunId, stage, subagentType }) => {
        verifyCalls.push({ stage, subagentType, taskIds: tasks.map((task) => task.id), boundWorkflowRunId });
        return {
          message: "verify done",
          workflowRunId: boundWorkflowRunId,
          taskCount: tasks.length,
          templateId: "trellis",
          subagentType,
          concurrency: tasks.length,
          doneCount: tasks.length,
          failedCount: 0,
        };
      },
    });

    expect(verifyCalls).toEqual([{
      stage: "check",
      subagentType: "trellis-check",
      taskIds: [
        ".trellis/tasks/05-19-prd/05-19-api",
        ".trellis/tasks/05-19-prd/05-19-ui",
      ],
      boundWorkflowRunId: "wf-1",
    }]);
    expect(result.status).toBe("succeeded");
    expect(result.verifyDoneCount).toBe(2);
    expect(result.verifyFailedCount).toBe(0);
    expect(result.lifecycleStages).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "verify", status: "done" }),
      expect.objectContaining({ key: "spec", status: "active" }),
    ]));
  });

  test("keeps Spec waiting when the verify batch fails", async () => {
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
      verifyAfterRun: true,
      runWaveBatch: async ({ tasks, boundWorkflowRunId }) => ({
        message: "implement done",
        workflowRunId: boundWorkflowRunId ?? "wf-1",
        taskCount: tasks.length,
        templateId: "trellis",
        subagentType: "trellis-implement",
        concurrency: tasks.length,
        doneCount: tasks.length,
        failedCount: 0,
      }),
      runVerifyBatch: async ({ tasks, boundWorkflowRunId, subagentType }) => ({
        message: "verify failed",
        workflowRunId: boundWorkflowRunId,
        taskCount: tasks.length,
        templateId: "trellis",
        subagentType,
        concurrency: tasks.length,
        doneCount: 1,
        failedCount: 1,
      }),
    });

    expect(result.status).toBe("failed");
    expect(result.failedCount).toBe(0);
    expect(result.verifyDoneCount).toBe(1);
    expect(result.verifyFailedCount).toBe(1);
    expect(result.lifecycleStages).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "run", status: "done" }),
      expect.objectContaining({ key: "verify", status: "failed" }),
      expect.objectContaining({ key: "spec", status: "waiting" }),
    ]));
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
    expect(result.lifecycleStages).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "run", status: "failed" }),
      expect.objectContaining({ key: "verify", status: "waiting" }),
    ]));
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

describe("buildExecutionFanoutLoopStages", () => {
  test("keeps verify active after run succeeds without auto-check", () => {
    const stages = buildExecutionFanoutLoopStages("succeeded", "verify");

    expect(stages.map((stage) => [stage.key, stage.status])).toEqual([
      ["dispatch", "done"],
      ["run", "done"],
      ["verify", "active"],
      ["spec", "waiting"],
    ]);
  });

  test("activates Spec after Verify succeeds", () => {
    const stages = buildExecutionFanoutLoopStages("succeeded", "spec");

    expect(stages.map((stage) => [stage.key, stage.status])).toEqual([
      ["dispatch", "done"],
      ["run", "done"],
      ["verify", "done"],
      ["spec", "active"],
    ]);
  });

  test("marks the active stage failed without advancing later stages", () => {
    const stages = buildExecutionFanoutLoopStages("failed", "run");

    expect(stages.map((stage) => [stage.key, stage.status])).toEqual([
      ["dispatch", "done"],
      ["run", "failed"],
      ["verify", "waiting"],
      ["spec", "waiting"],
    ]);
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
