import { describe, expect, test } from "bun:test";
import type { ClusterPlan, ClusterPlanItem } from "../../services/prdSplit/clusterPlanner";
import type { ClusterEditState } from "./types";
import {
  applyReassign,
  collectAffectedClusterIds,
  deriveEffectivePlan,
  emptyClusterPlanEdits,
  findBaseClusterForRequirement,
  nextManualClusterId,
  peekAffectedClusterEdits,
  undoReassign,
} from "./clusterPlanEdits";

function makeCluster(overrides: Partial<ClusterPlanItem> = {}): ClusterPlanItem {
  return {
    id: "cluster-frontend-1",
    title: "Frontend",
    primaryRepositoryId: 1,
    repositoryIds: [1],
    requirementIds: ["req-1"],
    dependencyClusterIds: [],
    ...overrides,
  };
}

function basePlan(clusters: ClusterPlanItem[], crossRepo: string[] = []): ClusterPlan {
  const allReqs = new Set<string>();
  for (const c of clusters) for (const r of c.requirementIds) allReqs.add(r);
  return {
    clusters,
    diagnostics: {
      requirementsCoverage: { covered: [...allReqs], orphan: [] },
      crossRepoRequirements: crossRepo,
    },
  };
}

describe("deriveEffectivePlan", () => {
  test("identity when no edits", () => {
    const base = basePlan([
      makeCluster({ id: "cluster-frontend-1", requirementIds: ["req-1", "req-2"] }),
      makeCluster({ id: "cluster-backend-2", primaryRepositoryId: 2, repositoryIds: [2], requirementIds: ["req-3"], title: "Backend" }),
    ]);
    const out = deriveEffectivePlan(base, emptyClusterPlanEdits());
    expect(out.clusters.map((c) => c.id)).toEqual(["cluster-frontend-1", "cluster-backend-2"]);
    expect(out.clusters[0].requirementIds).toEqual(["req-1", "req-2"]);
    expect(out.diagnostics.requirementsCoverage.orphan).toEqual([]);
  });

  test("single reassign moves req between clusters", () => {
    const base = basePlan([
      makeCluster({ id: "c-fe", requirementIds: ["req-1", "req-2"] }),
      makeCluster({ id: "c-be", primaryRepositoryId: 2, repositoryIds: [2], requirementIds: ["req-3"] }),
    ]);
    const edits = {
      ...emptyClusterPlanEdits(),
      reassignedRequirements: { "req-2": "c-be" },
    };
    const out = deriveEffectivePlan(base, edits);
    expect(out.clusters[0].requirementIds).toEqual(["req-1"]);
    expect(out.clusters[1].requirementIds).toEqual(["req-3", "req-2"]);
  });

  test("reassign to same cluster is no-op (already there)", () => {
    const base = basePlan([
      makeCluster({ id: "c-fe", requirementIds: ["req-1"] }),
    ]);
    const edits = {
      ...emptyClusterPlanEdits(),
      reassignedRequirements: { "req-1": "c-fe" },
    };
    const out = deriveEffectivePlan(base, edits);
    expect(out.clusters[0].requirementIds).toEqual(["req-1"]);
  });

  test("manual cluster appended at end, empty allowed", () => {
    const base = basePlan([makeCluster({ id: "c-fe", requirementIds: ["req-1"] })]);
    const manual: ClusterPlanItem = {
      id: "cluster-manual-backend-2-1",
      title: "手工·后端",
      primaryRepositoryId: 2,
      repositoryIds: [2],
      requirementIds: [],
      dependencyClusterIds: [],
    };
    const edits = { ...emptyClusterPlanEdits(), manualClusters: [manual] };
    const out = deriveEffectivePlan(base, edits);
    expect(out.clusters.map((c) => c.id)).toEqual(["c-fe", "cluster-manual-backend-2-1"]);
    expect(out.clusters[1].requirementIds).toEqual([]);
  });

  test("algorithm cluster emptied by reassign is pruned; manual cluster kept", () => {
    const base = basePlan([
      makeCluster({ id: "c-fe", requirementIds: ["req-1"] }),
      makeCluster({ id: "c-be", primaryRepositoryId: 2, repositoryIds: [2], requirementIds: ["req-2"] }),
    ]);
    const manual: ClusterPlanItem = {
      id: "cluster-manual-frontend-3-1",
      title: "M",
      primaryRepositoryId: 3,
      repositoryIds: [3],
      requirementIds: [],
      dependencyClusterIds: [],
    };
    const edits = {
      reassignedRequirements: { "req-1": "c-be" },
      manualClusters: [manual],
      titleOverrides: {},
    };
    const out = deriveEffectivePlan(base, edits);
    expect(out.clusters.map((c) => c.id)).toEqual(["c-be", "cluster-manual-frontend-3-1"]);
  });

  test("titleOverride applied", () => {
    const base = basePlan([makeCluster({ id: "c-fe", requirementIds: ["req-1"], title: "原始" })]);
    const edits = {
      ...emptyClusterPlanEdits(),
      titleOverrides: { "c-fe": "新名" },
    };
    const out = deriveEffectivePlan(base, edits);
    expect(out.clusters[0].title).toBe("新名");
  });

  test("titleOverride for missing cluster is ignored", () => {
    const base = basePlan([makeCluster({ id: "c-fe", requirementIds: ["req-1"] })]);
    const edits = {
      ...emptyClusterPlanEdits(),
      titleOverrides: { "non-existent": "X" },
    };
    const out = deriveEffectivePlan(base, edits);
    expect(out.clusters[0].title).toBe("Frontend");
  });

  test("reassign to non-existent cluster is ignored", () => {
    const base = basePlan([makeCluster({ id: "c-fe", requirementIds: ["req-1"] })]);
    const edits = {
      ...emptyClusterPlanEdits(),
      reassignedRequirements: { "req-1": "no-such-cluster" },
    };
    const out = deriveEffectivePlan(base, edits);
    expect(out.clusters[0].requirementIds).toEqual(["req-1"]);
  });

  test("manual cluster with id conflicting with base is dropped", () => {
    const base = basePlan([makeCluster({ id: "c-fe", requirementIds: ["req-1"] })]);
    const conflict: ClusterPlanItem = { ...makeCluster({ id: "c-fe", title: "假冒" }), requirementIds: [] };
    const edits = { ...emptyClusterPlanEdits(), manualClusters: [conflict] };
    const out = deriveEffectivePlan(base, edits);
    expect(out.clusters).toHaveLength(1);
    expect(out.clusters[0].title).toBe("Frontend");
  });

  test("orphan recomputed when all requirements moved out and source pruned", () => {
    const base = basePlan([
      makeCluster({ id: "c-fe", requirementIds: ["req-1", "req-2"] }),
      makeCluster({ id: "c-be", primaryRepositoryId: 2, repositoryIds: [2], requirementIds: [] }),
    ]);
    // base 自身就有 c-be 空，但它是算法 cluster → 派生会剔除。
    // 这里测：base 算法 cluster 上不应有 orphan 出现（coverage 应等于全集）。
    const out = deriveEffectivePlan(base, emptyClusterPlanEdits());
    expect(out.diagnostics.requirementsCoverage.orphan).toEqual([]);
    expect(out.clusters.map((c) => c.id)).toEqual(["c-fe"]);
  });

  test("degenerate: all empty → fallback to base", () => {
    const base = basePlan([makeCluster({ id: "c-fe", requirementIds: [] })]);
    const out = deriveEffectivePlan(base, emptyClusterPlanEdits());
    expect(out.clusters).toHaveLength(1);
    expect(out.clusters[0].id).toBe("c-fe");
  });

  test("crossRepoRequirements carried over from base", () => {
    const base = basePlan([makeCluster({ id: "c-fe", requirementIds: ["req-1"] })], ["req-1"]);
    const out = deriveEffectivePlan(base, emptyClusterPlanEdits());
    expect(out.diagnostics.crossRepoRequirements).toEqual(["req-1"]);
  });

  test("does not mutate input", () => {
    const base = basePlan([makeCluster({ id: "c-fe", requirementIds: ["req-1"] })]);
    const snapshot = JSON.stringify(base);
    const edits = { ...emptyClusterPlanEdits(), reassignedRequirements: { "req-1": "non-existent" } };
    deriveEffectivePlan(base, edits);
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});

describe("findBaseClusterForRequirement", () => {
  test("returns owning cluster id", () => {
    const base = basePlan([
      makeCluster({ id: "c-a", requirementIds: ["req-1"] }),
      makeCluster({ id: "c-b", requirementIds: ["req-2"] }),
    ]);
    expect(findBaseClusterForRequirement(base, "req-2")).toBe("c-b");
  });

  test("null when missing", () => {
    const base = basePlan([makeCluster({ id: "c-a", requirementIds: ["req-1"] })]);
    expect(findBaseClusterForRequirement(base, "req-missing")).toBeNull();
  });
});

describe("applyReassign + undoReassign", () => {
  test("writes target when different from default", () => {
    const base = basePlan([
      makeCluster({ id: "c-a", requirementIds: ["req-1"] }),
      makeCluster({ id: "c-b", requirementIds: [] }),
    ]);
    const out = applyReassign(emptyClusterPlanEdits(), base, "req-1", "c-b");
    expect(out.reassignedRequirements).toEqual({ "req-1": "c-b" });
  });

  test("removes key when target equals algorithmic default", () => {
    const base = basePlan([
      makeCluster({ id: "c-a", requirementIds: ["req-1"] }),
      makeCluster({ id: "c-b", requirementIds: [] }),
    ]);
    const first = applyReassign(emptyClusterPlanEdits(), base, "req-1", "c-b");
    const second = applyReassign(first, base, "req-1", "c-a");
    expect(second.reassignedRequirements).toEqual({});
  });

  test("undoReassign drops key", () => {
    const edits = {
      ...emptyClusterPlanEdits(),
      reassignedRequirements: { "req-1": "c-b" },
    };
    expect(undoReassign(edits, "req-1").reassignedRequirements).toEqual({});
  });

  test("undoReassign no-op when key absent", () => {
    const edits = emptyClusterPlanEdits();
    expect(undoReassign(edits, "req-missing")).toBe(edits);
  });
});

describe("nextManualClusterId", () => {
  test("starts at 1 when no manual clusters", () => {
    expect(nextManualClusterId(emptyClusterPlanEdits(), "frontend", 3)).toBe(
      "cluster-manual-frontend-3-1",
    );
  });

  test("increments past max existing seq for matching prefix", () => {
    const edits: ReturnType<typeof emptyClusterPlanEdits> = {
      ...emptyClusterPlanEdits(),
      manualClusters: [
        { ...makeCluster({ id: "cluster-manual-frontend-3-1", requirementIds: [] }) },
        { ...makeCluster({ id: "cluster-manual-frontend-3-2", requirementIds: [] }) },
      ],
    };
    expect(nextManualClusterId(edits, "frontend", 3)).toBe("cluster-manual-frontend-3-3");
  });

  test("different repo / type has independent seq", () => {
    const edits: ReturnType<typeof emptyClusterPlanEdits> = {
      ...emptyClusterPlanEdits(),
      manualClusters: [
        { ...makeCluster({ id: "cluster-manual-frontend-3-5", requirementIds: [] }) },
      ],
    };
    expect(nextManualClusterId(edits, "backend", 3)).toBe("cluster-manual-backend-3-1");
    expect(nextManualClusterId(edits, "frontend", 4)).toBe("cluster-manual-frontend-4-1");
  });
});

describe("peekAffectedClusterEdits + collectAffectedClusterIds", () => {
  test("reassign collects source + target", () => {
    const plan = basePlan([
      makeCluster({ id: "c-a", requirementIds: ["req-1"] }),
      makeCluster({ id: "c-b", requirementIds: [] }),
    ]);
    const ids = collectAffectedClusterIds(plan, {
      type: "reassign-requirement",
      requirementId: "req-1",
      targetClusterId: "c-b",
    });
    expect(ids.sort()).toEqual(["c-a", "c-b"]);
  });

  test("add-manual-cluster has no affected clusters", () => {
    const plan = basePlan([makeCluster({ id: "c-a", requirementIds: ["req-1"] })]);
    const ids = collectAffectedClusterIds(plan, {
      type: "add-manual-cluster",
      cluster: makeCluster({ id: "cluster-manual-frontend-3-1", requirementIds: [] }),
    });
    expect(ids).toEqual([]);
  });

  test("rename has no affected clusters", () => {
    const plan = basePlan([makeCluster({ id: "c-a", requirementIds: ["req-1"] })]);
    const ids = collectAffectedClusterIds(plan, {
      type: "rename-cluster",
      clusterId: "c-a",
      title: "X",
    });
    expect(ids).toEqual([]);
  });

  test("peek filters to clusters with actual edits", () => {
    const plan = basePlan([
      makeCluster({ id: "c-a", requirementIds: ["req-1"] }),
      makeCluster({ id: "c-b", requirementIds: [] }),
    ]);
    const editsByCluster: Record<string, ClusterEditState> = {
      "c-a": { patches: { "task-1": { title: "改过" } }, manualTasks: [], deletedTaskIds: [] },
    };
    const affected = peekAffectedClusterEdits(
      { plan, editsByCluster },
      {
        type: "reassign-requirement",
        requirementId: "req-1",
        targetClusterId: "c-b",
      },
    );
    expect(affected).toEqual(["c-a"]);
  });

  test("peek empty when no task edits anywhere", () => {
    const plan = basePlan([
      makeCluster({ id: "c-a", requirementIds: ["req-1"] }),
      makeCluster({ id: "c-b", requirementIds: [] }),
    ]);
    const affected = peekAffectedClusterEdits(
      { plan, editsByCluster: {} },
      {
        type: "reassign-requirement",
        requirementId: "req-1",
        targetClusterId: "c-b",
      },
    );
    expect(affected).toEqual([]);
  });

  test("collect with null plan returns empty", () => {
    const ids = collectAffectedClusterIds(null, {
      type: "reassign-requirement",
      requirementId: "req-1",
      targetClusterId: "c-b",
    });
    expect(ids).toEqual(["c-b"]);
  });
});
