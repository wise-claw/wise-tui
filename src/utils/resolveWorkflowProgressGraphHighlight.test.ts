import { describe, expect, it } from "bun:test";
import type { WorkflowGraph, WorkflowRuntimeStepSnapshot } from "../types";
import { resolveWorkflowProgressGraphHighlight } from "./resolveWorkflowProgressGraphHighlight";

const graph: WorkflowGraph = {
  nodes: [
    { id: "s", type: "start", position: { x: 0, y: 0 }, data: { label: "S" } },
    { id: "a", type: "approval", position: { x: 100, y: 0 }, data: { label: "A" } },
    { id: "e", type: "end", position: { x: 200, y: 0 }, data: { label: "E" } },
  ],
  edges: [
    { id: "e1", source: "s", target: "a" },
    { id: "e2", source: "a", target: "e" },
  ],
};

function snap(partial: Partial<WorkflowRuntimeStepSnapshot> & Pick<WorkflowRuntimeStepSnapshot, "id" | "createdAt">): WorkflowRuntimeStepSnapshot {
  return {
    taskId: "t1",
    phase: "dispatch",
    inputPreview: "",
    outputPreview: "",
    ...partial,
  };
}

describe("resolveWorkflowProgressGraphHighlight", () => {
  it("returns flow edge for in_progress when from/to present", () => {
    const snapshots = [
      snap({ id: "1", createdAt: 1, fromNodeId: "s", toNodeId: "a" }),
      snap({ id: "2", createdAt: 2, fromNodeId: "a", toNodeId: "e" }),
    ];
    const r = resolveWorkflowProgressGraphHighlight({
      graph,
      snapshotsSorted: snapshots,
      taskStatus: "in_progress",
    });
    expect(r.activeNodeId).toBe("e");
    expect(r.flowSourceId).toBe("a");
    expect(r.flowTargetId).toBe("e");
  });

  it("clears flow when from missing", () => {
    const snapshots = [snap({ id: "1", createdAt: 1, toNodeId: "a" })];
    const r = resolveWorkflowProgressGraphHighlight({
      graph,
      snapshotsSorted: snapshots,
      taskStatus: "in_progress",
    });
    expect(r.activeNodeId).toBe("a");
    expect(r.flowSourceId).toBeNull();
    expect(r.flowTargetId).toBeNull();
  });

  it("completed uses end-ish last target and no flow", () => {
    const snapshots = [snap({ id: "1", createdAt: 1, fromNodeId: "a", toNodeId: "e" })];
    const r = resolveWorkflowProgressGraphHighlight({
      graph,
      snapshotsSorted: snapshots,
      taskStatus: "completed",
    });
    expect(r.activeNodeId).toBe("e");
    expect(r.flowSourceId).toBeNull();
  });
});
