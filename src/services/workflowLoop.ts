import type { WorkflowGraph, WorkflowGraphEdge, WorkflowGraphNode } from "../types";
import type { WorkflowBranchCondition } from "../types/workflowBranch";
import type { WorkflowLoopFrame } from "../types/workflowLoop";
import {
  DEFAULT_WORKFLOW_LOOP_MAX_ITERATIONS,
  MAX_WORKFLOW_LOOP_MAX_ITERATIONS,
  MIN_WORKFLOW_LOOP_MAX_ITERATIONS,
  WORKFLOW_LOOP_BACK_PORT,
  WORKFLOW_LOOP_BODY_PORT,
  WORKFLOW_LOOP_NEXT_PORT,
} from "../types/workflowLoop";
import { normalizeWorkflowVariables, workflowVariablesToRecord } from "../utils/workflowVariables";
import { matchesAnyBranchCondition, normalizeBranchConditions, type BranchEvaluationContext } from "./workflowBranchEvaluation";

export {
  WORKFLOW_LOOP_BACK_PORT,
  WORKFLOW_LOOP_BODY_PORT,
  WORKFLOW_LOOP_NEXT_PORT,
} from "../types/workflowLoop";

export function normalizeLoopMaxIterations(raw: unknown): number {
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_WORKFLOW_LOOP_MAX_ITERATIONS;
  return Math.min(MAX_WORKFLOW_LOOP_MAX_ITERATIONS, Math.max(MIN_WORKFLOW_LOOP_MAX_ITERATIONS, Math.round(parsed)));
}

export function normalizeLoopExitConditions(raw: unknown): WorkflowBranchCondition[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return normalizeBranchConditions(raw).filter((item) => item.kind !== "default");
}

export function loopConfigFromNodeData(data: WorkflowGraphNode["data"]): {
  loopVariables: ReturnType<typeof normalizeWorkflowVariables>;
  loopExitConditions: WorkflowBranchCondition[];
  loopMaxIterations: number;
} {
  return {
    loopVariables: normalizeWorkflowVariables(data.loopVariables),
    loopExitConditions: normalizeLoopExitConditions(data.loopExitConditions),
    loopMaxIterations: normalizeLoopMaxIterations(data.loopMaxIterations),
  };
}

export function summarizeLoopConfig(data: WorkflowGraphNode["data"]): string {
  const config = loopConfigFromNodeData(data);
  const parts: string[] = [`最多 ${config.loopMaxIterations} 次`];
  if (config.loopVariables.length > 0) {
    parts.push(`${config.loopVariables.length} 个循环变量`);
  }
  if (config.loopExitConditions.length > 0) {
    parts.push(`${config.loopExitConditions.length} 条终止条件`);
  } else {
    parts.push("仅按次数终止");
  }
  return parts.join(" · ");
}

function outgoingEdges(graph: WorkflowGraph, sourceId: string): WorkflowGraphEdge[] {
  return graph.edges.filter((edge) => edge.source === sourceId);
}

export function findLoopBodyEdge(graph: WorkflowGraph, loopNodeId: string): WorkflowGraphEdge {
  const edge = outgoingEdges(graph, loopNodeId).find((item) => item.sourceHandle === WORKFLOW_LOOP_BODY_PORT);
  if (!edge) {
    throw new Error(`WF_LOOP_BODY_EDGE_MISSING:${loopNodeId}`);
  }
  return edge;
}

export function findLoopNextEdge(graph: WorkflowGraph, loopNodeId: string): WorkflowGraphEdge {
  const edge = outgoingEdges(graph, loopNodeId).find((item) => item.sourceHandle === WORKFLOW_LOOP_NEXT_PORT);
  if (!edge) {
    throw new Error(`WF_LOOP_NEXT_EDGE_MISSING:${loopNodeId}`);
  }
  return edge;
}

export function isLoopBackEdge(edge: WorkflowGraphEdge, loopNodeId: string): boolean {
  return edge.sourceHandle === WORKFLOW_LOOP_BACK_PORT && edge.target === loopNodeId;
}

export function createLoopFrame(loopNode: WorkflowGraphNode): WorkflowLoopFrame {
  const config = loopConfigFromNodeData(loopNode.data);
  return {
    loopNodeId: loopNode.id,
    iteration: 1,
    variables: workflowVariablesToRecord(config.loopVariables),
  };
}

export function shouldExitLoop(params: {
  loopNode: WorkflowGraphNode;
  iteration: number;
  ctx: BranchEvaluationContext;
}): boolean {
  const config = loopConfigFromNodeData(params.loopNode.data);
  if (params.iteration >= config.loopMaxIterations) {
    return true;
  }
  if (config.loopExitConditions.length === 0) {
    return false;
  }
  return matchesAnyBranchCondition(config.loopExitConditions, params.ctx);
}

export function mergeLoopVariablesIntoContext(
  graph: WorkflowGraph,
  loopStack: WorkflowLoopFrame[] | undefined,
  baseVariables: Record<string, string>,
): Record<string, string> {
  const frame = loopStack?.[loopStack.length - 1];
  if (!frame) return baseVariables;
  const loopNode = graph.nodes.find((node) => node.id === frame.loopNodeId);
  const loopDefaults = loopNode ? workflowVariablesToRecord(loopConfigFromNodeData(loopNode.data).loopVariables) : {};
  return {
    ...baseVariables,
    ...loopDefaults,
    ...frame.variables,
    loop_index: String(frame.iteration),
    loop_iteration: String(frame.iteration),
  };
}
