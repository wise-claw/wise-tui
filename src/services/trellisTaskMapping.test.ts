import { describe, expect, test } from "bun:test";
import type { WorkflowGraph, WorkflowTaskItem } from "../types";
import { trellisTaskToWorkflowStatus, workflowTaskToTrellisDraft } from "./trellisTaskMapping";

function makeTask(overrides: Partial<WorkflowTaskItem> = {}): WorkflowTaskItem {
  return {
    id: "task-1",
    title: "Add foo",
    content: "Body explaining foo.",
    creator: "xuning",
    workflowId: "wf-1",
    currentStageIndex: 0,
    status: "in_progress",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeGraph(): WorkflowGraph {
  return {
    nodes: [
      {
        id: "node-implement",
        type: "task",
        position: { x: 0, y: 0 },
        data: {
          label: "implement",
          stageSuccessCriteria: [
            { name: "tests pass", requirement: "bun test green" },
            { name: "docs", requirement: "spec updated" },
          ],
        },
      },
    ],
    edges: [],
  };
}

describe("workflowTaskToTrellisDraft", () => {
  test("renders title body and criteria as markdown", () => {
    const draft = workflowTaskToTrellisDraft(makeTask(), makeGraph());
    expect(draft.prdMarkdown).toContain("# Add foo");
    expect(draft.prdMarkdown).toContain("Body explaining foo.");
    expect(draft.prdMarkdown).toContain("## Acceptance Criteria");
    expect(draft.prdMarkdown).toContain("- **tests pass** — bun test green");
    expect(draft.prdMarkdown).toContain("- **docs** — spec updated");
    expect(draft.statusForTrellis).toBe("in_progress");
  });

  test("omits criteria section when graph is missing", () => {
    const draft = workflowTaskToTrellisDraft(makeTask());
    expect(draft.prdMarkdown).not.toContain("Acceptance Criteria");
  });

  test("omits criteria section when graph has only start/end nodes", () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: "start", type: "start", position: { x: 0, y: 0 }, data: { label: "start" } },
        { id: "end", type: "end", position: { x: 0, y: 0 }, data: { label: "end" } },
      ],
      edges: [],
    };
    const draft = workflowTaskToTrellisDraft(makeTask(), graph);
    expect(draft.prdMarkdown).not.toContain("Acceptance Criteria");
  });

  test("falls back to task id when title is empty", () => {
    const draft = workflowTaskToTrellisDraft(makeTask({ title: "" }));
    expect(draft.prdMarkdown.startsWith("# task-1")).toBe(true);
  });

  test("skips body section when task content is whitespace", () => {
    const draft = workflowTaskToTrellisDraft(makeTask({ content: "   \n  " }));
    expect(draft.prdMarkdown.trim()).toBe("# Add foo");
  });

  test("maps each workflow status to a trellis equivalent", () => {
    expect(workflowTaskToTrellisDraft(makeTask({ status: "completed" })).statusForTrellis).toBe(
      "completed",
    );
    expect(workflowTaskToTrellisDraft(makeTask({ status: "rejected" })).statusForTrellis).toBe(
      "rejected",
    );
    expect(workflowTaskToTrellisDraft(makeTask({ status: "archived" })).statusForTrellis).toBe(
      "archived",
    );
  });

  test("collapses 3+ blank lines in rendered markdown", () => {
    const draft = workflowTaskToTrellisDraft(
      makeTask({ content: "First line.\n\n\n\nSecond line." }),
    );
    expect(draft.prdMarkdown).not.toContain("\n\n\n");
  });
});

describe("trellisTaskToWorkflowStatus", () => {
  test("maps known statuses", () => {
    expect(trellisTaskToWorkflowStatus("in_progress")).toBe("in_progress");
    expect(trellisTaskToWorkflowStatus("completed")).toBe("completed");
    expect(trellisTaskToWorkflowStatus("rejected")).toBe("rejected");
    expect(trellisTaskToWorkflowStatus("archived")).toBe("archived");
    expect(trellisTaskToWorkflowStatus("planning")).toBe("in_progress");
  });

  test("returns null for unknown statuses", () => {
    expect(trellisTaskToWorkflowStatus("foo")).toBe(null);
    expect(trellisTaskToWorkflowStatus("")).toBe(null);
  });
});
