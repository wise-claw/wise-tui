import { describe, expect, test } from "bun:test";
import type { WorkflowTemplateStage } from "../types";
import { buildCanvasSnapshotFromTemplateStages, workflowGraphFromTemplateStages } from "./rebuildWorkflowGraphFromTemplateStages";

describe("rebuildWorkflowGraphFromTemplateStages", () => {
  test("builds linear snapshot with start, one stage, end", () => {
    const stages: WorkflowTemplateStage[] = [
      {
        id: "s1",
        name: "开发",
        stageOrder: 0,
        passRule: "ALL_APPROVE",
        rejectRule: "ANY_REJECT_BACK",
        assignees: [{ id: "a1", employeeId: "emp-1", requiredCount: 1, isRequired: true }],
      },
    ];
    const snap = buildCanvasSnapshotFromTemplateStages(stages);
    expect(snap.nodes.map((n) => n.id)).toEqual(["start", "s1", "end"]);
    expect(snap.edges).toHaveLength(2);
  });

  test("workflow graph passes through canvas mapping with fallback", () => {
    const stages: WorkflowTemplateStage[] = [
      {
        id: "s1",
        name: "评审",
        stageOrder: 0,
        passRule: "ALL_APPROVE",
        rejectRule: "ANY_REJECT_BACK",
        assignees: [],
      },
    ];
    const g = workflowGraphFromTemplateStages(stages, "emp-fallback");
    const approval = g.nodes.find((n) => n.type === "approval");
    expect(approval?.data.employeeId).toBe("emp-fallback");
  });
});
