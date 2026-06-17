import { describe, expect, test } from "bun:test";
import type { Repository, Workspace } from "../../types";
import { projectRepositoryListPropsEqual } from "./projectRepositoryListPropsEqual";

function stubProject(id: string): Workspace {
  return {
    id,
    name: id,
    repositoryIds: [1],
    sddMode: "off",
    rootPath: null,
    openAppId: null,
  } as Workspace;
}

function stubRepo(id: number): Repository {
  return {
    id,
    path: `/repo/${id}`,
    name: `repo-${id}`,
    sddMode: "off",
  } as Repository;
}

describe("projectRepositoryListPropsEqual", () => {
  test("ignores selection unchanged when only unrelated fields differ by reference", () => {
    const projects = [stubProject("p1")];
    const repositoriesById = new Map<number, Repository>([[1, stubRepo(1)]]);
    const base = {
      projects,
      repositoriesById,
      floatingRepositories: [],
      activeProjectId: "p1",
      activeWorkspaceFocus: "project" as const,
      activeRepositoryId: null,
      showRepositoryIconBadgesInWorkspaceList: false,
      pinnedProjectIds: [],
      expandedProjects: new Set(["p1"]),
      projectDropTargetId: null,
      projectTrellisReadyById: {},
      repositoryTrellisReadyById: {},
      scheduledTasksByRepoId: {},
      requirementUnsplitByProjectId: {},
      requirementUnsplitByRepoId: {},
      executableTasksByProjectId: {},
      executableTasksByRepoId: {},
      workspaceTodosEnabled: true,
      runningMainSessionByProjectId: {},
      runningMainSessionByRepositoryId: {},
      sectionCollapsed: false,
    };
    expect(projectRepositoryListPropsEqual(base, { ...base })).toBe(true);
  });

  test("detects active repository changes", () => {
    const projects = [stubProject("p1")];
    const repositoriesById = new Map<number, Repository>([[1, stubRepo(1)]]);
    const base = {
      projects,
      repositoriesById,
      floatingRepositories: [],
      activeProjectId: "p1",
      activeWorkspaceFocus: "repository" as const,
      activeRepositoryId: 1,
      showRepositoryIconBadgesInWorkspaceList: false,
      pinnedProjectIds: [],
      expandedProjects: new Set<string>(),
      projectDropTargetId: null,
      projectTrellisReadyById: {},
      repositoryTrellisReadyById: {},
      scheduledTasksByRepoId: {},
      requirementUnsplitByProjectId: {},
      requirementUnsplitByRepoId: {},
      executableTasksByProjectId: {},
      executableTasksByRepoId: {},
      workspaceTodosEnabled: true,
      runningMainSessionByProjectId: {},
      runningMainSessionByRepositoryId: {},
      sectionCollapsed: false,
    };
    expect(
      projectRepositoryListPropsEqual(base, {
        ...base,
        activeRepositoryId: 2,
      }),
    ).toBe(false);
  });
});
