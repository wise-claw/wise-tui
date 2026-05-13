import type { WorkflowGraph, WorkflowRuntimeStepSnapshot } from "../types";

export interface WorkflowProgressGraphHighlight {
  activeNodeId: string | null;
  /** Edge endpoints for flow animation (latest dispatch hop). */
  flowSourceId: string | null;
  flowTargetId: string | null;
}

function findEndNodeId(graph: WorkflowGraph | null | undefined): string | null {
  if (!graph?.nodes?.length) return null;
  const end = graph.nodes.find((n) => n.type === "end");
  return end?.id?.trim() || null;
}

/**
 * Derives which graph node is "current" and which edge should show motion,
 * from ordered runtime snapshots and task status.
 */
export function resolveWorkflowProgressGraphHighlight(input: {
  graph: WorkflowGraph | null | undefined;
  snapshotsSorted: WorkflowRuntimeStepSnapshot[];
  taskStatus: "in_progress" | "completed" | "rejected" | "archived";
}): WorkflowProgressGraphHighlight {
  const { graph, snapshotsSorted, taskStatus } = input;
  const endId = findEndNodeId(graph);

  if (snapshotsSorted.length === 0) {
    return { activeNodeId: null, flowSourceId: null, flowTargetId: null };
  }

  const dispatches = snapshotsSorted.filter((s) => s.phase === "dispatch");
  const lastDispatch = dispatches.length > 0 ? dispatches[dispatches.length - 1] : null;
  const lastAny = snapshotsSorted[snapshotsSorted.length - 1];

  if (taskStatus === "completed") {
    const node = (lastDispatch?.toNodeId ?? lastAny.toNodeId)?.trim() || endId;
    return {
      activeNodeId: node,
      flowSourceId: null,
      flowTargetId: null,
    };
  }

  if (taskStatus === "rejected" || taskStatus === "archived") {
    const node = (lastDispatch?.toNodeId ?? lastAny.toNodeId)?.trim() || null;
    return { activeNodeId: node, flowSourceId: null, flowTargetId: null };
  }

  // in_progress: executing node is the target of the latest dispatch when present
  const active = (lastDispatch?.toNodeId ?? lastAny.toNodeId)?.trim() || null;
  const from = lastDispatch?.fromNodeId?.trim() || null;
  const to = lastDispatch?.toNodeId?.trim() || null;
  const flowSourceId = from && to && from !== to ? from : null;
  const flowTargetId = from && to && from !== to ? to : null;

  return { activeNodeId: active, flowSourceId, flowTargetId };
}
