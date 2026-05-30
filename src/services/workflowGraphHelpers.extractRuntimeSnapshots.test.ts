import { describe, expect, it } from "bun:test";
import type { WorkflowTaskEventItem, WorkflowRuntimeStepSnapshot } from "../types";
import { extractRuntimeSnapshotsFromEvents, capWorkflowRuntimeSnapshots, WORKFLOW_RUNTIME_SNAPSHOTS_IN_MEMORY_MAX } from "./workflowGraphHelpers";

function ev(partial: Partial<WorkflowTaskEventItem> & Pick<WorkflowTaskEventItem, "id" | "taskId" | "eventType" | "createdAt">): WorkflowTaskEventItem {
  return {
    payloadJson: "{}",
    ...partial,
  };
}

describe("extractRuntimeSnapshotsFromEvents", () => {
  it("merges workflow_runtime_snapshot_executor after snapshot", () => {
    const snap: WorkflowRuntimeStepSnapshot = {
      id: "snap-1",
      taskId: "t1",
      phase: "dispatch",
      toNodeId: "n1",
      inputPreview: "in",
      outputPreview: "(待执行)",
      createdAt: 100,
    };
    const events: WorkflowTaskEventItem[] = [
      ev({
        id: "e1",
        taskId: "t1",
        eventType: "workflow_runtime_snapshot",
        createdAt: 100,
        payloadJson: JSON.stringify({ snapshot: snap }),
      }),
      ev({
        id: "e2",
        taskId: "t1",
        eventType: "workflow_runtime_snapshot_executor",
        createdAt: 101,
        payloadJson: JSON.stringify({ snapshotId: "snap-1", executorSessionId: "sess-a" }),
      }),
    ];
    const out = extractRuntimeSnapshotsFromEvents(events);
    expect(out).toHaveLength(1);
    expect(out[0]?.executorSessionId).toBe("sess-a");
  });

  it("merges executor patch when executor event sorts before snapshot", () => {
    const snap: WorkflowRuntimeStepSnapshot = {
      id: "snap-1",
      taskId: "t1",
      phase: "dispatch",
      toNodeId: "n1",
      inputPreview: "in",
      outputPreview: "(待执行)",
      createdAt: 200,
    };
    const events: WorkflowTaskEventItem[] = [
      ev({
        id: "e2",
        taskId: "t1",
        eventType: "workflow_runtime_snapshot_executor",
        createdAt: 50,
        payloadJson: JSON.stringify({ snapshotId: "snap-1", executorSessionId: "sess-b" }),
      }),
      ev({
        id: "e1",
        taskId: "t1",
        eventType: "workflow_runtime_snapshot",
        createdAt: 200,
        payloadJson: JSON.stringify({ snapshot: snap }),
      }),
    ];
    const out = extractRuntimeSnapshotsFromEvents(events);
    expect(out[0]?.executorSessionId).toBe("sess-b");
  });

  it("caps retained runtime snapshots and preview fields", () => {
    const snapshots = Array.from({ length: WORKFLOW_RUNTIME_SNAPSHOTS_IN_MEMORY_MAX + 3 }, (_, index) => ({
      id: `snap-${index}`,
      taskId: "t1",
      phase: "dispatch" as const,
      inputPreview: "x".repeat(10_000),
      outputPreview: "y".repeat(10_000),
      createdAt: index,
    }));
    const capped = capWorkflowRuntimeSnapshots(snapshots);
    expect(capped.length).toBe(WORKFLOW_RUNTIME_SNAPSHOTS_IN_MEMORY_MAX);
    expect(capped[0]?.id).toBe("snap-3");
    expect(capped[0]?.inputPreview.length).toBeLessThanOrEqual(8_000);
  });
});
