import { afterEach, describe, expect, test } from "bun:test";
import type { TaskItem } from "../../types";
import type { RunSplitTasksOmcBatchResult } from "../workflow/actions";
import { runWorkspaceTrellisMaterializedFanout } from "./materializedFanoutBridge";
import type { WriteClusterTasksOutput } from "./trellisWriter";

describe("runWorkspaceTrellisMaterializedFanout", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: originalWindow,
    });
  });

  test("derives dependency waves and emits runtime events around Trellis fan-out", async () => {
    const events: string[] = [];
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: {
        dispatchEvent: (event: CustomEvent) => {
          events.push(`${event.type}:${event.detail?.active ?? event.detail?.source}`);
          return true;
        },
      },
    });

    const calls: Array<{ waveIndex: number; taskIds: string[] }> = [];
    const result = await runWorkspaceTrellisMaterializedFanout({
      facade: {} as never,
      sessionId: "prd-split:parent",
      projectId: "p1",
      projectRootPath: "/work/project",
      repositoryPath: "/work/project/web",
      sourceTasks: [
        task("task-a", "API"),
        task("task-b", "UI", ["task-a"]),
      ],
      materializedResult: materialized(),
      verifyAfterRun: false,
      runWaveBatch: async ({ waveIndex, tasks }): Promise<RunSplitTasksOmcBatchResult> => {
        calls.push({ waveIndex, taskIds: tasks.map((item) => item.id) });
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
      { waveIndex: 0, taskIds: [".trellis/tasks/05-19-prd/05-19-api"] },
      { waveIndex: 1, taskIds: [".trellis/tasks/05-19-prd/05-19-ui"] },
    ]);
    expect(result.status).toBe("succeeded");
    expect(result.lifecycleStages).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "verify", status: "active" }),
      expect.objectContaining({ key: "spec", status: "waiting" }),
    ]));
    expect(events).toEqual([
      "wise:split-todo-count-updated:trellis",
      "wise:omc-batch-runtime-changed:true",
      "wise:split-todo-count-updated:trellis",
      "wise:omc-batch-runtime-changed:false",
    ]);
  });

  test("runs trellis-check by default after implementation fan-out succeeds", async () => {
    const calls: Array<{ stage: string; subagentType: string; taskIds: string[] }> = [];

    const result = await runWorkspaceTrellisMaterializedFanout({
      facade: {} as never,
      sessionId: "prd-split:parent",
      projectId: "p1",
      projectRootPath: "/work/project",
      repositoryPath: "/work/project/web",
      sourceTasks: [
        task("task-a", "API"),
        task("task-b", "UI", ["task-a"]),
      ],
      materializedResult: materialized(),
      runWaveBatch: async ({ waveIndex, tasks, subagentType, stage }): Promise<RunSplitTasksOmcBatchResult> => {
        calls.push({ stage, subagentType, taskIds: tasks.map((item) => item.id) });
        return {
          message: `wave ${waveIndex} done`,
          workflowRunId: "wf-1",
          taskCount: tasks.length,
          templateId: "trellis",
          subagentType,
          concurrency: tasks.length,
          doneCount: tasks.length,
          failedCount: 0,
        };
      },
      runVerifyBatch: async ({ tasks, subagentType, stage }): Promise<RunSplitTasksOmcBatchResult> => {
        calls.push({ stage, subagentType, taskIds: tasks.map((item) => item.id) });
        return {
          message: "verify done",
          workflowRunId: "wf-1",
          taskCount: tasks.length,
          templateId: "trellis",
          subagentType,
          concurrency: tasks.length,
          doneCount: tasks.length,
          failedCount: 0,
        };
      },
    });

    expect(calls.at(-1)).toEqual({
      stage: "check",
      subagentType: "trellis-check",
      taskIds: [
        ".trellis/tasks/05-19-prd/05-19-api",
        ".trellis/tasks/05-19-prd/05-19-ui",
      ],
    });
    expect(result.lifecycleStages).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "verify", status: "done" }),
      expect.objectContaining({ key: "spec", status: "active" }),
    ]));
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
