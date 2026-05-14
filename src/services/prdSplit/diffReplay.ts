/**
 * Diff replay — 比较新旧 requirements-index v2，输出受影响的 cluster 集合。
 *
 * 双信号约束：dirty 必须满足 (a) 任一 cluster 内某 requirement bodyHash 变化，**或**
 * (b) cluster 的 requirementId 集合有增删。两条信号都不触发的 cluster 视为未变化。
 *
 * 落入 cluster 之外（orphan）的新增/删除 requirement 单独列出，不直接标 dirty —
 * 应该回到 ClusterPlan 阶段重审。
 */

import type { RequirementsIndexV2 } from "./requirementsIndexVersion";
import type { ClusterPlan } from "./clusterPlanner";

export type DiffReason =
  | { kind: "requirement_body_changed"; id: string; oldHash: string; newHash: string }
  | { kind: "requirement_added"; id: string }
  | { kind: "requirement_removed"; id: string };

export interface DiffReplayInput {
  oldIndex: RequirementsIndexV2;
  newIndex: RequirementsIndexV2;
  existingPlan: ClusterPlan;
}

export interface DiffReplayOutput {
  dirtyClusterIds: string[];
  reasonsByCluster: Record<string, DiffReason[]>;
  orphanReasons: DiffReason[];
}

export function computeDirtyClusters(input: DiffReplayInput): DiffReplayOutput {
  if (input.oldIndex.version === input.newIndex.version) {
    return { dirtyClusterIds: [], reasonsByCluster: {}, orphanReasons: [] };
  }

  const oldById = mapBy(input.oldIndex.requirements);
  const newById = mapBy(input.newIndex.requirements);

  const reasons: DiffReason[] = [];

  for (const [id, oldEntry] of oldById.entries()) {
    const newEntry = newById.get(id);
    if (!newEntry) {
      reasons.push({ kind: "requirement_removed", id });
    } else if (newEntry.bodyHash !== oldEntry.bodyHash) {
      reasons.push({
        kind: "requirement_body_changed",
        id,
        oldHash: oldEntry.bodyHash,
        newHash: newEntry.bodyHash,
      });
    }
  }
  for (const id of newById.keys()) {
    if (!oldById.has(id)) {
      reasons.push({ kind: "requirement_added", id });
    }
  }

  const requirementToCluster = buildRequirementToCluster(input.existingPlan);
  const reasonsByCluster: Record<string, DiffReason[]> = {};
  const orphan: DiffReason[] = [];

  for (const reason of reasons) {
    const clusterId = requirementToCluster.get(reason.id);
    if (!clusterId) {
      orphan.push(reason);
      continue;
    }
    if (!reasonsByCluster[clusterId]) reasonsByCluster[clusterId] = [];
    reasonsByCluster[clusterId].push(reason);
  }

  return {
    dirtyClusterIds: Object.keys(reasonsByCluster).sort(),
    reasonsByCluster,
    orphanReasons: orphan,
  };
}

function mapBy(entries: RequirementsIndexV2["requirements"]) {
  const m = new Map<string, RequirementsIndexV2["requirements"][number]>();
  for (const e of entries) m.set(e.id, e);
  return m;
}

function buildRequirementToCluster(plan: ClusterPlan): Map<string, string> {
  const m = new Map<string, string>();
  for (const cluster of plan.clusters) {
    for (const reqId of cluster.requirementIds) m.set(reqId, cluster.id);
  }
  return m;
}
