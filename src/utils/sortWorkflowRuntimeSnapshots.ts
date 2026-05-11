import type { WorkflowRuntimeStepSnapshot } from "../types";

/**
 * 按时间排序运行时快照；`createdAt` 相同时优先 decision 再 dispatch（与 App 内同批写入顺序一致），
 * 避免从事件重放时与「会话返回 / 下一阶段」语义错位。
 */
export function sortWorkflowRuntimeSnapshotsChronological(
  snapshots: WorkflowRuntimeStepSnapshot[],
): WorkflowRuntimeStepSnapshot[] {
  return [...snapshots].sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt - b.createdAt;
    }
    const phaseRank = (s: WorkflowRuntimeStepSnapshot) => (s.phase === "decision" ? 0 : 1);
    const byPhase = phaseRank(a) - phaseRank(b);
    if (byPhase !== 0) {
      return byPhase;
    }
    return a.id.localeCompare(b.id);
  });
}
