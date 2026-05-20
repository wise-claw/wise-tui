import { describe, expect, test } from "bun:test";
import type { ProjectItem, Repository } from "../types";
import { resolveTrellisBootstrapPath } from "./trellisBootstrapPath";

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

function repo(input: Partial<Repository> & Pick<Repository, "id" | "path">): Repository {
  return {
    id: input.id,
    name: input.name ?? "repo",
    path: input.path,
    type: input.type ?? "local",
    createdAt: 0,
    updatedAt: 0,
    sddMode: input.sddMode,
  };
}

describe("resolveTrellisBootstrapPath", () => {
  test("repository scope uses repo path even inside multi-repo project", () => {
    const p = project({ id: "p1", repositoryIds: [1, 2], rootPath: "/work/hualan" });
    const r = repo({ id: 1, path: "/work/hualan/vocs-web" });
    expect(
      resolveTrellisBootstrapPath({
        scope: "repository",
        project: p,
        repository: r,
        repositories: [r],
      }),
    ).toBe("/work/hualan/vocs-web");
  });

  test("project scope single-repo uses member repo path", () => {
    const p = project({ id: "p1", repositoryIds: [1] });
    const r = repo({ id: 1, path: "/work/vocs-web" });
    expect(
      resolveTrellisBootstrapPath({
        scope: "project",
        project: p,
        repositories: [r],
      }),
    ).toBe("/work/vocs-web");
  });

  test("project scope multi-repo uses workspace rootPath", () => {
    const p = project({ id: "p1", repositoryIds: [1, 2], rootPath: "/work/hualan" });
    const repos = [
      repo({ id: 1, path: "/work/hualan/vocs-web" }),
      repo({ id: 2, path: "/work/hualan/tds-mobile" }),
    ];
    expect(
      resolveTrellisBootstrapPath({
        scope: "project",
        project: p,
        repositories: repos,
      }),
    ).toBe("/work/hualan");
  });

  test("floating repository without project", () => {
    const r = repo({ id: 9, path: "/work/standalone" });
    expect(
      resolveTrellisBootstrapPath({
        scope: "repository",
        repository: r,
        repositories: [r],
      }),
    ).toBe("/work/standalone");
  });
});
