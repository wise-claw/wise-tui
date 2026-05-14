import { describe, expect, test } from "bun:test";
import type { ClusterPlan, ClusterPlanItem } from "../../services/prdSplit/clusterPlanner";
import { emptyWizardState } from "./types";
import { reducer, resolveWizardPlannerOptions } from "./useSplitWizardState";
import { emptyClusterPlanEdits } from "./clusterPlanEdits";
import type { ClusterEditState, WizardState } from "./types";

function makeCluster(overrides: Partial<ClusterPlanItem> = {}): ClusterPlanItem {
  return {
    id: "c-a",
    title: "Cluster A",
    primaryRepositoryId: 1,
    repositoryIds: [1],
    requirementIds: ["req-1"],
    dependencyClusterIds: [],
    ...overrides,
  };
}

function basePlan(clusters: ClusterPlanItem[]): ClusterPlan {
  const reqs: string[] = [];
  for (const c of clusters) reqs.push(...c.requirementIds);
  return {
    clusters,
    diagnostics: { requirementsCoverage: { covered: reqs, orphan: [] }, crossRepoRequirements: [] },
  };
}

function stateWithBasePlan(plan: ClusterPlan, overrides: Partial<WizardState> = {}): WizardState {
  return {
    ...emptyWizardState(),
    stage: "plan",
    basePlan: plan,
    plan,
    clusterPlanEdits: emptyClusterPlanEdits(),
    clusterRuns: Object.fromEntries(
      plan.clusters.map((c) => [c.id, { clusterId: c.id, parentTaskName: null, parentTaskPath: null, status: "idle" as const, errors: [] }]),
    ),
    ...overrides,
  };
}

describe("reducer · reassign-requirement", () => {
  test("moves req between clusters and updates derived plan", () => {
    const plan = basePlan([
      makeCluster({ id: "c-a", requirementIds: ["req-1", "req-2"] }),
      makeCluster({ id: "c-b", primaryRepositoryId: 2, repositoryIds: [2], requirementIds: [] }),
    ]);
    const state = stateWithBasePlan(plan);
    const next = reducer(state, {
      type: "reassign-requirement",
      requirementId: "req-2",
      targetClusterId: "c-b",
    });
    expect(next.clusterPlanEdits.reassignedRequirements).toEqual({ "req-2": "c-b" });
    expect(next.plan?.clusters.find((c) => c.id === "c-a")?.requirementIds).toEqual(["req-1"]);
    expect(next.plan?.clusters.find((c) => c.id === "c-b")?.requirementIds).toEqual(["req-2"]);
  });

  test("invalidates run on affected clusters (succeeded → idle)", () => {
    const plan = basePlan([
      makeCluster({ id: "c-a", requirementIds: ["req-1", "req-2"] }),
      makeCluster({ id: "c-b", primaryRepositoryId: 2, repositoryIds: [2], requirementIds: ["req-3"] }),
    ]);
    const state = stateWithBasePlan(plan, {
      clusterRuns: {
        "c-a": { clusterId: "c-a", parentTaskName: "P", parentTaskPath: "/", status: "succeeded", errors: [] },
        "c-b": { clusterId: "c-b", parentTaskName: "Q", parentTaskPath: "/q", status: "succeeded", errors: [] },
      },
    });
    const next = reducer(state, {
      type: "reassign-requirement",
      requirementId: "req-2",
      targetClusterId: "c-b",
    });
    expect(next.clusterRuns["c-a"].status).toBe("idle");
    expect(next.clusterRuns["c-a"].parentTaskName).toBeNull();
    expect(next.clusterRuns["c-b"].status).toBe("idle");
  });

  test("preserves dispatching run (in-flight not interrupted)", () => {
    const plan = basePlan([
      makeCluster({ id: "c-a", requirementIds: ["req-1", "req-2"] }),
      makeCluster({ id: "c-b", primaryRepositoryId: 2, repositoryIds: [2], requirementIds: ["req-3"] }),
    ]);
    const state = stateWithBasePlan(plan, {
      clusterRuns: {
        "c-a": { clusterId: "c-a", parentTaskName: "P", parentTaskPath: "/", status: "dispatching", errors: [] },
        "c-b": { clusterId: "c-b", parentTaskName: null, parentTaskPath: null, status: "idle", errors: [] },
      },
    });
    const next = reducer(state, {
      type: "reassign-requirement",
      requirementId: "req-2",
      targetClusterId: "c-b",
    });
    expect(next.clusterRuns["c-a"].status).toBe("dispatching");
  });

  test("pruned cluster (emptied) drops from runs", () => {
    const plan = basePlan([
      makeCluster({ id: "c-a", requirementIds: ["req-1"] }),
      makeCluster({ id: "c-b", primaryRepositoryId: 2, repositoryIds: [2], requirementIds: [] }),
    ]);
    const state = stateWithBasePlan(plan, {
      clusterRuns: {
        "c-a": { clusterId: "c-a", parentTaskName: "P", parentTaskPath: "/", status: "succeeded", errors: [] },
        "c-b": { clusterId: "c-b", parentTaskName: null, parentTaskPath: null, status: "idle", errors: [] },
      },
    });
    const next = reducer(state, {
      type: "reassign-requirement",
      requirementId: "req-1",
      targetClusterId: "c-b",
    });
    // c-a 被搬空 → 算法 cluster 被 prune → run 被丢
    expect(next.clusterRuns["c-a"]).toBeUndefined();
    expect(next.plan?.clusters.map((c) => c.id)).toEqual(["c-b"]);
  });

  test("reassign back to default removes key from edits", () => {
    const plan = basePlan([
      makeCluster({ id: "c-a", requirementIds: ["req-1"] }),
      makeCluster({ id: "c-b", primaryRepositoryId: 2, repositoryIds: [2], requirementIds: [] }),
    ]);
    let state = stateWithBasePlan(plan);
    state = reducer(state, { type: "reassign-requirement", requirementId: "req-1", targetClusterId: "c-b" });
    state = reducer(state, { type: "reassign-requirement", requirementId: "req-1", targetClusterId: "c-a" });
    expect(state.clusterPlanEdits.reassignedRequirements).toEqual({});
  });
});

