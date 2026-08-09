import { describe, expect, test } from "bun:test";
import type { ClaudeSession, WorkflowGraph, WorkflowRuntimeStepSnapshot } from "../types";
import {
  buildWorkflowStageStatusRows,
  resolveDispatchStepExecutionStatus,
} from "./resolveWorkflowStageExecutionStatus";

function snap(partial: Partial<WorkflowRuntimeStepSnapshot> & Pick<WorkflowRuntimeStepSnapshot, "id" | "phase">): WorkflowRuntimeStepSnapshot {
  return {
    taskId: "t1",
    inputPreview: "in",
    outputPreview: "(待执行)",
    createdAt: 1,
    ...partial,
  };
}

function graph(): WorkflowGraph {
  return {
    nodes: [
      { id: "s", type: "start", position: { x: 0, y: 0 }, data: { label: "开始" } },
      { id: "n1", type: "code", position: { x: 1, y: 0 }, data: { label: "代码执行" } },
      { id: "n2", type: "task", position: { x: 2, y: 0 }, data: { label: "智能体阶段" } },
      { id: "e", type: "end", position: { x: 3, y: 0 }, data: { label: "结束" } },
    ],
    edges: [],
  };
}

describe("resolveDispatchStepExecutionStatus", () => {
  test("awaiting latest dispatch marks running when task in progress", () => {
    const snapshot = snap({ id: "d1", phase: "dispatch", toNodeId: "n1", outputPreview: "(待执行)" });
    const status = resolveDispatchStepExecutionStatus({
      snapshot,
      snapshotIndex: 0,
      snapshotsSorted: [snapshot],
      taskStatus: "in_progress",
      isLatestDispatch: true,
    });
    expect(status).toEqual({ key: "running", label: "执行中", color: "processing" });
  });

  test("uses live session running over awaiting preview", () => {
    const snapshot = snap({
      id: "d1",
      phase: "dispatch",
      toNodeId: "n1",
      outputPreview: "(待执行)",
      executorSessionId: "sess-1",
    });
    const sessionById = new Map<string, ClaudeSession>([
      [
        "sess-1",
        {
          id: "sess-1",
          claudeSessionId: null,
          repositoryPath: "/r",
          repositoryName: "r",
          model: "sonnet",
          status: "running",
          messages: [],
          createdAt: 1,
          pendingPrompt: "",
        },
      ],
    ]);
    const status = resolveDispatchStepExecutionStatus({
      snapshot,
      snapshotIndex: 0,
      snapshotsSorted: [snapshot],
      taskStatus: "in_progress",
      sessionById,
      isLatestDispatch: true,
    });
    expect(status.key).toBe("running");
  });

  test("marks completed when a later dispatch exists", () => {
    const d1 = snap({ id: "d1", phase: "dispatch", toNodeId: "n1", outputPreview: "done", createdAt: 1 });
    const d2 = snap({ id: "d2", phase: "dispatch", toNodeId: "n2", outputPreview: "(待执行)", createdAt: 2 });
    const status = resolveDispatchStepExecutionStatus({
      snapshot: d1,
      snapshotIndex: 0,
      snapshotsSorted: [d1, d2],
      taskStatus: "in_progress",
      isLatestDispatch: false,
    });
    expect(status).toEqual({ key: "completed", label: "已完成", color: "success" });
  });

  test("marks rejected from following decision", () => {
    const d1 = snap({ id: "d1", phase: "dispatch", toNodeId: "n1", outputPreview: "out", createdAt: 1 });
    const dec = snap({
      id: "c1",
      phase: "decision",
      decision: "reject",
      toNodeId: "n1",
      outputPreview: "no",
      createdAt: 2,
    });
    const status = resolveDispatchStepExecutionStatus({
      snapshot: d1,
      snapshotIndex: 0,
      snapshotsSorted: [d1, dec],
      taskStatus: "rejected",
      isLatestDispatch: true,
    });
    expect(status.key).toBe("rejected");
  });
});

describe("buildWorkflowStageStatusRows", () => {
  test("lists graph nodes with not_started until dispatched", () => {
    const rows = buildWorkflowStageStatusRows({
      graph: graph(),
      snapshotsSorted: [],
      taskStatus: undefined,
    });
    expect(rows.map((r) => [r.nodeName, r.status.key])).toEqual([
      ["开始", "not_started"],
      ["代码执行", "not_started"],
      ["智能体阶段", "not_started"],
      ["结束", "not_started"],
    ]);
  });

  test("marks dispatched and pending nodes", () => {
    const d1 = snap({
      id: "d1",
      phase: "dispatch",
      toNodeId: "n1",
      toNodeName: "代码执行",
      outputPreview: "ok",
      createdAt: 1,
    });
    const d2 = snap({
      id: "d2",
      phase: "dispatch",
      toNodeId: "n2",
      toNodeName: "智能体阶段",
      outputPreview: "(待执行)",
      createdAt: 2,
    });
    const rows = buildWorkflowStageStatusRows({
      graph: graph(),
      snapshotsSorted: [d1, d2],
      taskStatus: "in_progress",
    });
    expect(rows.find((r) => r.nodeId === "s")?.status.key).toBe("reached");
    expect(rows.find((r) => r.nodeId === "n1")?.status.key).toBe("completed");
    expect(rows.find((r) => r.nodeId === "n2")?.status.key).toBe("running");
    expect(rows.find((r) => r.nodeId === "e")?.status.key).toBe("not_reached");
  });
});
