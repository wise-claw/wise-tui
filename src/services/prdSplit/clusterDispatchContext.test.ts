import { describe, expect, test } from "bun:test";
import type { TaskSplitContext } from "../../types";
import type { ClusterPlanItem, PlannerRepo } from "./clusterPlanner";
import { buildClusterDispatchContext } from "./clusterDispatchContext";

const repositories: PlannerRepo[] = [
  { id: 7, name: "web", path: "/repo/web", type: "frontend" },
  { id: 8, name: "api", path: "/repo/api", type: "backend" },
];

function cluster(overrides: Partial<ClusterPlanItem> = {}): ClusterPlanItem {
  return {
    id: "cluster-frontend-7",
    title: "Frontend",
    primaryRepositoryId: 7,
    repositoryIds: [7],
    requirementIds: ["REQ-1"],
    dependencyClusterIds: [],
    ...overrides,
  };
}

describe("buildClusterDispatchContext", () => {
  test("fills repository fields for project context from the cluster primary repository", () => {
    const baseContext: TaskSplitContext = {
      mode: "project",
      projectId: "project-1",
      projectName: "Wise",
    };

    expect(
      buildClusterDispatchContext({
        baseContext,
        cluster: cluster(),
        repositories,
      }),
    ).toEqual({
      mode: "project",
      projectId: "project-1",
      projectName: "Wise",
      repositoryId: 7,
      repositoryName: "web",
      repositoryPath: "/repo/web",
      repositoryType: "frontend",
    });
  });

  test("uses the cluster repository when repository context is already present", () => {
    const baseContext: TaskSplitContext = {
      mode: "repository",
      repositoryId: 7,
      repositoryName: "web",
      repositoryPath: "/repo/web",
      repositoryType: "frontend",
    };

    expect(
      buildClusterDispatchContext({
        baseContext,
        cluster: cluster({
          primaryRepositoryId: null,
          repositoryIds: [8],
        }),
        repositories,
      }),
    ).toEqual({
      mode: "repository",
      repositoryId: 8,
      repositoryName: "api",
      repositoryPath: "/repo/api",
      repositoryType: "backend",
    });
  });

  test("keeps the base context unchanged when a cluster has no known repository", () => {
    const baseContext: TaskSplitContext = {
      mode: "project",
      projectId: "project-1",
      projectName: "Wise",
    };

    const result = buildClusterDispatchContext({
      baseContext,
      cluster: cluster({
        primaryRepositoryId: null,
        repositoryIds: [],
      }),
      repositories,
    });

    expect(result).toBe(baseContext);
  });
});
