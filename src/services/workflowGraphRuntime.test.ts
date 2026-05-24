import { describe, expect, test } from "bun:test";
import type { WorkflowGraph, WorkflowGraphNode } from "../types";
import {
  advanceWorkflowGraph,
  composeDispatchInput,
  createWorkflowRuntimeState,
  formatStageTaskBasisBlock,
  normalizeStageTaskBasisRefsFromNodeData,
  parseStageTaskBasisRef,
  resolveWorkflowDispatchNodeType,
} from "./workflowGraphRuntime";

function node(id: string, type: WorkflowGraphNode["type"], label = id): WorkflowGraphNode {
  const n: WorkflowGraphNode = {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label },
  };
  if (type === "task" || type === "approval") {
    n.data.employeeId = "emp-default";
  }
  return n;
}

function graphWithAcceptance(): WorkflowGraph {
  const start = node("start", "start", "Start");
  const task = node("task-1", "task", "Build");
  const approval = node("approval-1", "approval", "Review");
  approval.data.conditionElsePrompt = "acceptance_enabled";
  approval.data.conditionIfPrompt = "Must satisfy the acceptance contract.";
  const passed = node("task-pass", "task", "Follow Up");
  const rejected = node("task-reject", "task", "Fix");
  const end = node("end", "end", "End");

  return {
    nodes: [start, task, approval, passed, rejected, end],
    edges: [
      { id: "e1", source: "start", target: "task-1" },
      { id: "e2", source: "task-1", target: "approval-1" },
      { id: "e3", source: "approval-1", target: "task-pass", sourceHandle: "if" },
      { id: "e4", source: "approval-1", target: "task-reject", sourceHandle: "else" },
      { id: "e5", source: "task-pass", target: "end" },
      { id: "e6", source: "task-reject", target: "end" },
    ],
  };
}

function graphWithLoop(maxIterations = 3): WorkflowGraph {
  const start = node("start", "start", "Start");
  const loop = node("loop-1", "loop", "Loop");
  loop.data.loopMaxIterations = maxIterations;
  loop.data.loopVariables = [{ name: "counter", label: "计数", defaultValue: "0" }];
  const bodyTask = node("body-task", "task", "Body Task");
  const afterTask = node("after-task", "task", "After Loop");
  const end = node("end", "end", "End");

  return {
    nodes: [start, loop, bodyTask, afterTask, end],
    edges: [
      { id: "e1", source: "start", target: "loop-1" },
      { id: "e2", source: "loop-1", target: "body-task", sourceHandle: "loop-body" },
      { id: "e3", source: "loop-1", target: "after-task", sourceHandle: "loop-next" },
      { id: "e4", source: "body-task", target: "loop-1", sourceHandle: "loop-back", targetHandle: "loop-back-in" },
      { id: "e5", source: "after-task", target: "end" },
    ],
  };
}

describe("stage task basis helpers", () => {
  test("parses and normalizes stage task basis refs", () => {
    expect(parseStageTaskBasisRef("source-node#2")).toEqual({ sourceNodeId: "source-node", index: 2 });
    expect(parseStageTaskBasisRef("source-node#bad")).toBeNull();
    expect(normalizeStageTaskBasisRefsFromNodeData({
      label: "Node",
      stageTaskBasisRefs: [" a#0 ", "a#0", "", "b#1"],
    })).toEqual(["a#0", "b#1"]);
    expect(normalizeStageTaskBasisRefsFromNodeData({
      label: "Node",
      stageTaskBasisRef: "legacy#0",
    })).toEqual(["legacy#0"]);
  });

  test("formats selected stage outcome criteria into dispatch basis text", () => {
    const source = node("source", "task", "Source Stage");
    source.data.stageSuccessCriteria = [
      { name: "Artifact", requirement: "Deliver the artifact." },
    ];
    const target = node("target", "task", "Target Stage");
    target.data.stageTaskBasisRefs = ["source#0"];
    const block = formatStageTaskBasisBlock(target, { nodes: [source, target], edges: [] });

    expect(block).toContain("阶段任务依据");
    expect(block).toContain("Source Stage");
    expect(block).toContain("Deliver the artifact.");
  });
});

