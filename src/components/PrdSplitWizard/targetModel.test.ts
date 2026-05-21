import { describe, expect, test } from "bun:test";
import type { ProjectItem, Repository } from "../../types";
import {
  projectToPrdSplitTarget,
  repositoryToPrdSplitTarget,
  resolveTrellisTarget,
} from "./targetModel";

function repo(overrides: Partial<Repository> = {}): Repository {
  return {
    id: 7,
    name: "web-app",
    path: "/work/web-app",
    repositoryType: "frontend",
    createdAt: "2026-05-14",
    updatedAt: "2026-05-14",
    ...overrides,
  };
}

function project(overrides: Partial<ProjectItem> = {}): ProjectItem {
  return {
    id: "p1",
    name: "Product",
    repositoryIds: [7, 9],
    rootPath: "/work/product",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("PrdSplitWizard target model", () => {
  test("repository target synthesizes a project ref and repository context", () => {
    const target = repositoryToPrdSplitTarget(repo());

    expect(target.project).toEqual({
      id: "repo:7",
      name: "web-app",
      rootPath: "/work/web-app",
    });
    expect(target.repositories).toEqual([
      {
        id: 7,
        name: "web-app",
        type: "frontend",
        path: "/work/web-app",
      },
    ]);
    expect(target.context).toEqual({
      mode: "repository",
      repositoryId: 7,
      repositoryName: "web-app",
      repositoryPath: "/work/web-app",
      repositoryType: "frontend",
    });
  });

  test("project target keeps project ref and filters missing repository ids", () => {
    const target = projectToPrdSplitTarget(project(), [
      repo(),
      repo({ id: 8, name: "docs", path: "/work/docs", repositoryType: "document" }),
      repo({ id: 9, name: "api", path: "/work/api", repositoryType: "backend" }),
    ]);

    expect(target.project).toEqual({
      id: "p1",
      name: "Product",
      rootPath: "/work/product",
    });
    expect(target.repositories.map((item) => item.id)).toEqual([7, 9]);
    expect(target.repositories[1]).toEqual({
      id: 9,
      name: "api",
      type: "backend",
      path: "/work/api",
    });
    expect(target.context).toEqual({
      mode: "project",
      projectId: "p1",
      projectName: "Product",
      repositoryId: 7,
      repositoryName: "web-app",
      repositoryPath: "/work/web-app",
      repositoryType: "frontend",
    });
  });

  test("workspace target keeps workspace root even for a single repository", () => {
    const resolution = resolveTrellisTarget({
      projects: [project({ repositoryIds: [7], rootPath: "/work/product" })],
      repositories: [repo()],
      activeProjectId: "p1",
      activeRepositoryId: 7,
    });

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.target.kind).toBe("workspace");
    expect(resolution.target.rootPath).toBe("/work/product");
    expect(resolution.target.project).toEqual({
      id: "p1",
      name: "Product",
      rootPath: "/work/product",
    });
    expect(resolution.target.defaultExecutionRepositoryId).toBe(7);
    expect(resolution.target.context).toMatchObject({
      mode: "project",
      projectId: "p1",
      repositoryId: 7,
      repositoryPath: "/work/web-app",
    });
  });

  test("standalone repository target uses repository path as Trellis root", () => {
    const resolution = resolveTrellisTarget({
      projects: [],
      repositories: [repo()],
      activeRepositoryId: 7,
    });

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.target.kind).toBe("standaloneRepository");
    expect(resolution.target.rootPath).toBe("/work/web-app");
    expect(resolution.target.project.id).toBe("repo:7");
    expect(resolution.target.defaultExecutionRepositoryId).toBe(7);
    expect(resolution.target.context).toMatchObject({
      mode: "repository",
      repositoryId: 7,
      repositoryPath: "/work/web-app",
    });
  });

  test("workspace without rootPath fails instead of falling back to repo semantics", () => {
    const resolution = resolveTrellisTarget({
      projects: [project({ rootPath: "" })],
      repositories: [repo(), repo({ id: 9, name: "api", path: "/work/api", repositoryType: "backend" })],
      activeProjectId: "p1",
      activeRepositoryId: 7,
    });

    expect(resolution).toEqual({
      ok: false,
      reason: "当前 Workspace 缺少 rootPath，无法作为 Trellis 根目录。",
    });
  });

  test("linked project wins over linked repository when both are present", () => {
    const resolution = resolveTrellisTarget({
      projects: [project()],
      repositories: [repo(), repo({ id: 9, name: "api", path: "/work/api", repositoryType: "backend" })],
      linkedProjectId: "p1",
      linkedRepositoryId: 9,
    });

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.target.kind).toBe("workspace");
    expect(resolution.target.rootPath).toBe("/work/product");
    expect(resolution.target.activeRepositoryId).toBe(9);
    expect(resolution.target.context.repositoryPath).toBe("/work/api");
  });
});
