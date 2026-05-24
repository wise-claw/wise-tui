import { describe, expect, test } from "bun:test";
import type { WorkflowGraph, WorkflowGraphNode } from "../types";
import { advanceWorkflowGraph, createWorkflowRuntimeState } from "./workflowGraphRuntime";

function node(id: string, type: WorkflowGraphNode["type"], label = id): WorkflowGraphNode {
  const n: WorkflowGraphNode = { id, type, position: { x: 0, y: 0 }, data: { label } };
  if (type === "task" || type === "approval") {
    n.data.employeeId = "emp-default";
  }
  return n;
}

function simulateWorkflowRun(params: {
  graph: WorkflowGraph;
  startContent: string;
  agentOutputs: string[];
  acceptanceDecisions?: Array<"pass" | "reject">;
}): { completed: boolean; dispatchNodeIds: string[]; error?: string } {
  const { graph, startContent, agentOutputs, acceptanceDecisions = [] } = params;
  let state = createWorkflowRuntimeState(graph);
  const dispatchNodeIds: string[] = [];
  let agentIndex = 0;
  let acceptanceIndex = 0;

  try {
    for (let step = 0; step < 50; step += 1) {
      const current = graph.nodes.find((n) => n.id === state.currentNodeId);
      if (!current || current.type === "end") {
        return { completed: true, dispatchNodeIds };
      }

      const isAcceptance =
        current.type === "approval" && current.data.conditionElsePrompt?.trim() === "acceptance_enabled";
      const lastOutput = dispatchNodeIds.length > 0 ? agentOutputs[agentIndex - 1] : undefined;
      const acceptanceDecision = isAcceptance ? acceptanceDecisions[acceptanceIndex++] : undefined;

      const result = advanceWorkflowGraph({
        graph,
        state,
        startContent,
        lastOutput,
        acceptanceDecision,
      });

      state = result.state;
      if (result.completed) {
        return { completed: true, dispatchNodeIds };
      }
      if (!result.dispatch) {
        return { completed: false, dispatchNodeIds, error: "advance 未返回 dispatch 且未完成" };
      }

      dispatchNodeIds.push(result.dispatch.nodeId);
      if (agentIndex >= agentOutputs.length) {
        return { completed: false, dispatchNodeIds, error: "Agent 输出不足，流程未跑完" };
      }
      agentIndex += 1;
    }
    return { completed: false, dispatchNodeIds, error: "超过最大步数" };
  } catch (err) {
    return {
      completed: false,
      dispatchNodeIds,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

describe("workflow graph execution flow simulation", () => {
  test("linear: start → agent → end", () => {
    const start = node("start", "start");
    const agent = node("agent-1", "approval", "Agent");
    agent.data.employeeId = "emp-1";
    const end = node("end", "end");
    const graph: WorkflowGraph = {
      nodes: [start, agent, end],
      edges: [
        { id: "e1", source: "start", target: "agent-1" },
        { id: "e2", source: "agent-1", target: "end" },
      ],
    };
    const run = simulateWorkflowRun({ graph, startContent: "需求", agentOutputs: ["done"] });
    expect(run.error).toBeUndefined();
    expect(run.completed).toBe(true);
    expect(run.dispatchNodeIds).toEqual(["agent-1"]);
  });

  test("passthrough chain merges prompt/knowledge/code into agent dispatch", () => {
    const start = node("start", "start");
    start.data.workflowVariables = [{ name: "topic", label: "主题", defaultValue: "X" }];
    const prompt = node("prompt-1", "prompt", "Prompt");
    prompt.data.promptTemplate = "模板 {{topic}}";
    const knowledge = node("kb-1", "knowledge", "KB");
    knowledge.data.knowledgeQuery = "query";
    const code = node("code-1", "code", "Code");
    code.data.codeSource = "echo hi";
    const agent = node("agent-1", "approval", "Agent");
    agent.data.employeeId = "emp-1";
    const end = node("end", "end");
    const graph: WorkflowGraph = {
      nodes: [start, prompt, knowledge, code, agent, end],
      edges: [
        { id: "e1", source: "start", target: "prompt-1" },
        { id: "e2", source: "prompt-1", target: "kb-1" },
        { id: "e3", source: "kb-1", target: "code-1" },
        { id: "e4", source: "code-1", target: "agent-1" },
        { id: "e5", source: "agent-1", target: "end" },
      ],
    };
    const first = advanceWorkflowGraph({
      graph,
      state: createWorkflowRuntimeState(graph),
      startContent: "需求正文",
    });
    expect(first.dispatch?.nodeId).toBe("agent-1");
    expect(first.dispatch?.input).toContain("【提示词模板");
    expect(first.dispatch?.input).toContain("【知识检索");
    expect(first.dispatch?.input).toContain("【代码执行");
    expect(first.dispatch?.input).toContain("需求正文");

    const run = simulateWorkflowRun({ graph, startContent: "需求正文", agentOutputs: ["final"] });
    expect(run.completed).toBe(true);
    expect(run.dispatchNodeIds).toEqual(["agent-1"]);
  });

  test("branch routes by last_output rule", () => {
    const start = node("start", "start");
    const branch = node("branch-1", "branch", "Branch");
    branch.data.branchConditions = [
      {
        id: "high",
        label: "高",
        portId: "high",
        kind: "rules",
        logic: "and",
        rules: [{ source: "last_output", operator: "contains", value: "HIGH" }],
      },
      {
        id: "default",
        label: "默认",
        portId: "else",
        kind: "default",
        logic: "and",
        rules: [],
      },
    ];
    const agentHigh = node("agent-high", "approval", "High");
    agentHigh.data.employeeId = "emp-h";
    const agentLow = node("agent-low", "approval", "Low");
    agentLow.data.employeeId = "emp-l";
    const end = node("end", "end");
    const graph: WorkflowGraph = {
      nodes: [start, branch, agentHigh, agentLow, end],
      edges: [
        { id: "e1", source: "start", target: "branch-1" },
        { id: "e2", source: "branch-1", target: "agent-high", sourceHandle: "high" },
        { id: "e3", source: "branch-1", target: "agent-low", sourceHandle: "else" },
        { id: "e4", source: "agent-high", target: "end" },
        { id: "e5", source: "agent-low", target: "end" },
      ],
    };
    const lowPath = simulateWorkflowRun({ graph, startContent: "req", agentOutputs: ["ok"] });
    expect(lowPath.dispatchNodeIds[0]).toBe("agent-low");

    let state = createWorkflowRuntimeState(graph);
    state = { ...state, currentNodeId: "branch-1" };
    const highStep = advanceWorkflowGraph({
      graph,
      state,
      startContent: "req",
      lastOutput: "priority HIGH task",
    });
    expect(highStep.dispatch?.nodeId).toBe("agent-high");
  });

  test("acceptance gateway pass and reject paths", () => {
    const start = node("start", "start");
    const build = node("build", "approval", "Build");
    build.data.employeeId = "emp-b";
    const gateway = node("gw", "approval", "Gateway");
    gateway.data.employeeId = "emp-g";
    gateway.data.conditionElsePrompt = "acceptance_enabled";
    const passNode = node("pass", "approval", "Pass");
    passNode.data.employeeId = "emp-p";
    const rejectNode = node("reject", "approval", "Reject");
    rejectNode.data.employeeId = "emp-r";
    const end = node("end", "end");
    const graph: WorkflowGraph = {
      nodes: [start, build, gateway, passNode, rejectNode, end],
      edges: [
        { id: "e1", source: "start", target: "build" },
        { id: "e2", source: "build", target: "gw" },
        { id: "e3", source: "gw", target: "pass", sourceHandle: "if" },
        { id: "e4", source: "gw", target: "reject", sourceHandle: "else" },
        { id: "e5", source: "pass", target: "end" },
        { id: "e6", source: "reject", target: "end" },
      ],
    };
    const passRun = simulateWorkflowRun({
      graph,
      startContent: "req",
      agentOutputs: ["built", "gw-out", "pass-out"],
      acceptanceDecisions: ["pass"],
    });
    expect(passRun.completed).toBe(true);
    expect(passRun.dispatchNodeIds).toEqual(["build", "gw", "pass"]);

    const rejectRun = simulateWorkflowRun({
      graph,
      startContent: "req",
      agentOutputs: ["built", "gw-out", "reject-out"],
      acceptanceDecisions: ["reject"],
    });
    expect(rejectRun.completed).toBe(true);
    expect(rejectRun.dispatchNodeIds).toEqual(["build", "gw", "reject"]);
  });

  test("loop body repeats then exits to next agent", () => {
    const start = node("start", "start");
    const loop = node("loop-1", "loop", "Loop");
    loop.data.loopMaxIterations = 2;
    const body = node("body", "approval", "Body");
    body.data.employeeId = "emp-body";
    const after = node("after", "approval", "After");
    after.data.employeeId = "emp-after";
    const end = node("end", "end");
    const graph: WorkflowGraph = {
      nodes: [start, loop, body, after, end],
      edges: [
        { id: "e1", source: "start", target: "loop-1" },
        { id: "e2", source: "loop-1", target: "body", sourceHandle: "loop-body" },
        { id: "e3", source: "loop-1", target: "after", sourceHandle: "loop-next" },
        { id: "e4", source: "body", target: "loop-1", sourceHandle: "loop-back", targetHandle: "loop-back-in" },
        { id: "e5", source: "after", target: "end" },
      ],
    };
    const run = simulateWorkflowRun({
      graph,
      startContent: "req",
      agentOutputs: ["iter1", "iter2", "done"],
    });
    expect(run.error).toBeUndefined();
    expect(run.completed).toBe(true);
    expect(run.dispatchNodeIds).toEqual(["body", "body", "after"]);
  });

  test("complex: prompt → loop → branch → agent", () => {
    const start = node("start", "start");
    const prompt = node("prompt-1", "prompt", "Prompt");
    prompt.data.promptTemplate = "上下文";
    const loop = node("loop-1", "loop", "Loop");
    loop.data.loopMaxIterations = 1;
    const body = node("body", "approval", "Body");
    body.data.employeeId = "emp-body";
    const branch = node("branch-1", "branch", "Branch");
    branch.data.branchConditions = [
      { id: "else", label: "默认", portId: "else", kind: "default", logic: "and", rules: [] },
    ];
    const okAgent = node("ok-agent", "approval", "OK Agent");
    okAgent.data.employeeId = "emp-ok";
    const end = node("end", "end");
    const graph: WorkflowGraph = {
      nodes: [start, prompt, loop, body, branch, okAgent, end],
      edges: [
        { id: "e1", source: "start", target: "prompt-1" },
        { id: "e2", source: "prompt-1", target: "loop-1" },
        { id: "e3", source: "loop-1", target: "body", sourceHandle: "loop-body" },
        { id: "e4", source: "loop-1", target: "branch-1", sourceHandle: "loop-next" },
        { id: "e5", source: "body", target: "loop-1", sourceHandle: "loop-back" },
        { id: "e6", source: "branch-1", target: "ok-agent", sourceHandle: "else" },
        { id: "e7", source: "ok-agent", target: "end" },
      ],
    };
    const run = simulateWorkflowRun({ graph, startContent: "req", agentOutputs: ["body-out", "ok-out"] });
    expect(run.error).toBeUndefined();
    expect(run.completed).toBe(true);
    expect(run.dispatchNodeIds).toEqual(["body", "ok-agent"]);
  });
});

describe("workflow graph execution constraints", () => {
  test("multiple outgoing edges from agent without branch uses first edge only", () => {
    const start = node("start", "start");
    const agent = node("agent-1", "approval", "Agent");
    agent.data.employeeId = "emp-1";
    const a = node("path-a", "approval", "A");
    a.data.employeeId = "emp-a";
    const b = node("path-b", "approval", "B");
    b.data.employeeId = "emp-b";
    const end = node("end", "end");
    const graph: WorkflowGraph = {
      nodes: [start, agent, a, b, end],
      edges: [
        { id: "e1", source: "start", target: "agent-1" },
        { id: "e2", source: "agent-1", target: "path-a" },
        { id: "e3", source: "agent-1", target: "path-b" },
        { id: "e4", source: "path-a", target: "end" },
        { id: "e5", source: "path-b", target: "end" },
      ],
    };
    const run = simulateWorkflowRun({ graph, startContent: "req", agentOutputs: ["x", "y"] });
    expect(run.dispatchNodeIds[1]).toBe("path-a");
  });
});
