import { describe, expect, test } from "bun:test";
import type { ExecutionFanoutSnapshot } from "./executionFanout";
import {
  appendPrdSplitLoopFeedbackEntry,
  buildPrdSplitLoopFeedbackEntry,
} from "./specFeedback";

describe("PRD split loop feedback", () => {
  test("renders six-step anchor evidence and Spec follow-ups", () => {
    const entry = buildPrdSplitLoopFeedbackEntry({
      project: { id: "p1", name: "Wise", rootPath: "/work/wise" },
      missionId: "mission-p1-hash",
      workflowId: "wf-prd",
      fanoutFailedCount: 0,
      createdAt: Date.UTC(2026, 4, 25, 8, 0, 0),
      clusters: [{
        cluster: {
          id: "cluster-fe",
          title: "Frontend",
          primaryRepositoryId: 1,
          repositoryIds: [1],
          requirementIds: ["REQ-1"],
          dependencyClusterIds: [],
        },
        parentTaskName: "05-25-prd",
        childTasks: [{
          sourceTaskId: "task-a",
          taskName: "05-25-ui",
          taskPath: "/work/wise/.trellis/tasks/05-25-prd/05-25-ui",
        }],
        tasks: [{
          sourceTaskId: "task-a",
          title: "Build PRD task tree",
          role: "frontend",
          dependencies: [],
          sourceRequirementIds: ["REQ-1"],
          taskAnchors: {
            from: 12,
            to: 40,
            textHash: "abcdef1234567890",
            contextBefore: "before",
            contextAfter: "after",
          },
        }],
      }],
      writeResults: [{
        clusterId: "cluster-fe",
        parentTaskName: "05-25-prd",
        childTaskNames: ["05-25-ui"],
        childTasks: [{
          sourceTaskId: "task-a",
          taskName: "05-25-ui",
          taskPath: "/work/wise/.trellis/tasks/05-25-prd/05-25-ui",
        }],
        fanoutSnapshot: fanoutSnapshot(),
        warnings: [],
      }],
    });

    expect(entry).toContain("### Six-Step Trace");
    expect(entry).toContain("| 4. Task anchors | 1/1 anchored |");
    expect(entry).toContain("abcdef1234567890 [12, 40]");
    expect(entry).toContain("wf-1");
    expect(entry).toContain("- Verify: passed 1/1; failed 0");
    expect(entry).toContain("Use the trellis-check evidence");
    expect(entry).toContain("If Verify finds repeated anchor, dependency, runtime, or handoff defects");
  });

  test("appends to a stable feedback header", () => {
    const next = appendPrdSplitLoopFeedbackEntry("", "## Entry\n\n- A\n");

    expect(next).toStartWith("# PRD Assistant Loop Feedback");
    expect(next).toContain("## Entry");
  });
});

function fanoutSnapshot(): ExecutionFanoutSnapshot {
  return {
    status: "succeeded",
    workflowRunId: "wf-1",
    workflowRunIds: ["wf-1"],
    totalCount: 1,
    doneCount: 1,
    failedCount: 0,
    verifyDoneCount: 1,
    verifyFailedCount: 0,
    waves: [],
    lifecycleStages: [
      { key: "dispatch", label: "Dispatch", status: "done" },
      { key: "run", label: "Run", status: "done" },
      { key: "verify", label: "Verify", status: "done" },
      { key: "spec", label: "Spec", status: "active" },
    ],
  };
}
