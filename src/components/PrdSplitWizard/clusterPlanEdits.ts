/**
 * Cluster plan 编辑层。
 *
 * 关注点：把"算法 plan"和"用户对 plan 的修改"解耦。`useSplitWizardState`
 * 维护两份字段——`basePlan` 永远是 `planClusters` 的原始输出，`clusterPlanEdits`
 * 是一个 patch 集合；下游消费的 `state.plan` 由 `deriveEffectivePlan` 派生。
 *
 * 派生算法：O(reqs + clusters)，纯函数，不动入参。
 */

import type {
  ClusterPlan,
  ClusterPlanItem,
} from "../../services/prdSplit/clusterPlanner";
import type { Repository } from "../../types";
import type { ClusterEditState } from "./types";

export interface ClusterPlanEdits {
  /**
   * requirementId → targetClusterId。仅在与算法默认归属不同时存在。
   * 撤回到算法默认：从此 map 删除 key（用 `applyReassign` 自动处理）。
   */
  reassignedRequirements: Record<string, string>;
  /** 用户手工新建的 cluster。id 形如 `cluster-manual-<repoType>-<repoId>-<seq>`。 */
  manualClusters: ClusterPlanItem[];
  /** clusterId → 自定义 title。 */
  titleOverrides: Record<string, string>;
}

export function emptyClusterPlanEdits(): ClusterPlanEdits {
  return {
    reassignedRequirements: {},
    manualClusters: [],
    titleOverrides: {},
  };
}

/**
 * 根据 base + edits 派生"生效 plan"。
 * 不会 mutate 入参；返回新对象。
 */
export function deriveEffectivePlan(
  base: ClusterPlan,
  edits: ClusterPlanEdits,
): ClusterPlan {
  // 1) 基础 cluster 列表（深复制 requirementIds 以便 mutable 改写）+ manual cluster
  const baseIds = new Set(base.clusters.map((c) => c.id));
  const manualKeep = edits.manualClusters.filter((c) => !baseIds.has(c.id));
  const working: ClusterPlanItem[] = [
    ...base.clusters.map((c) => ({ ...c, requirementIds: [...c.requirementIds] })),
    ...manualKeep.map((c) => ({ ...c, requirementIds: [...c.requirementIds] })),
  ];

  // 2) titleOverrides
  for (const c of working) {
    const override = edits.titleOverrides[c.id];
    if (override !== undefined && override.trim().length > 0) {
      c.title = override;
    }
  }

  // 3) reassignedRequirements
  const validClusterIds = new Set(working.map((c) => c.id));
  for (const [reqId, targetId] of Object.entries(edits.reassignedRequirements)) {
    if (!validClusterIds.has(targetId)) continue;
    let already = false;
    for (const c of working) {
      const idx = c.requirementIds.indexOf(reqId);
      if (idx >= 0) {
        if (c.id === targetId) {
          already = true;
          break;
        }
        c.requirementIds.splice(idx, 1);
      }
    }
    if (already) continue;
    const target = working.find((c) => c.id === targetId);
    if (target && !target.requirementIds.includes(reqId)) {
      target.requirementIds.push(reqId);
    }
  }

  // 4) 剔除算法 cluster 中被搬空的；manual cluster 允许空
  const manualIds = new Set(manualKeep.map((c) => c.id));
  let pruned = working.filter(
    (c) => c.requirementIds.length > 0 || manualIds.has(c.id),
  );

  // 5) 防御：若派生后所有 cluster 都空 → 退化回 base，避免卡死
  if (pruned.length === 0) {
    pruned = base.clusters.map((c) => ({ ...c, requirementIds: [...c.requirementIds] }));
  }

  // 6) 重算 diagnostics.coverage（crossRepoRequirements 来自 base，编辑层不重新打分）
  const allReqIds = new Set<string>();
  for (const c of base.clusters) for (const r of c.requirementIds) allReqIds.add(r);
  const coveredSet = new Set<string>();
  for (const c of pruned) for (const r of c.requirementIds) coveredSet.add(r);
  const orphan = [...allReqIds].filter((r) => !coveredSet.has(r));

  return {
    clusters: pruned,
    diagnostics: {
      requirementsCoverage: {
        covered: [...coveredSet],
        orphan,
      },
      crossRepoRequirements: base.diagnostics.crossRepoRequirements,
    },
  };
}

