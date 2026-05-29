import { describe, expect, test } from "bun:test";
import type { PendingExecutionTask } from "../types";
import {
  findDispatchableHeadTasksPerLane,
  findHeadTaskPerLane,
  findMainLaneHead,
  findNextDispatchableLaneHead,
  pendingTaskExecutorLaneKey,
} from "./pendingQueueLanes";

function task(
  partial: Partial<PendingExecutionTask> & Pick<PendingExecutionTask, "id" | "promptText" | "executorLabel">,
): PendingExecutionTask {
  return {
    createdAt: 1,
    targetType: "main",
    ...partial,
  };
}

describe("pendingQueueLanes", () => {
  test("pendingTaskExecutorLaneKey partitions main, employee, team", () => {
    expect(pendingTaskExecutorLaneKey(task({ id: "1", promptText: "a", executorLabel: "主" }))).toBe("main");
    expect(
      pendingTaskExecutorLaneKey(
        task({
          id: "2",
          promptText: "b",
          executorLabel: "@终端01",
          targetType: "employee",
          targetEmployeeName: "终端01",
        }),
      ),
    ).toBe("employee:终端01");
    expect(
      pendingTaskExecutorLaneKey(
        task({
          id: "3",
          promptText: "c",
          executorLabel: "团队:foo",
          targetType: "team",
          targetWorkflowId: "wf-1",
        }),
      ),
    ).toBe("team:wf-1");
  });

  test("findHeadTaskPerLane keeps FIFO per lane", () => {
    const tasks = [
      task({ id: "t1", promptText: "a", executorLabel: "@终端01", targetType: "employee", targetEmployeeName: "终端01" }),
      task({ id: "m1", promptText: "b", executorLabel: "主", targetType: "main" }),
      task({ id: "t2", promptText: "c", executorLabel: "@终端01", targetType: "employee", targetEmployeeName: "终端01" }),
    ];
    const heads = findHeadTaskPerLane(tasks);
    expect(heads.get("employee:终端01")?.id).toBe("t1");
    expect(heads.get("main")?.id).toBe("m1");
  });

  test("findDispatchableHeadTasksPerLane allows parallel lane heads", () => {
    const tasks = [
      task({ id: "t1", promptText: "a", executorLabel: "@终端01", targetType: "employee", targetEmployeeName: "终端01" }),
      task({ id: "m1", promptText: "b", executorLabel: "主", targetType: "main" }),
    ];
    const can = (t: PendingExecutionTask) => t.id === "m1";
    expect(findDispatchableHeadTasksPerLane(tasks, can).map((x) => x.id)).toEqual(["m1"]);
  });

  test("findNextDispatchableLaneHead respects global order among lane heads", () => {
    const tasks = [
      task({ id: "t1", promptText: "a", executorLabel: "@终端01", targetType: "employee", targetEmployeeName: "终端01" }),
      task({ id: "m1", promptText: "b", executorLabel: "主", targetType: "main" }),
    ];
    const next = findNextDispatchableLaneHead(tasks, () => true);
    expect(next?.id).toBe("t1");
  });

  test("findMainLaneHead returns first main-target task", () => {
    const tasks = [
      task({ id: "t1", promptText: "a", executorLabel: "@终端01", targetType: "employee", targetEmployeeName: "终端01" }),
      task({ id: "m1", promptText: "b", executorLabel: "主", targetType: "main" }),
    ];
    expect(findMainLaneHead(tasks)?.id).toBe("m1");
  });
});
