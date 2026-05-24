import type { WorkflowGraph, WorkflowGraphEdge, WorkflowGraphNode } from "../types";
import type { WorkflowGraphValidationError, WorkflowGraphValidationResult } from "./workflowGraphs";

function edgeEndpoints(edge: WorkflowGraphEdge): { source: string; target: string } | null {
  const source = typeof edge.source === "string" ? edge.source.trim() : "";
  const target = typeof edge.target === "string" ? edge.target.trim() : "";
  if (!source || !target) return null;
  return { source, target };
}

function buildAdjacency(edges: WorkflowGraphEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    const endpoints = edgeEndpoints(edge);
    if (!endpoints) continue;
    const list = adj.get(endpoints.source) ?? [];
    list.push(endpoints.target);
    adj.set(endpoints.source, list);
  }
  return adj;
}

function bfsReachable(startId: string, adj: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const queue = [startId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    for (const next of adj.get(id) ?? []) {
      if (!seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

function isExecutableNode(node: WorkflowGraphNode): boolean {
  return node.type === "task" || node.type === "approval";
}

function isAcceptanceGateway(node: WorkflowGraphNode): boolean {
  return node.type === "approval" && node.data.conditionElsePrompt?.trim() === "acceptance_enabled";
}

function allowsMultipleOutgoing(node: WorkflowGraphNode): boolean {
  if (node.type === "branch") return true;
  if (node.type === "loop") return true;
  if (isAcceptanceGateway(node)) return true;
  return false;
}

function outgoingEdges(graph: WorkflowGraph, sourceId: string): WorkflowGraphEdge[] {
  return graph.edges.filter((edge) => edgeEndpoints(edge)?.source === sourceId);
}

/** 纯前端图结构校验（与 Tauri validate_workflow_graph 规则对齐并扩展可达性检查） */
export function validateWorkflowGraphStructure(graph: WorkflowGraph): WorkflowGraphValidationResult {
  const errors: WorkflowGraphValidationError[] = [];
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];

  if (nodes.length === 0) {
    errors.push({ code: "WF_GRAPH_NODES_EMPTY", message: "nodes 不能为空" });
    return { ok: false, errors };
  }

  const nodeById = new Map<string, WorkflowGraphNode>();
  const idCounts = new Map<string, number>();
  for (const node of nodes) {
    const id = node.id?.trim();
    if (!id) {
      errors.push({ code: "WF_GRAPH_NODE_ID_MISSING", message: "节点缺少 id" });
      continue;
    }
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    nodeById.set(id, node);
    if (!node.type) {
      errors.push({ code: "WF_GRAPH_NODE_TYPE_MISSING", message: "节点缺少 type", nodeId: id });
    }
  }
  for (const [id, count] of idCounts) {
    if (count > 1) {
      errors.push({ code: "WF_GRAPH_NODE_ID_DUPLICATED", message: "存在重复的节点 id", nodeId: id });
    }
  }

  const startNodes = nodes.filter((n) => n.type === "start");
  const endNodes = nodes.filter((n) => n.type === "end");
  if (startNodes.length === 0) {
    errors.push({ code: "WF_GRAPH_START_MISSING", message: "必须包含一个 start 节点" });
  } else if (startNodes.length > 1) {
    errors.push({ code: "WF_GRAPH_START_DUPLICATED", message: "start 节点只能有一个" });
  }
  if (endNodes.length === 0) {
    errors.push({ code: "WF_GRAPH_END_MISSING", message: "必须包含至少一个 end 节点" });
  }

  if (edges.length === 0) {
    errors.push({ code: "WF_GRAPH_EDGES_EMPTY", message: "edges 不能为空" });
  }

  const edgeIdCounts = new Map<string, number>();
  for (const edge of edges) {
    const edgeId = edge.id?.trim();
    if (!edgeId) {
      errors.push({ code: "WF_GRAPH_EDGE_ID_MISSING", message: "边缺少 id" });
    } else {
      edgeIdCounts.set(edgeId, (edgeIdCounts.get(edgeId) ?? 0) + 1);
    }
    const endpoints = edgeEndpoints(edge);
    if (!endpoints) {
      errors.push({ code: "WF_GRAPH_EDGE_ENDPOINT_MISSING", message: "边缺少 source 或 target", edgeId: edge.id });
      continue;
    }
    if (!nodeById.has(endpoints.source)) {
      errors.push({
        code: "WF_GRAPH_EDGE_SOURCE_NOT_FOUND",
        message: "边的 source 节点不存在",
        nodeId: endpoints.source,
        edgeId: edge.id,
      });
    }
    if (!nodeById.has(endpoints.target)) {
      errors.push({
        code: "WF_GRAPH_EDGE_TARGET_NOT_FOUND",
        message: "边的 target 节点不存在",
        nodeId: endpoints.target,
        edgeId: edge.id,
      });
    }
  }
  for (const [id, count] of edgeIdCounts) {
    if (count > 1) {
      errors.push({ code: "WF_GRAPH_EDGE_ID_DUPLICATED", message: "存在重复的边 id", edgeId: id });
    }
  }

  for (const node of nodes) {
    if (!isExecutableNode(node)) continue;
    const id = node.id;
    const incoming = edges.filter((e) => edgeEndpoints(e)?.target === id);
    const outgoing = outgoingEdges(graph, id);
    if (incoming.length === 0) {
      errors.push({
        code: "WF_GRAPH_APPROVAL_INCOMING_MISSING",
        message: "智能体阶段至少需要一条入边",
        nodeId: id,
      });
    }
    if (outgoing.length === 0) {
      errors.push({
        code: "WF_GRAPH_APPROVAL_OUTGOING_MISSING",
        message: "智能体阶段至少需要一条出边",
        nodeId: id,
      });
    }
    const employeeId = typeof node.data.employeeId === "string" ? node.data.employeeId.trim() : "";
    if (!employeeId) {
      errors.push({
        code: "WF_GRAPH_AGENT_EMPLOYEE_MISSING",
        message: "智能体阶段未绑定执行角色",
        nodeId: id,
      });
    }
    if (outgoing.length > 1 && !allowsMultipleOutgoing(node)) {
      errors.push({
        code: "WF_GRAPH_MULTI_OUTGOING_WITHOUT_BRANCH",
        message: "非分支节点存在多条出边，运行时只会走第一条，请改用条件分支",
        nodeId: id,
      });
    }
  }

  for (const node of nodes.filter((n) => n.type === "loop")) {
    const id = node.id;
    const hasBody = outgoingEdges(graph, id).some((e) => e.sourceHandle === "loop-body");
    const hasNext = outgoingEdges(graph, id).some((e) => e.sourceHandle === "loop-next");
    if (!hasBody) {
      errors.push({ code: "WF_GRAPH_LOOP_BODY_MISSING", message: "循环节点必须包含 loop-body 出边", nodeId: id });
    }
    if (!hasNext) {
      errors.push({ code: "WF_GRAPH_LOOP_NEXT_MISSING", message: "循环节点必须包含 loop-next 出边", nodeId: id });
    }
  }

  const startId = startNodes[0]?.id;
  if (startId && nodeById.has(startId)) {
    const reachable = bfsReachable(startId, buildAdjacency(edges));
    const canReachEnd = endNodes.some((end) => reachable.has(end.id));
    if (!canReachEnd) {
      errors.push({
        code: "WF_GRAPH_END_UNREACHABLE",
        message: "从 start 无法到达任何 end 节点，请检查连线是否形成完整路径",
      });
    }
    for (const node of nodes) {
      if (node.type === "start" || node.type === "end") continue;
      if (!reachable.has(node.id)) {
        errors.push({
          code: "WF_GRAPH_NODE_UNREACHABLE",
          message: "节点从 start 不可达（孤岛节点）",
          nodeId: node.id,
        });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
