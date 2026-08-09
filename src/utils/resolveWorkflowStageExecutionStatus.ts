import type {
  ClaudeSession,
  WorkflowGraph,
  WorkflowRuntimeStepSnapshot,
  WorkflowTaskItem,
} from "../types";

export type WorkflowStageExecutionStatusKey =
  | "not_started"
  | "running"
  | "awaiting"
  | "returned"
  | "completed"
  | "passed"
  | "rejected"
  | "error"
  | "cancelled"
  | "reached"
  | "not_reached";

export interface WorkflowStageExecutionStatus {
  key: WorkflowStageExecutionStatusKey;
  label: string;
  color: "default" | "processing" | "success" | "error" | "warning";
}

export interface WorkflowStageStatusRow {
  nodeId: string;
  nodeName: string;
  nodeType?: string;
  status: WorkflowStageExecutionStatus;
  /** 关联的最近一次派发快照（可无） */
  snapshotId?: string;
  stepNo?: number;
}

function isAwaitingOutput(output: string | undefined): boolean {
  const text = output?.trim() ?? "";
  return !text || text === "(待执行)";
}

function sessionStatusOf(
  sessionById: Map<string, ClaudeSession> | undefined,
  executorSessionId: string | undefined,
): ClaudeSession["status"] | undefined {
  const sid = executorSessionId?.trim();
  if (!sid || !sessionById) return undefined;
  return sessionById.get(sid)?.status;
}

/**
 * 单次派发步骤的执行状态（结合回传预览、后续决策与可选 live 会话状态）。
 */
export function resolveDispatchStepExecutionStatus(input: {
  snapshot: WorkflowRuntimeStepSnapshot;
  snapshotIndex: number;
  snapshotsSorted: WorkflowRuntimeStepSnapshot[];
  taskStatus: WorkflowTaskItem["status"] | undefined;
  sessionById?: Map<string, ClaudeSession>;
  /** 是否为当前任务最新一次派发 */
  isLatestDispatch: boolean;
}): WorkflowStageExecutionStatus {
  const { snapshot, snapshotIndex, snapshotsSorted, taskStatus, sessionById, isLatestDispatch } = input;
  const sessionStatus = sessionStatusOf(sessionById, snapshot.executorSessionId);
  const awaiting = isAwaitingOutput(snapshot.outputPreview);

  if (awaiting) {
    if (sessionStatus === "running" || sessionStatus === "connecting") {
      return { key: "running", label: "执行中", color: "processing" };
    }
    if (sessionStatus === "error") {
      return { key: "error", label: "异常", color: "error" };
    }
    if (sessionStatus === "cancelled") {
      return { key: "cancelled", label: "已取消", color: "default" };
    }
    if (taskStatus === "in_progress" && isLatestDispatch) {
      return { key: "running", label: "执行中", color: "processing" };
    }
    return { key: "awaiting", label: "待返回", color: "warning" };
  }

  if (sessionStatus === "error") {
    return { key: "error", label: "异常", color: "error" };
  }
  if (sessionStatus === "cancelled") {
    return { key: "cancelled", label: "已取消", color: "default" };
  }
  if (sessionStatus === "running" || sessionStatus === "connecting") {
    return { key: "running", label: "执行中", color: "processing" };
  }

  let nextDecision: WorkflowRuntimeStepSnapshot | undefined;
  for (let j = snapshotIndex + 1; j < snapshotsSorted.length; j += 1) {
    const s = snapshotsSorted[j];
    if (!s) continue;
    if (s.phase === "dispatch") break;
    if (s.phase === "decision") {
      nextDecision = s;
      break;
    }
  }
  if (nextDecision?.decision === "reject") {
    return { key: "rejected", label: "已驳回", color: "error" };
  }
  if (nextDecision?.decision === "pass") {
    return { key: "passed", label: "已通过", color: "success" };
  }

  if (taskStatus === "rejected") {
    return { key: "rejected", label: "已驳回", color: "error" };
  }
  if (taskStatus === "completed" || taskStatus === "archived") {
    return { key: "completed", label: "已完成", color: "success" };
  }

  const hasLaterDispatch = snapshotsSorted
    .slice(snapshotIndex + 1)
    .some((s) => s.phase === "dispatch");
  if (hasLaterDispatch) {
    return { key: "completed", label: "已完成", color: "success" };
  }

  return { key: "returned", label: "已返回", color: "success" };
}

