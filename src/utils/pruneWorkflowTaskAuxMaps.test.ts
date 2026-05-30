import { describe, expect, test } from "bun:test";
import type { WorkflowTaskItem } from "../types";
import {
  mergeWorkflowTasksForSession,
  pruneRecordByTaskIds,
  removeWorkflowTasksForSessionCreators,
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
