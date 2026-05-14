import { describe, expect, test } from "bun:test";
import type { ClusterPlan } from "./clusterPlanner";
import { computeDirtyClusters } from "./diffReplay";
import {
  upgradeRequirementsIndex,
  type RequirementsIndexV2,
} from "./requirementsIndexVersion";

function plan(clusters: Array<{ id: string; requirementIds: string[] }>): ClusterPlan {
  return {
    clusters: clusters.map((c) => ({
      id: c.id,
      title: c.id,
      primaryRepositoryId: null,
      repositoryIds: [],
      requirementIds: c.requirementIds,
      dependencyClusterIds: [],
    })),
    diagnostics: {
      requirementsCoverage: { covered: [], orphan: [] },
      crossRepoRequirements: [],
    },
  };
}

function idx(items: Array<[string, string]>): RequirementsIndexV2 {
  return upgradeRequirementsIndex({
    requirements: items.map(([id, content]) => ({ id, content })),
  });
}

describe("computeDirtyClusters", () => {
  test("identical index ⇒ no dirty clusters", () => {
    const i = idx([["r1", "x"], ["r2", "y"]]);
    const out = computeDirtyClusters({
      oldIndex: i,
      newIndex: i,
      existingPlan: plan([{ id: "c1", requirementIds: ["r1", "r2"] }]),
    });
    expect(out.dirtyClusterIds).toEqual([]);
  });

  test("body change inside one cluster marks just that cluster", () => {
    const oldIndex = idx([["r1", "x"], ["r2", "y"]]);
    const newIndex = idx([["r1", "x mutated"], ["r2", "y"]]);
    const out = computeDirtyClusters({
      oldIndex,
      newIndex,
      existingPlan: plan([
        { id: "c-fe", requirementIds: ["r1"] },
        { id: "c-be", requirementIds: ["r2"] },
      ]),
    });
    expect(out.dirtyClusterIds).toEqual(["c-fe"]);
    expect(out.reasonsByCluster["c-fe"]).toEqual([
      {
        kind: "requirement_body_changed",
        id: "r1",
        oldHash: oldIndex.requirements[0].bodyHash,
        newHash: newIndex.requirements[0].bodyHash,
      },
    ]);
  });

  test("added / removed requirements within a known cluster", () => {
    const oldIndex = idx([["r1", "x"]]);
    const newIndex = idx([["r1", "x"], ["r2", "new one"]]);
    const out = computeDirtyClusters({
      oldIndex,
      newIndex,
      existingPlan: plan([{ id: "c-fe", requirementIds: ["r1", "r2"] }]),
    });
    expect(out.dirtyClusterIds).toEqual(["c-fe"]);
    expect(out.reasonsByCluster["c-fe"]).toEqual([
      { kind: "requirement_added", id: "r2" },
    ]);
  });

  test("orphan reasons surface when requirement is unknown to plan", () => {
    const oldIndex = idx([["r1", "x"]]);
    const newIndex = idx([["r1", "x"], ["r-new", "fresh"]]);
    const out = computeDirtyClusters({
      oldIndex,
      newIndex,
      existingPlan: plan([{ id: "c-fe", requirementIds: ["r1"] }]),
    });
    expect(out.dirtyClusterIds).toEqual([]);
    expect(out.orphanReasons).toEqual([{ kind: "requirement_added", id: "r-new" }]);
  });

  test("multiple changes across clusters sort deterministically", () => {
    const oldIndex = idx([["r1", "x"], ["r2", "y"], ["r3", "z"]]);
    const newIndex = idx([["r1", "x mutated"], ["r2", "y mutated"], ["r3", "z"]]);
    const out = computeDirtyClusters({
      oldIndex,
      newIndex,
      existingPlan: plan([
        { id: "c-be", requirementIds: ["r2"] },
        { id: "c-fe", requirementIds: ["r1"] },
        { id: "c-doc", requirementIds: ["r3"] },
      ]),
    });
    expect(out.dirtyClusterIds).toEqual(["c-be", "c-fe"]);
  });
});
