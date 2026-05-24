import { describe, expect, test } from "bun:test";
import type { WorkflowGraph, WorkflowGraphNode } from "../types";
import { resolveGraphRollbackNode } from "./workflowGraphRuntime";
import { validateWorkflowGraphStructure } from "./workflowGraphValidation";

function node(id: string, type: WorkflowGraphNode["type"], label = id): WorkflowGraphNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label } };
}

function agent(id: string, label = id, employeeId = "emp-1"): WorkflowGraphNode {
  const n = node(id, "approval", label);
  n.data.employeeId = employeeId;
  return n;
}

describe("validateWorkflowGraphStructure", () => {
  test("accepts a minimal valid linear graph", () => {
    const graph: WorkflowGraph = {
      nodes: [node("start", "start"), agent("a1"), node("end", "end")],
      edges: [
        { id: "e1", source: "start", target: "a1" },
        { id: "e2", source: "a1", target: "end" },
      ],
    };
    expect(validateWorkflowGraphStructure(graph).ok).toBe(true);
  });

  test("rejects missing end and unreachable island", () => {
    const graph: WorkflowGraph = {
      nodes: [node("start", "start"), agent("a1"), agent("island", "Island")],
      edges: [{ id: "e1", source: "start", target: "a1" }],
    };
    const result = validateWorkflowGraphStructure(graph);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "WF_GRAPH_END_MISSING")).toBe(true);
    expect(result.errors.some((e) => e.code === "WF_GRAPH_NODE_UNREACHABLE")).toBe(true);
  });

  test("rejects agent without employee and multi-outgoing without branch", () => {
    const a = node("a1", "approval", "A");
    const graph: WorkflowGraph = {
      nodes: [node("start", "start"), a, agent("b1", "B"), node("end", "end")],
      edges: [
        { id: "e1", source: "start", target: "a1" },
        { id: "e2", source: "a1", target: "b1" },
        { id: "e3", source: "a1", target: "end" },
        { id: "e4", source: "b1", target: "end" },
      ],
    };
    const result = validateWorkflowGraphStructure(graph);
    expect(result.errors.some((e) => e.code === "WF_GRAPH_AGENT_EMPLOYEE_MISSING")).toBe(true);
    expect(result.errors.some((e) => e.code === "WF_GRAPH_MULTI_OUTGOING_WITHOUT_BRANCH")).toBe(true);
  });
});

describe("resolveGraphRollbackNode", () => {
  test("prefers lastNodeId over linear stage order", () => {
    const graph: WorkflowGraph = {
      nodes: [
        node("start", "start"),
        agent("build", "Build", "e1"),
        agent("gw", "Gateway", "e2"),
        agent("fix", "Fix", "e3"),
        node("end", "end"),
      ],
      edges: [],
    };
    const rollback = resolveGraphRollbackNode(
      graph,
      {
        currentNodeId: "gw",
        lastNodeId: "build",
        trace: ["start", "build", "gw"],
      },
      "gw",
    );
    expect(rollback?.id).toBe("build");
  });

  test("falls back to trace when lastNodeId missing", () => {
    const graph: WorkflowGraph = {
      nodes: [node("start", "start"), agent("build", "Build"), agent("gw", "Gateway"), node("end", "end")],
      edges: [],
    };
    const rollback = resolveGraphRollbackNode(
      graph,
      { currentNodeId: "gw", trace: ["start", "build", "gw"] },
      "gw",
    );
    expect(rollback?.id).toBe("build");
  });
});
