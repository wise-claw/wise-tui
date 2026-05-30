import { describe, expect, test } from "bun:test";
import type { WorkflowTaskEventItem, WorkflowTaskItem } from "../types";
import {
  mergeWorkflowTasksForSession,
  capWorkflowTaskEvents,
  pruneRecordByTaskIds,
  removeWorkflowTasksForSessionCreators,
  WORKFLOW_TASK_EVENTS_IN_MEMORY_MAX,
} from "./pruneWorkflowTaskAuxMaps";

function task(id: string, creator: string, status: WorkflowTaskItem["status"], updatedAt: number): WorkflowTaskItem {
  return {
    id,
    title: id,
    content: "",
    creator,
    workflowId: "wf",
    currentStageIndex: 0,
    status,
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("pruneRecordByTaskIds", () => {
  test("drops entries not in live task id set", () => {
    const next = pruneRecordByTaskIds(
      { a: [1], b: [2], c: [3] },
      new Set(["a", "c"]),
      [["c", [4]] as const],
    );
    expect(next).toEqual({ a: [1], c: [4] });
  });
});

describe("mergeWorkflowTasksForSession", () => {
  test("replaces active session tasks and drops stale completed tasks from others", () => {
    const now = Date.now();
    const prev = [
      task("old-active", "sess-a", "completed", now),
      task("stale-other", "sess-b", "completed", now - 8 * 24 * 60 * 60 * 1000),
      task("fresh-other", "sess-b", "completed", now - 1000),
    ];
    const merged = mergeWorkflowTasksForSession(prev, "sess-a", [
      task("new-active", "sess-a", "in_progress", now),
    ]);
    expect(merged.map((t) => t.id).sort()).toEqual(["fresh-other", "new-active"]);
  });
});

describe("removeWorkflowTasksForSessionCreators", () => {
  test("removes tasks owned by closed session ids", () => {
    const tasks = [task("t1", "sess-a", "completed", 1), task("t2", "sess-b", "completed", 2)];
    const next = removeWorkflowTasksForSessionCreators(tasks, new Set(["sess-a"]));
    expect(next.map((t) => t.id)).toEqual(["t2"]);
  });
});

describe("capWorkflowTaskEvents", () => {
  test("keeps tail events only when over max", () => {
    const events = Array.from({ length: WORKFLOW_TASK_EVENTS_IN_MEMORY_MAX + 5 }, (_, index) => ({
      id: `e-${index}`,
      taskId: "t1",
      type: "task.run.progressed",
      timestamp: index,
      payload: {},
    })) as WorkflowTaskEventItem[];
    const capped = capWorkflowTaskEvents(events);
    expect(capped.length).toBe(WORKFLOW_TASK_EVENTS_IN_MEMORY_MAX);
    expect(capped[0]?.id).toBe("e-5");
    expect(capped.at(-1)?.id).toBe(`e-${WORKFLOW_TASK_EVENTS_IN_MEMORY_MAX + 4}`);
  });
});
