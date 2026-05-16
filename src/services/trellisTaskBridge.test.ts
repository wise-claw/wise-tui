import { describe, expect, test } from "bun:test";
import type { ProjectItem, Repository } from "../types";
import { buildProjectRequirementWorkspaceInput } from "./trellisTaskBridge";

function repo(overrides: Partial<Repository>): Repository {
  return {
    id: 1,
    name: "repo",
    path: "/work/repo",
    repositoryType: "frontend",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function project(overrides: Partial<ProjectItem>): ProjectItem {
  return {
    id: "p1",
    name: "Project",
    repositoryIds: [],
    rootPath: "/work/project",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("buildProjectRequirementWorkspaceInput", () => {
  test("includes current project roots and truly floating repositories only", () => {
    const current = project({ id: "p1", repositoryIds: [1, 2] });
    const other = project({ id: "p2", repositoryIds: [3] });

    const input = buildProjectRequirementWorkspaceInput({
      project: current,
      projects: [current, other],
      repositories: [
        repo({ id: 1, path: "/work/project/web" }),
        repo({ id: 2, path: "/work/project/api" }),
        repo({ id: 3, path: "/work/other-owned" }),
        repo({ id: 4, path: "/work/floating" }),
      ],
    });

    expect(input).toEqual({
      projectRootPath: "/work/project",
      projectRepositoryPaths: ["/work/project/web", "/work/project/api"],
      floatingRepositoryPaths: ["/work/floating"],
      includeArchived: true,
    });
  });
});
