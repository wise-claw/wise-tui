import { describe, expect, test } from "bun:test";
import type { ProjectItem, Repository } from "../../types";
import {
  projectToPrdSplitTarget,
  repositoryToPrdSplitTarget,
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
      id: "repo-7",
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
    });
  });
});
