import { describe, expect, test } from "bun:test";
import type { ProjectItem, Repository } from "../types";
import { resolveProjectMainSessionAnchor } from "./projectSessionAnchor";

function repo(input: Partial<Repository> & Pick<Repository, "id" | "path">): Repository {
  return {
    id: input.id,
    name: input.name ?? `repo-${input.id}`,
    path: input.path,
    repositoryType: input.repositoryType ?? "frontend",
    createdAt: "0",
    updatedAt: "0",
  };
}

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

describe("resolveProjectMainSessionAnchor", () => {
  test("wise_trellis multi-repo with rootPath → project-rooted", () => {
    const p = project({
      id: "p",
      name: "Demo",
      repositoryIds: [1, 2],
      rootPath: "/work/demo",
      sddMode: "wise_trellis",
    });
    const repos = [
      repo({ id: 1, path: "/work/demo/web" }),
      repo({ id: 2, path: "/work/demo/api" }),
    ];
    expect(resolveProjectMainSessionAnchor(p, repos)).toEqual({
      path: "/work/demo",
      displayName: "Project: Demo",
      isProjectRooted: true,
    });
  });

  test("wise_trellis single repo → repo-rooted (degenerate)", () => {
    const p = project({
      id: "p",
      name: "Wise",
      repositoryIds: [1],
      rootPath: "/Users/x/wise",
      sddMode: "wise_trellis",
    });
    const repos = [repo({ id: 1, path: "/Users/x/wise", name: "wise" })];
    const anchor = resolveProjectMainSessionAnchor(p, repos);
    expect(anchor.isProjectRooted).toBe(false);
    expect(anchor.path).toBe("/Users/x/wise");
    expect(anchor.displayName).toBe("Wise/wise");
  });

  test("project_owned with multiple repos → repo-rooted (legacy)", () => {
    const p = project({
      id: "p",
      name: "Legacy",
      repositoryIds: [1, 2],
      rootPath: "/work/legacy",
      sddMode: "project_owned",
    });
    const repos = [
      repo({ id: 1, path: "/work/legacy/a", name: "a" }),
      repo({ id: 2, path: "/work/legacy/b", name: "b" }),
    ];
    const anchor = resolveProjectMainSessionAnchor(p, repos);
    expect(anchor.isProjectRooted).toBe(false);
    expect(anchor.path).toBe("/work/legacy/a");
  });

  test("wise_trellis multi-repo without rootPath → repo-rooted (unmigrated)", () => {
    const p = project({
      id: "p",
      name: "Pending",
      repositoryIds: [1, 2],
      rootPath: "",
      sddMode: "wise_trellis",
    });
    const repos = [
      repo({ id: 1, path: "/work/p/a", name: "a" }),
      repo({ id: 2, path: "/work/p/b", name: "b" }),
    ];
    const anchor = resolveProjectMainSessionAnchor(p, repos);
    expect(anchor.isProjectRooted).toBe(false);
    expect(anchor.path).toBe("/work/p/a");
  });

  test("project with zero repos but rootPath set → project-rooted", () => {
    const p = project({
      id: "p",
      name: "Empty",
      repositoryIds: [],
      rootPath: "/work/empty",
      sddMode: "wise_trellis",
    });
    expect(resolveProjectMainSessionAnchor(p, [])).toEqual({
      path: "/work/empty",
      displayName: "Project: Empty",
      isProjectRooted: true,
    });
  });

  test("project with zero repos and no rootPath → empty sentinel", () => {
    const p = project({ id: "p", name: "Stub", repositoryIds: [], rootPath: "" });
    expect(resolveProjectMainSessionAnchor(p, [])).toEqual({
      path: "",
      displayName: "Stub",
      isProjectRooted: false,
    });
  });

  test("rootPath is trimmed before comparison", () => {
    const p = project({
      id: "p",
      name: "T",
      repositoryIds: [1, 2],
      rootPath: "   /work/t   ",
      sddMode: "wise_trellis",
    });
    const repos = [
      repo({ id: 1, path: "/work/t/a" }),
      repo({ id: 2, path: "/work/t/b" }),
    ];
    expect(resolveProjectMainSessionAnchor(p, repos).path).toBe("/work/t");
  });

  test("missing repository ids in repositories list are skipped", () => {
    const p = project({
      id: "p",
      name: "Partial",
      repositoryIds: [99, 1],
      rootPath: "/work/p",
      sddMode: "wise_trellis",
    });
    const repos = [repo({ id: 1, path: "/work/p/a", name: "a" })];
    const anchor = resolveProjectMainSessionAnchor(p, repos);
    expect(anchor.isProjectRooted).toBe(false);
    expect(anchor.path).toBe("/work/p/a");
  });
});
