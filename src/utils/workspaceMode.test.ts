import { describe, expect, test } from "bun:test";
import type { ProjectItem } from "../types";
import { resolveWorkspaceMode } from "./workspaceMode";

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
