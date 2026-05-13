import type { WorkflowRuntimeStepSnapshot } from "../types";

/** 自后向前查找 `toNodeId` 匹配且含 `executorSessionId` 的最新一步（用于图节点点击打开会话） */
export function findLatestRuntimeSnapshotForGraphNode(
  snapshotsSorted: WorkflowRuntimeStepSnapshot[],
  nodeId: string,
): WorkflowRuntimeStepSnapshot | undefined {
  const nid = nodeId.trim();
  if (!nid) return undefined;
  for (let i = snapshotsSorted.length - 1; i >= 0; i -= 1) {
    const s = snapshotsSorted[i];
    if (!s) continue;
    if (s.toNodeId?.trim() !== nid) continue;
    if (!s.executorSessionId?.trim()) continue;
    return s;
  }
  return undefined;
}
