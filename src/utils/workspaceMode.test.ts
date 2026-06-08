import { describe, expect, test } from "bun:test";
import type { ProjectItem, Repository } from "../types";
import {
  findOwnerProjectForRepositoryId,
  isMultiRepoProject,
  resolveSidebarExpandedProjectId,
  resolveWorkspaceMode,
  shouldRevealWorkspaceListOnRestore,
  shouldSidebarRepositorySelectOnlyUpdateFocus,
} from "./workspaceMode";

function project(input: Partial<ProjectItem> & Pick<ProjectItem, "id">): ProjectItem {
  return {
    id: input.id,
    name: input.name ?? "Demo",
    repositoryIds: input.repositoryIds ?? [],
    createdAt: 0,
    updatedAt: 0,
    rootPath: input.rootPath,
    sddMode: input.sddMode,
  };
}

describe("resolveWorkspaceMode", () => {
  test("no active project → single_repo (floating repo case)", () => {
    expect(resolveWorkspaceMode({ activeProjectId: null, projects: [] })).toBe("single_repo");
  });

  test("active project id not found in projects (stale) → single_repo", () => {
    const p = project({ id: "p1", repositoryIds: [1] });
    expect(
      resolveWorkspaceMode({ activeProjectId: "p-stale", projects: [p] }),
    ).toBe("single_repo");
  });

  test("active project with single repo and no rootPath → single_repo", () => {
    const p = project({ id: "p1", repositoryIds: [1] });
    expect(resolveWorkspaceMode({ activeProjectId: "p1", projects: [p] })).toBe(
      "single_repo",
    );
  });

  test("active project with single repo and configured rootPath → multi_repo", () => {
    const p = project({ id: "p1", repositoryIds: [1], rootPath: "/work/demo" });
    expect(resolveWorkspaceMode({ activeProjectId: "p1", projects: [p] })).toBe(
      "multi_repo",
    );
  });

  test("active project with two repos and no rootPath → multi_repo", () => {
    const p = project({ id: "p1", repositoryIds: [1, 2] });
    expect(resolveWorkspaceMode({ activeProjectId: "p1", projects: [p] })).toBe(
      "multi_repo",
    );
  });

  test("active project with two repos and rootPath → multi_repo", () => {
    const p = project({ id: "p1", repositoryIds: [1, 2], rootPath: "/work/demo" });
    expect(resolveWorkspaceMode({ activeProjectId: "p1", projects: [p] })).toBe(
      "multi_repo",
    );
  });

  test("active project with zero repos but rootPath → multi_repo", () => {
    const p = project({ id: "p1", repositoryIds: [], rootPath: "/work/demo" });
    expect(resolveWorkspaceMode({ activeProjectId: "p1", projects: [p] })).toBe(
      "multi_repo",
    );
  });

  test("active project with zero repos and no rootPath → single_repo (edge)", () => {
    const p = project({ id: "p1", repositoryIds: [] });
    expect(resolveWorkspaceMode({ activeProjectId: "p1", projects: [p] })).toBe(
      "single_repo",
    );
  });

  test("rootPath of whitespace only treated as empty", () => {
    const p = project({ id: "p1", repositoryIds: [1], rootPath: "   " });
    expect(resolveWorkspaceMode({ activeProjectId: "p1", projects: [p] })).toBe(
      "single_repo",
    );
  });
});

describe("multi-repo sidebar repository select", () => {
  const repo = (id: number): Repository => ({
    id,
    name: `repo-${id}`,
    path: `/work/repo-${id}`,
    repositoryType: "frontend",
    createdAt: 0,
    updatedAt: 0,
  });

  test("two-repo project → sidebar repo click only updates focus", () => {
    const projects = [project({ id: "eco", repositoryIds: [1, 2] })];
    expect(shouldSidebarRepositorySelectOnlyUpdateFocus(repo(1), projects)).toBe(true);
    expect(findOwnerProjectForRepositoryId(2, projects)?.id).toBe("eco");
    expect(isMultiRepoProject(projects[0], projects)).toBe(true);
  });

  test("floating repo → per-repo session bind still allowed", () => {
    const projects = [project({ id: "other", repositoryIds: [99] })];
    expect(shouldSidebarRepositorySelectOnlyUpdateFocus(repo(1), projects)).toBe(false);
  });
});

describe("resolveSidebarExpandedProjectId", () => {
  test("expands owner project for restored repository selection", () => {
    const projects = [
      project({ id: "first", repositoryIds: [1] }),
      project({ id: "second", repositoryIds: [2, 3] }),
    ];
    expect(
      resolveSidebarExpandedProjectId(projects, {
        activeProjectId: null,
        activeRepositoryId: 3,
        activeWorkspaceFocus: "repository",
      }),
    ).toBe("second");
  });

  test("falls back to first project when nothing is selected", () => {
    const projects = [project({ id: "first", repositoryIds: [1] })];
    expect(
      resolveSidebarExpandedProjectId(projects, {
        activeProjectId: null,
        activeRepositoryId: null,
      }),
    ).toBe("first");
  });
});

describe("shouldRevealWorkspaceListOnRestore", () => {
  test("reveals when selected repo is not the first under its workspace", () => {
    const projects = [project({ id: "eco", repositoryIds: [1, 2] })];
    expect(
      shouldRevealWorkspaceListOnRestore(projects, {
        activeProjectId: null,
        activeRepositoryId: 2,
      }),
    ).toBe(true);
  });

  test("reveals when selected repo belongs to a non-first workspace", () => {
    const projects = [
      project({ id: "first", repositoryIds: [1] }),
      project({ id: "second", repositoryIds: [2] }),
    ];
    expect(
      shouldRevealWorkspaceListOnRestore(projects, {
        activeProjectId: null,
        activeRepositoryId: 2,
      }),
    ).toBe(true);
  });

  test("skips when first workspace first repo is selected", () => {
    const projects = [project({ id: "first", repositoryIds: [1, 2] })];
    expect(
      shouldRevealWorkspaceListOnRestore(projects, {
        activeProjectId: null,
        activeRepositoryId: 1,
      }),
    ).toBe(false);
  });
});
