import { describe, expect, it } from "bun:test";
import type { WorkflowRuntimeStepSnapshot } from "../types";
import { findLatestRuntimeSnapshotForGraphNode } from "./findLatestRuntimeSnapshotForGraphNode";

function snap(
  partial: Partial<WorkflowRuntimeStepSnapshot> & Pick<WorkflowRuntimeStepSnapshot, "id" | "createdAt" | "toNodeId">,
): WorkflowRuntimeStepSnapshot {
  return {
    taskId: "t1",
    phase: "dispatch",
    inputPreview: "",
    outputPreview: "",
    ...partial,
  };
}

describe("findLatestRuntimeSnapshotForGraphNode", () => {
  it("returns latest matching snapshot with executorSessionId", () => {
    const list = [
      snap({ id: "a", createdAt: 1, toNodeId: "n1", executorSessionId: "s-old" }),
      snap({ id: "b", createdAt: 2, toNodeId: "n1", executorSessionId: "s-new" }),
    ];
    const hit = findLatestRuntimeSnapshotForGraphNode(list, "n1");
    expect(hit?.id).toBe("b");
    expect(hit?.executorSessionId).toBe("s-new");
  });

  it("ignores snapshots without executorSessionId", () => {
    const list = [snap({ id: "a", createdAt: 1, toNodeId: "n1" }), snap({ id: "b", createdAt: 2, toNodeId: "n1", executorSessionId: "s1" })];
    const hit = findLatestRuntimeSnapshotForGraphNode(list, "n1");
    expect(hit?.id).toBe("b");
  });

  it("returns undefined when no match", () => {
    expect(findLatestRuntimeSnapshotForGraphNode([], "n1")).toBeUndefined();
    expect(findLatestRuntimeSnapshotForGraphNode([snap({ id: "a", createdAt: 1, toNodeId: "n2", executorSessionId: "s" })], "n1")).toBeUndefined();
  });
});
