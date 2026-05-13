import { describe, expect, test } from "bun:test";
import type { EmployeeItem } from "../../types";
import type { CanvasSnapshot } from "../workflowGraph/workflowX6CanvasShared";
import { canvasSnapshotToStages, canvasSnapshotToWorkflowGraph } from "./workflowGraphMapping";

function makeSnapshot(): CanvasSnapshot {
  return {
    nodes: [
      { id: "start", kind: "start", title: "开始", x: 0, y: 0 },
      {
        id: "task-1",
        kind: "material",
        title: "开发",
        x: 100,
        y: 120,
        stageTask: "implement",
        employeeId: "emp-1",
        stageSuccessCriteria: [{ name: "done", requirement: "pass" }],
        stageTaskBasisRefs: ["task-0::0"],
        acceptanceEnabled: true,
        acceptanceCriteria: "approved",
      },
      { id: "end", kind: "end", title: "结束", x: 240, y: 0 },
    ],
    edges: [{ id: "edge-1", source: "start", target: "task-1", sourcePort: "bottom", targetPort: "top" }],
  };
}

describe("workflowGraphMapping", () => {
  test("converts canvas snapshot into workflow graph with fallback employee and basis refs", () => {
    const graph = canvasSnapshotToWorkflowGraph(makeSnapshot(), "emp-fallback");
    expect(graph.nodes).toHaveLength(3);
    const approval = graph.nodes.find((node) => node.type === "approval");
    expect(approval?.data.employeeId).toBe("emp-1");
    expect(approval?.data.employeePrompt).toBe("implement");
    expect(approval?.data.conditionIfPrompt).toBe("approved");
    expect(approval?.data.conditionElsePrompt).toBe("acceptance_enabled");
    expect(approval?.data.stageTaskBasisRefs).toEqual(["task-0::0"]);
    expect(graph.edges[0]).toMatchObject({
      id: "edge-1",
      source: "start",
      target: "task-1",
      sourceHandle: "bottom",
      targetHandle: "top",
    });
  });

  test("uses fallback employee when snapshot node has no assignee", () => {
    const snapshot = makeSnapshot();
    snapshot.nodes[1] = { ...snapshot.nodes[1], employeeId: undefined };
    const graph = canvasSnapshotToWorkflowGraph(snapshot, "emp-fallback");
    const approval = graph.nodes.find((node) => node.type === "approval");
    expect(approval?.data.employeeId).toBe("emp-fallback");
  });

  test("maps canvas snapshot into stages with stable ordering and fallback employee", () => {
    const employees: EmployeeItem[] = [
      { id: "emp-1", name: "A", enabled: false },
      { id: "emp-fallback", name: "B", enabled: true },
    ];
    const stages = canvasSnapshotToStages(makeSnapshot(), employees);
    expect(stages).toHaveLength(1);
    expect(stages[0]).toMatchObject({
      id: "task-1",
      name: "开发",
      stageOrder: 0,
      assignees: [{ employeeId: "emp-1", requiredCount: 1, isRequired: true }],
    });
  });

  test("omits non-material nodes from stages", () => {
    const employees: EmployeeItem[] = [{ id: "emp-1", name: "A", enabled: true }];
    const stages = canvasSnapshotToStages(
      {
        nodes: [{ id: "start", kind: "start", title: "开始", x: 0, y: 0 }],
        edges: [],
      },
      employees,
    );
    expect(stages).toEqual([]);
  });
});