describe("reducer · undo-reassign", () => {
  test("removes the override and restores plan", () => {
    const plan = basePlan([
      makeCluster({ id: "c-a", requirementIds: ["req-1"] }),
      makeCluster({ id: "c-b", primaryRepositoryId: 2, repositoryIds: [2], requirementIds: [] }),
    ]);
    let state = stateWithBasePlan(plan);
    state = reducer(state, { type: "reassign-requirement", requirementId: "req-1", targetClusterId: "c-b" });
    state = reducer(state, { type: "undo-reassign", requirementId: "req-1" });
    expect(state.clusterPlanEdits.reassignedRequirements).toEqual({});
    expect(state.plan?.clusters.find((c) => c.id === "c-a")?.requirementIds).toEqual(["req-1"]);
  });

  test("noop when key absent", () => {
    const plan = basePlan([makeCluster({ id: "c-a", requirementIds: ["req-1"] })]);
    const state = stateWithBasePlan(plan);
    const next = reducer(state, { type: "undo-reassign", requirementId: "missing" });
    expect(next).toBe(state);
  });
});

describe("reducer · add-manual-cluster", () => {
  test("appends manual cluster + creates idle run", () => {
    const plan = basePlan([makeCluster({ id: "c-a", requirementIds: ["req-1"] })]);
    const state = stateWithBasePlan(plan);
    const manual: ClusterPlanItem = {
      id: "cluster-manual-backend-2-1",
      title: "M",
      primaryRepositoryId: 2,
      repositoryIds: [2],
      requirementIds: [],
      dependencyClusterIds: [],
    };
    const next = reducer(state, { type: "add-manual-cluster", cluster: manual });
    expect(next.clusterPlanEdits.manualClusters.map((c) => c.id)).toEqual(["cluster-manual-backend-2-1"]);
    expect(next.plan?.clusters.map((c) => c.id)).toEqual(["c-a", "cluster-manual-backend-2-1"]);
    expect(next.clusterRuns["cluster-manual-backend-2-1"]).toBeDefined();
    expect(next.clusterRuns["cluster-manual-backend-2-1"].status).toBe("idle");
  });

  test("rejects id colliding with base cluster", () => {
    const plan = basePlan([makeCluster({ id: "c-a", requirementIds: ["req-1"] })]);
    const state = stateWithBasePlan(plan);
    const conflict: ClusterPlanItem = { ...makeCluster({ id: "c-a", requirementIds: [] }) };
    const next = reducer(state, { type: "add-manual-cluster", cluster: conflict });
    expect(next).toBe(state);
  });
});

