import { describe, expect, test } from "bun:test";
import type { ProjectItem, Repository } from "../types";
import {
  isProjectMainSessionBindingKey,
  projectMainSessionBindingKey,
} from "./repositoryMainSessionBinding";
import { longestCommonRepositoryPathPrefix, resolveProjectMainSessionAnchor } from "./projectSessionAnchor";

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

describe("projectMainSessionBindingKey", () => {
  test("uses stable wise:// workspace id", () => {
    expect(projectMainSessionBindingKey("p-1")).toBe("wise://workspace/p-1");
    expect(isProjectMainSessionBindingKey("wise://workspace/p-1")).toBe(true);
    expect(isProjectMainSessionBindingKey("/work/demo")).toBe(false);
  });
});

describe("longestCommonRepositoryPathPrefix", () => {
  test("sibling repos under same parent", () => {
    expect(
      longestCommonRepositoryPathPrefix(["/work/hualan/vocs-web", "/work/hualan/hlhb-int"]),
    ).toBe("/work/hualan");
  });

  test("unrelated roots → empty", () => {
    expect(longestCommonRepositoryPathPrefix(["/a/foo", "/z/bar"])).toBe("");
  });
});

describe("resolveProjectMainSessionAnchor", () => {
  test("multi-repo with rootPath → project-rooted", () => {
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

  test("multi-repo project_owned with rootPath → project-rooted (not first repo)", () => {
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
    expect(anchor).toEqual({
      path: "/work/legacy",
      displayName: "Project: Legacy",
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

  test("multi-repo without rootPath but shared parent → project-rooted at common prefix", () => {
    const p = project({
      id: "p",
      name: "Hualan",
      repositoryIds: [1, 2],
      rootPath: "",
      sddMode: "wise_trellis",
    });
    const repos = [
      repo({ id: 1, path: "/work/hualan/vocs-web", name: "vocs-web" }),
      repo({ id: 2, path: "/work/hualan/hlhb-int", name: "hlhb-int" }),
    ];
    const anchor = resolveProjectMainSessionAnchor(p, repos);
    expect(anchor).toEqual({
      path: "/work/hualan",
      displayName: "Project: Hualan",
      isProjectRooted: true,
    });
  });

  test("multi-repo with unrelated paths and no rootPath → empty anchor", () => {
    const p = project({
      id: "p",
      name: "Pending",
      repositoryIds: [1, 2],
      rootPath: "",
      sddMode: "wise_trellis",
    });
    const repos = [
      repo({ id: 1, path: "/work/p/a", name: "a" }),
      repo({ id: 2, path: "/other/p/b", name: "b" }),
    ];
    const anchor = resolveProjectMainSessionAnchor(p, repos);
    expect(anchor.path).toBe("");
    expect(anchor.isProjectRooted).toBe(false);
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

  test("rootPath is trimmed before use", () => {
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

  test("missing repository ids in repositories list are skipped for single-member degenerate", () => {
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