/**
 * 找出 reqId 在 base plan 中归属的 cluster id；不存在则 null。
 */
export function findBaseClusterForRequirement(
  base: ClusterPlan,
  reqId: string,
): string | null {
  for (const c of base.clusters) {
    if (c.requirementIds.includes(reqId)) return c.id;
  }
  return null;
}

/**
 * 应用一次 reassign：若目标 cluster 与算法默认归属一致，从 map 中删除 key
 * 以避免 edits 永久累积；否则写入 / 覆盖。
 */
export function applyReassign(
  edits: ClusterPlanEdits,
  base: ClusterPlan,
  reqId: string,
  targetClusterId: string,
): ClusterPlanEdits {
  const defaultCluster = findBaseClusterForRequirement(base, reqId);
  const next = { ...edits.reassignedRequirements };
  if (defaultCluster === targetClusterId) {
    delete next[reqId];
  } else {
    next[reqId] = targetClusterId;
  }
  return { ...edits, reassignedRequirements: next };
}

/**
 * 撤销 reassign：从 map 中删除 key。
 */
export function undoReassign(
  edits: ClusterPlanEdits,
  reqId: string,
): ClusterPlanEdits {
  if (!(reqId in edits.reassignedRequirements)) return edits;
  const next = { ...edits.reassignedRequirements };
  delete next[reqId];
  return { ...edits, reassignedRequirements: next };
}

/**
 * 生成下一个 manual cluster id，seq 在已有 manualClusters 中找最大值 + 1。
 */
export function nextManualClusterId(
  edits: ClusterPlanEdits,
  repoType: Repository["repositoryType"],
  repoId: number,
): string {
  const prefix = `cluster-manual-${repoType}-${repoId}-`;
  let max = 0;
  for (const c of edits.manualClusters) {
    if (!c.id.startsWith(prefix)) continue;
    const tail = c.id.slice(prefix.length);
    const n = Number.parseInt(tail, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${max + 1}`;
}

/**
 * Plan 编辑动作（reducer 层 dispatch 前 / dispatch 内消费）。
 */
export type ClusterPlanEditAction =
  | { type: "reassign-requirement"; requirementId: string; targetClusterId: string }
  | { type: "add-manual-cluster"; cluster: ClusterPlanItem }
  | { type: "rename-cluster"; clusterId: string; title: string };

/**
 * 计算某次 plan 编辑会"波及"哪些 cluster 的现有 task 编辑。
 * 返回那些在 `editsByCluster` 中确实存在 task 修改（patches / manualTasks / deletedTaskIds）
 * 的 clusterId 列表。
 *
 * 用于 UI 弹出确认："以下 cluster 有人工任务编辑，将一并丢弃。继续？"
 */
export function peekAffectedClusterEdits(
  ctx: { plan: ClusterPlan | null; editsByCluster: Record<string, ClusterEditState> },
  action: ClusterPlanEditAction,
): string[] {
  const candidates = collectAffectedClusterIds(ctx.plan, action);
  return candidates.filter((cid) => clusterHasTaskEdits(ctx.editsByCluster[cid]));
}

/**
 * 计算受影响的 cluster id 集合（reducer 内 invalidate run 也用同一集合）。
 */
export function collectAffectedClusterIds(
  plan: ClusterPlan | null,
  action: ClusterPlanEditAction,
): string[] {
  if (action.type === "reassign-requirement") {
    const source = findEffectiveClusterForRequirement(plan, action.requirementId);
    const target = action.targetClusterId;
    const out: string[] = [];
    if (source && source !== target) out.push(source);
    if (target && !out.includes(target)) out.push(target);
    return out;
  }
  if (action.type === "add-manual-cluster") {
    return [];
  }
  // rename：仅影响 title，UI 显示层；不动归属，不需要 invalidate
  return [];
}

function findEffectiveClusterForRequirement(
  plan: ClusterPlan | null,
  reqId: string,
): string | null {
  if (!plan) return null;
  for (const c of plan.clusters) {
    if (c.requirementIds.includes(reqId)) return c.id;
  }
  return null;
}

function clusterHasTaskEdits(edits: ClusterEditState | undefined): boolean {
  if (!edits) return false;
  return (
    Object.keys(edits.patches).length > 0 ||
    edits.manualTasks.length > 0 ||
    edits.deletedTaskIds.length > 0
  );
}