describe("reducer · rename-cluster", () => {
  test("applies title override", () => {
    const plan = basePlan([makeCluster({ id: "c-a", requirementIds: ["req-1"], title: "原" })]);
    const state = stateWithBasePlan(plan);
    const next = reducer(state, { type: "rename-cluster", clusterId: "c-a", title: "新" });
    expect(next.clusterPlanEdits.titleOverrides).toEqual({ "c-a": "新" });
    expect(next.plan?.clusters[0].title).toBe("新");
  });

  test("empty title clears override", () => {
    const plan = basePlan([makeCluster({ id: "c-a", requirementIds: ["req-1"], title: "原" })]);
    let state = stateWithBasePlan(plan);
    state = reducer(state, { type: "rename-cluster", clusterId: "c-a", title: "新" });
    state = reducer(state, { type: "rename-cluster", clusterId: "c-a", title: "   " });
    expect(state.clusterPlanEdits.titleOverrides).toEqual({});
    expect(state.plan?.clusters[0].title).toBe("原");
  });
});

describe("reducer · reset-cluster-plan-edits", () => {
  test("clears all plan edits and restores base plan", () => {
    const plan = basePlan([
      makeCluster({ id: "c-a", requirementIds: ["req-1"] }),
      makeCluster({ id: "c-b", primaryRepositoryId: 2, repositoryIds: [2], requirementIds: [] }),
    ]);
    let state = stateWithBasePlan(plan);
    state = reducer(state, { type: "reassign-requirement", requirementId: "req-1", targetClusterId: "c-b" });
    state = reducer(state, { type: "rename-cluster", clusterId: "c-a", title: "X" });
    state = reducer(state, { type: "reset-cluster-plan-edits" });
    expect(state.clusterPlanEdits).toEqual(emptyClusterPlanEdits());
    expect(state.plan?.clusters.find((c) => c.id === "c-a")?.requirementIds).toEqual(["req-1"]);
  });
});

describe("reducer · back-to-input", () => {
  test("clears downstream state but preserves PRD markdown / project", () => {
    const plan = basePlan([makeCluster({ id: "c-a", requirementIds: ["req-1"] })]);
    const taskEdits: ClusterEditState = { patches: { "t": { title: "edit" } }, manualTasks: [], deletedTaskIds: [] };
    const state: WizardState = {
      ...stateWithBasePlan(plan, { editsByCluster: { "c-a": taskEdits } }),
      stage: "review",
      prdMarkdown: "PRD 文本",
      project: { id: "p", name: "P", rootPath: "/tmp/p" },
    };
    const next = reducer(state, { type: "back-to-input" });
    expect(next.stage).toBe("input");
    expect(next.prdMarkdown).toBe("PRD 文本");
    expect(next.project?.id).toBe("p");
    expect(next.basePlan).toBeNull();
    expect(next.plan).toBeNull();
    expect(next.clusterPlanEdits).toEqual(emptyClusterPlanEdits());
    expect(next.editsByCluster).toEqual({});
    expect(next.writeResults).toEqual([]);
  });
});

describe("reducer · go-to-plan resets plan edits", () => {
  test("new plan wipes accumulated clusterPlanEdits", () => {
    const plan1 = basePlan([makeCluster({ id: "c-a", requirementIds: ["req-1"] })]);
    let state = stateWithBasePlan(plan1);
    state = reducer(state, { type: "rename-cluster", clusterId: "c-a", title: "X" });
    expect(state.clusterPlanEdits.titleOverrides).toEqual({ "c-a": "X" });

    const plan2 = basePlan([makeCluster({ id: "c-z", requirementIds: ["req-1"] })]);
    state = reducer(state, {
      type: "go-to-plan",
      plan: plan2,
      prd: { sections: [], rawMarkdown: "" } as unknown as WizardState["prd"] extends infer T ? T : never,
      index: { schemaVersion: 2, requirements: [] } as unknown as WizardState["requirementsIndex"] extends infer T ? T : never,
    });
    expect(state.clusterPlanEdits).toEqual(emptyClusterPlanEdits());
    expect(state.plan?.clusters[0].id).toBe("c-z");
  });
});

describe("resolveWizardPlannerOptions", () => {
  test("single-repository wizard targets force one cluster regardless of caller cap", () => {
    expect(resolveWizardPlannerOptions(1, 37, { maxRequirementsPerCluster: 10 })).toEqual({
      maxRequirementsPerCluster: 37,
    });
  });

  test("multi-repository wizard targets keep caller/default planner options", () => {
    expect(resolveWizardPlannerOptions(2, 37, { maxRequirementsPerCluster: 10 })).toEqual({
      maxRequirementsPerCluster: 10,
    });
    expect(resolveWizardPlannerOptions(2, 37)).toBeUndefined();
  });
});
