import { describe, expect, test } from "bun:test";
import type { Repository, Workspace } from "../../types";
import { projectRowPropsEqual } from "./projectRowPropsEqual";

function stubProject(id: string, repositoryIds: number[] = [1]): Workspace {
  return {
    id,
    name: `Project ${id}`,
    repositoryIds,
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

describe("projectRowPropsEqual", () => {
  test("ignores unchanged derived props for the same project", () => {
    const project = stubProject("p1");
    const projectRepos = [stubRepo(1)];
    const base = {
      project,
      projectRepos,
      isActiveProject: false,
      activeRepositoryIdInProject: null,
      activeWorkspaceFocus: "repository" as const,
      isPinned: false,
      expanded: true,
      projectDropTargetId: null,
    };
    expect(projectRowPropsEqual(base, { ...base })).toBe(true);
  });

  test("detects active repository changes inside the project", () => {
    const project = stubProject("p1", [1, 2]);
    const projectRepos = [stubRepo(1), stubRepo(2)];
    const base = {
      project,
      projectRepos,
      isActiveProject: false,
      activeRepositoryIdInProject: 1,
      activeWorkspaceFocus: "repository" as const,
      isPinned: false,
      expanded: true,
      projectDropTargetId: null,
    };
    expect(
      projectRowPropsEqual(base, {
        ...base,
        activeRepositoryIdInProject: 2,
      }),
    ).toBe(false);
  });

  test("ignores active repository changes outside the project", () => {
    const project = stubProject("p1", [1]);
    const projectRepos = [stubRepo(1)];
    const base = {
      project,
      projectRepos,
      isActiveProject: false,
      activeRepositoryIdInProject: 1,
      activeWorkspaceFocus: "repository" as const,
      isPinned: false,
      expanded: true,
      projectDropTargetId: null,
    };
    expect(
      projectRowPropsEqual(base, {
        ...base,
        activeRepositoryIdInProject: null,
      }),
    ).toBe(false);
    expect(
      projectRowPropsEqual(
        { ...base, activeRepositoryIdInProject: null },
        { ...base, activeRepositoryIdInProject: null },
      ),
    ).toBe(true);
  });

  test("detects per-repository badge map changes", () => {
    const project = stubProject("p1");
    const projectRepos = [stubRepo(1)];
    const base = {
      project,
      projectRepos,
      isActiveProject: false,
      activeRepositoryIdInProject: null,
      activeWorkspaceFocus: "repository" as const,
      isPinned: false,
      expanded: false,
      projectDropTargetId: null,
      requirementUnsplitByRepoId: { 1: 0 },
    };
    expect(
      projectRowPropsEqual(base, {
        ...base,
        requirementUnsplitByRepoId: { 1: 2 },
      }),
    ).toBe(false);
  });
});