describe("workflow graph runtime", () => {
  test("creates runtime state from the start node", () => {
    const graph = graphWithAcceptance();

    expect(createWorkflowRuntimeState(graph)).toEqual({
      currentNodeId: "start",
      trace: ["start"],
    });
  });

  test("advances from start to the first dispatch node", () => {
    const graph = graphWithAcceptance();
    const state = createWorkflowRuntimeState(graph);
    const result = advanceWorkflowGraph({
      graph,
      state,
      startContent: "original user request",
    });

    expect(result.completed).toBe(false);
    expect(result.state.currentNodeId).toBe("task-1");
    expect(result.state.trace).toEqual(["start", "task-1"]);
    expect(result.dispatch).toMatchObject({
      nodeId: "task-1",
      nodeType: "task",
      employeeName: "Build",
      input: "original user request",
    });
  });

  test("selects pass and reject acceptance edges by handle", () => {
    const graph = graphWithAcceptance();
    const approvalState = { currentNodeId: "approval-1", trace: ["start", "task-1", "approval-1"] };

    const passed = advanceWorkflowGraph({
      graph,
      state: approvalState,
      startContent: "request",
      acceptanceDecision: "pass",
    });
    expect(passed.state.currentNodeId).toBe("task-pass");
    expect(passed.dispatch?.input).toBe("request");

    const rejected = advanceWorkflowGraph({
      graph,
      state: approvalState,
      startContent: "request",
      acceptanceDecision: "reject",
    });
    expect(rejected.state.currentNodeId).toBe("task-reject");
  });

  test("requires explicit acceptance decision for acceptance-enabled nodes", () => {
    const graph = graphWithAcceptance();

    expect(() => advanceWorkflowGraph({
      graph,
      state: { currentNodeId: "approval-1", trace: ["start", "task-1", "approval-1"] },
      startContent: "request",
    })).toThrow("WF_ACCEPTANCE_DECISION_REQUIRED");
  });

  test("returns completed when the next node is end", () => {
    const graph = graphWithAcceptance();
    const result = advanceWorkflowGraph({
      graph,
      state: { currentNodeId: "task-pass", trace: ["start", "task-1", "approval-1", "task-pass"] },
      startContent: "request",
      lastOutput: "done",
    });

    expect(result.completed).toBe(true);
    expect(result.dispatch).toBeUndefined();
    expect(result.state.currentNodeId).toBe("end");
    expect(result.state.lastOutput).toBe("done");
  });

  test("enters loop body on first advance and exposes loop variables", () => {
    const graph = graphWithLoop();
    const result = advanceWorkflowGraph({
      graph,
      state: createWorkflowRuntimeState(graph),
      startContent: "run loop",
    });

    expect(result.dispatch?.nodeId).toBe("body-task");
    expect(result.state.loopStack?.[0]).toMatchObject({ loopNodeId: "loop-1", iteration: 1 });
    expect(result.state.trace).toContain("loop-1");
  });

  test("repeats loop body until max iterations then exits via loop-next", () => {
    const graph = graphWithLoop(2);
    let state = createWorkflowRuntimeState(graph);
    let result = advanceWorkflowGraph({ graph, state, startContent: "run" });
    expect(result.dispatch?.nodeId).toBe("body-task");

    state = result.state;
    result = advanceWorkflowGraph({ graph, state, startContent: "run", lastOutput: "iter-1" });
    expect(result.dispatch?.nodeId).toBe("body-task");
    expect(result.state.loopStack?.[0]?.iteration).toBe(2);

    state = result.state;
    result = advanceWorkflowGraph({ graph, state, startContent: "run", lastOutput: "iter-2" });
    expect(result.dispatch?.nodeId).toBe("after-task");
    expect(result.state.loopStack).toBeUndefined();
  });

  test("exits loop early when termination condition matches", () => {
    const graph = graphWithLoop(10);
    graph.nodes.find((item) => item.id === "loop-1")!.data.loopExitConditions = [
      {
        id: "exit-1",
        label: "done",
        portId: "exit-1",
        kind: "rules",
        logic: "and",
        rules: [{ source: "last_output", operator: "contains", value: "READY" }],
      },
    ];

    let state = createWorkflowRuntimeState(graph);
    let result = advanceWorkflowGraph({ graph, state, startContent: "run" });
    expect(result.dispatch?.nodeId).toBe("body-task");

    state = result.state;
    result = advanceWorkflowGraph({ graph, state, startContent: "run", lastOutput: "status READY now" });
    expect(result.dispatch?.nodeId).toBe("after-task");
    expect(result.state.loopStack).toBeUndefined();
  });
});

describe("dispatch input composition", () => {
  test("approval nodes without acceptance flag dispatch as task nodes", () => {
    const approval = node("approval", "approval", "Manual Review");

    expect(resolveWorkflowDispatchNodeType(approval)).toBe("task");
  });

  test("acceptance-enabled approval prompt includes machine-readable verdict instructions", () => {
    const approval = node("approval", "approval", "Acceptance");
    approval.data.conditionElsePrompt = "acceptance_enabled";
    approval.data.conditionIfPrompt = "Must pass all criteria.";
    const input = composeDispatchInput(approval, "Base request");

    expect(resolveWorkflowDispatchNodeType(approval)).toBe("approval");
    expect(input).toContain("workflowAcceptanceVerdict");
    expect(input).toContain("Must pass all criteria.");
  });

  test("advances through prompt passthrough nodes and merges template into dispatch input", () => {
    const start = node("start", "start", "Start");
    start.data.workflowVariables = [{ name: "topic", label: "主题", defaultValue: "Wise" }];
    const prompt = node("prompt-1", "prompt", "Template");
    prompt.data.promptTemplate = "请围绕 {{topic}} 编写方案";
    const task = node("task-1", "task", "Build");
    const end = node("end", "end", "End");
    const graph: WorkflowGraph = {
      nodes: [start, prompt, task, end],
      edges: [
        { id: "e1", source: "start", target: "prompt-1" },
        { id: "e2", source: "prompt-1", target: "task-1" },
        { id: "e3", source: "task-1", target: "end" },
      ],
    };
    const result = advanceWorkflowGraph({
      graph,
      state: createWorkflowRuntimeState(graph),
      startContent: "原始需求",
    });
    expect(result.dispatch?.nodeId).toBe("task-1");
    expect(result.dispatch?.input).toContain("【提示词模板 · 多段消息】");
    expect(result.dispatch?.input).toContain("请围绕 Wise 编写方案");
    expect(result.dispatch?.input).toContain("原始需求");
  });
});