function nodeDisplayName(node: WorkflowGraph["nodes"][number]): string {
  const title = node.data?.label?.trim();
  if (title) return title;
  if (node.type === "start") return "开始";
  if (node.type === "end") return "结束";
  return node.id;
}

/**
 * 按工作流图节点列出各阶段执行状态（含尚未派发的节点）。
 */
export function buildWorkflowStageStatusRows(input: {
  graph: WorkflowGraph | null | undefined;
  snapshotsSorted: WorkflowRuntimeStepSnapshot[];
  taskStatus: WorkflowTaskItem["status"] | undefined;
  sessionById?: Map<string, ClaudeSession>;
}): WorkflowStageStatusRow[] {
  const { graph, snapshotsSorted, taskStatus, sessionById } = input;
  if (!graph?.nodes?.length) return [];

  const dispatchEntries = snapshotsSorted
    .map((snapshot, index) => ({ snapshot, index }))
    .filter((row) => row.snapshot.phase === "dispatch");
  const latestDispatchIndex =
    dispatchEntries.length > 0 ? dispatchEntries[dispatchEntries.length - 1]!.index : -1;

  const latestByNodeId = new Map<string, { snapshot: WorkflowRuntimeStepSnapshot; index: number; stepNo: number }>();
  let stepNo = 0;
  for (const row of dispatchEntries) {
    stepNo += 1;
    const nid = row.snapshot.toNodeId?.trim();
    if (!nid) continue;
    latestByNodeId.set(nid, { snapshot: row.snapshot, index: row.index, stepNo });
  }

  const hasAnyProgress = snapshotsSorted.length > 0;
  const rows: WorkflowStageStatusRow[] = [];

  for (const node of graph.nodes) {
    const nodeId = node.id.trim();
    if (!nodeId) continue;
    const nodeName = nodeDisplayName(node);

    if (node.type === "start") {
      rows.push({
        nodeId,
        nodeName,
        nodeType: node.type,
        status: hasAnyProgress
          ? { key: "reached", label: "已到达", color: "success" }
          : { key: "not_started", label: "未开始", color: "default" },
      });
      continue;
    }

    if (node.type === "end") {
      rows.push({
        nodeId,
        nodeName,
        nodeType: node.type,
        status:
          taskStatus === "completed"
            ? { key: "reached", label: "已到达", color: "success" }
            : taskStatus === "rejected"
              ? { key: "rejected", label: "未到达（已驳回）", color: "error" }
              : hasAnyProgress
                ? { key: "not_reached", label: "未到达", color: "default" }
                : { key: "not_started", label: "未开始", color: "default" },
      });
      continue;
    }

    const hit = latestByNodeId.get(nodeId);
    if (!hit) {
      rows.push({
        nodeId,
        nodeName,
        nodeType: node.type,
        status: { key: "not_started", label: "未开始", color: "default" },
      });
      continue;
    }

    const status = resolveDispatchStepExecutionStatus({
      snapshot: hit.snapshot,
      snapshotIndex: hit.index,
      snapshotsSorted,
      taskStatus,
      sessionById,
      isLatestDispatch: hit.index === latestDispatchIndex,
    });
    rows.push({
      nodeId,
      nodeName,
      nodeType: node.type,
      status,
      snapshotId: hit.snapshot.id,
      stepNo: hit.stepNo,
    });
  }

  return rows;
}
