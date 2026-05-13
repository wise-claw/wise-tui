import { describe, expect, test } from "bun:test";
import type { ProjectItem, Repository } from "../types";
import { resolveSidebarSelectionTarget } from "./sidebarSelectionTarget";

function repo(input: Partial<Repository> & Pick<Repository, "id" | "path">): Repository {
  return {
    id: input.id,
    name: input.name ?? `repo-${input.id}`,
    path: input.path,
    repositoryType: input.repositoryType ?? "frontend",
    createdAt: "0",
    updatedAt: "0",
    mainOwnerAgentName: input.mainOwnerAgentName,
    sddMode: input.sddMode,
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

describe("resolveSidebarSelectionTarget", () => {
  test("floating repo (no ownerProject) → per-repo session at repo.path", () => {
    const r = repo({ id: 1, path: "/r/1" });
    const result = resolveSidebarSelectionTarget({
      repository: r,
      ownerProject: null,
      repositories: [r],
    });
    expect(result).toEqual({
      kind: "per-repo",
      path: "/r/1",
      displayName: "1",
    });
  });

  test("single-repo project without rootPath → per-repo session", () => {
    const r = repo({ id: 1, path: "/r/1" });
    const p = project({ id: "p1", repositoryIds: [1] });
    const result = resolveSidebarSelectionTarget({
      repository: r,
      ownerProject: p,
      repositories: [r],
    });
    expect(result.kind).toBe("per-repo");
    expect(result.path).toBe("/r/1");
  });

  test("single-repo project with rootPath → project-main but anchor degenerates to repo.path (1-member rule)", () => {
    // workspaceMode 派生为 multi_repo（rootPath 非空），故走 project-main 分支；
    // 但 resolveProjectMainSessionAnchor 要求 memberRepos.length > 1 才真正锚到 rootPath，
    // 单 repo 时退化到 firstRepo.path（与历史 commit 9c3dea5 注释一致：单仓项目 rootPath 通常 == repo path）。
    const r = repo({ id: 1, path: "/r/1" });
    const p = project({
      id: "p1",
      name: "WiseDemo",
      repositoryIds: [1],
      rootPath: "/work/wise",
      sddMode: "wise_trellis",
    });
    const result = resolveSidebarSelectionTarget({
      repository: r,
      ownerProject: p,
      repositories: [r],
    });
    expect(result.kind).toBe("project-main");
    if (result.kind === "project-main") {
      expect(result.path).toBe("/r/1");
      expect(result.projectId).toBe("p1");
    }
  });

  test("multi-repo wise_trellis project with rootPath → project-main anchored at rootPath", () => {
    const r1 = repo({ id: 1, path: "/r/1" });
    const r2 = repo({ id: 2, path: "/r/2" });
    const p = project({
      id: "p1",
      name: "MultiWise",
      repositoryIds: [1, 2],
      rootPath: "/work/wise",
      sddMode: "wise_trellis",
    });
    const result = resolveSidebarSelectionTarget({
      repository: r2,
      ownerProject: p,
      repositories: [r1, r2],
    });
    expect(result.kind).toBe("project-main");
    if (result.kind === "project-main") {
      expect(result.path).toBe("/work/wise");
      expect(result.projectId).toBe("p1");
      expect(result.displayName).toBe("Project: MultiWise");
    }
  });

  test("multi-repo project without rootPath → project-main but anchored at first repo (anchor degenerate)", () => {
    // workspaceMode === "multi_repo"（>=2 个 repo），anchor 退化到 firstRepo
    const r1 = repo({ id: 1, path: "/r/1", name: "frontend" });
    const r2 = repo({ id: 2, path: "/r/2" });
    const p = project({
      id: "p1",
      name: "Composed",
      repositoryIds: [1, 2],
    });
    const result = resolveSidebarSelectionTarget({
      repository: r2,
      ownerProject: p,
      repositories: [r1, r2],
    });
    // 缺 rootPath / sddMode != wise_trellis → anchor 退化到 firstRepo.path
    expect(result.kind).toBe("project-main");
    if (result.kind === "project-main") {
      expect(result.path).toBe("/r/1");
      expect(result.projectId).toBe("p1");
    }
  });

  test("explicit workspaceMode = 'single_repo' overrides → per-repo even if project is multi-repo", () => {
    const r1 = repo({ id: 1, path: "/r/1" });
    const r2 = repo({ id: 2, path: "/r/2" });
    const p = project({
      id: "p1",
      repositoryIds: [1, 2],
      rootPath: "/work/wise",
      sddMode: "wise_trellis",
    });
    const result = resolveSidebarSelectionTarget({
      repository: r2,
      ownerProject: p,
      repositories: [r1, r2],
      workspaceMode: "single_repo",
    });
    expect(result.kind).toBe("per-repo");
    expect(result.path).toBe("/r/2");
  });

  test("explicit workspaceMode = 'multi_repo' but no ownerProject → fallback per-repo", () => {
    const r = repo({ id: 1, path: "/r/1" });
    const result = resolveSidebarSelectionTarget({
      repository: r,
      ownerProject: null,
      repositories: [r],
      workspaceMode: "multi_repo",
    });
    expect(result.kind).toBe("per-repo");
  });

  test("multi-repo project with empty rootPath AND empty repo list → falls back to per-repo (anchor.path empty)", () => {
    const r = repo({ id: 1, path: "/r/1" });
    // anchor 边界：memberRepos.length === 0 且 rootPath 空 → anchor.path === ""
    const p = project({ id: "p1", repositoryIds: [], rootPath: "" });
    const result = resolveSidebarSelectionTarget({
      repository: r,
      ownerProject: p,
      repositories: [r],
    });
    // workspaceMode === "single_repo"（repoIds.length === 0 且无 rootPath）→ per-repo
    expect(result.kind).toBe("per-repo");
    expect(result.path).toBe("/r/1");
  });

  test("multi-repo project with empty rootPath but project has rootPath set explicitly → project-main at rootPath", () => {
    const r1 = repo({ id: 1, path: "/r/1" });
    const r2 = repo({ id: 2, path: "/r/2" });
    const p = project({
      id: "p1",
      name: "Rooted",
      repositoryIds: [1, 2],
      rootPath: "/work/rooted",
      // sddMode != wise_trellis：anchor 走 "memberRepos.length > 0" 分支退化到 firstRepo
      // 这里专门测 rootPath 单独存在的情况：workspaceMode === multi_repo（rootPath 非空），
      // 但 anchor 不锚到 rootPath（因为 sddMode != wise_trellis）→ 主会话 path = firstRepo
    });
    const result = resolveSidebarSelectionTarget({
      repository: r2,
      ownerProject: p,
      repositories: [r1, r2],
    });
    expect(result.kind).toBe("project-main");
    if (result.kind === "project-main") {
      expect(result.path).toBe("/r/1"); // anchor 退化到 firstRepo
      expect(result.projectId).toBe("p1");
    }
  });
});
