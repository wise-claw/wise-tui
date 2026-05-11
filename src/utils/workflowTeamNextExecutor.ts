import type { WorkflowRuntimeStepSnapshot, WorkflowTaskItem } from "../types";

/**
 * 下一阶段执行方：单次前向扫描。
 * - 优先命中下一条「派发」快照的人名（与真实 executeSession 一致）
 * - 其次命中「流程已结束」决策
 * - 再用首条决策快照的 toNodeName（尚无下一条派发时）
 * - 仅进行中任务用当前待派发名单兜底
 */
export function describeNextExecutorAfterDispatch(
  snapshots: WorkflowRuntimeStepSnapshot[],
  fromIndex: number,
  pendingEmployees: Array<{ name: string }>,
  taskStatus: WorkflowTaskItem["status"] | undefined,
): string {
  /** 无后续派发时，取「最后一条」带人名的决策（兼容多条决策链） */
  let lastDecisionName: string | undefined;

  for (let j = fromIndex + 1; j < snapshots.length; j++) {
    const s = snapshots[j];
    if (s.phase === "dispatch") {
      const n = s.toNodeName?.trim();
      if (n) {
        return n;
      }
      const id = s.toNodeId?.trim();
      if (id) {
        return `节点 ${id}`;
      }
      continue;
    }
    if (s.phase === "decision") {
      if (s.inputPreview?.includes("流程已结束")) {
        return "（流程已结束）";
      }
      const dn = s.toNodeName?.trim();
      if (dn) {
        lastDecisionName = dn;
      }
    }
  }

  if (lastDecisionName) {
    return lastDecisionName;
  }

  if (taskStatus === "in_progress") {
    const names = pendingEmployees.map((e) => e.name.trim()).filter(Boolean);
    if (names.length > 0) {
      return `${names.join("、")}（待派发）`;
    }
  }
  return "—";
}
