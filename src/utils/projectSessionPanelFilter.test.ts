import { describe, expect, test } from "bun:test";
import type { ClaudeMessage, ClaudeSession, ProjectItem, Repository } from "../types";
import { filterSessionsForWorkspace } from "./projectSessionPanelFilter";

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

function session(
  input: Partial<ClaudeSession> & Pick<ClaudeSession, "id" | "repositoryPath">,
): ClaudeSession {
  const messages: ClaudeMessage[] = input.messages ?? [];
  return {
    id: input.id,
    claudeSessionId: input.claudeSessionId ?? null,
    repositoryPath: input.repositoryPath,
    repositoryName: input.repositoryName ?? input.repositoryPath,
    model: input.model ?? "claude-sonnet",
    status: input.status ?? "idle",
    messages,
    createdAt: input.createdAt ?? 0,
  };
}

describe("filterSessionsForWorkspace", () => {
  test("multi_repo with rootPath → keep only anchor.path-rooted sessions", () => {
    const r1 = repo({ id: 1, path: "/work/wise/frontend" });
    const r2 = repo({ id: 2, path: "/work/wise/backend" });
    const p = project({
      id: "p1",
      name: "Wise",
      repositoryIds: [1, 2],
      rootPath: "/work/wise",
      sddMode: "wise_trellis",
    });
    const sessions = [
      session({ id: "s-main", repositoryPath: "/work/wise" }),
      session({ id: "s-frontend-legacy", repositoryPath: "/work/wise/frontend" }),
      session({ id: "s-backend-legacy", repositoryPath: "/work/wise/backend" }),
    ];
    const filtered = filterSessionsForWorkspace({
      sessions,
      workspaceMode: "multi_repo",
      project: p,
      repositories: [r1, r2],
    });
    expect(filtered.map((s) => s.id)).toEqual(["s-main"]);
  });

  test("multi_repo falling back to first-repo anchor (sddMode != wise_trellis) → keep only first-repo-rooted", () => {
    // 缺 sddMode/wise_trellis → anchor 退化到 firstRepo.path（与 sidebarSelectionTarget 测试同源）
    const r1 = repo({ id: 1, path: "/r/1" });
    const r2 = repo({ id: 2, path: "/r/2" });
    const p = project({
      id: "p1",
      repositoryIds: [1, 2],
    });
    const sessions = [
      session({ id: "s-anchored", repositoryPath: "/r/1" }),
      session({ id: "s-other", repositoryPath: "/r/2" }),
    ];
    const filtered = filterSessionsForWorkspace({
      sessions,
      workspaceMode: "multi_repo",
      project: p,
      repositories: [r1, r2],
    });
    expect(filtered.map((s) => s.id)).toEqual(["s-anchored"]);
  });

  test("single_repo → returns sessions unchanged (no filter)", () => {
    const r = repo({ id: 1, path: "/r/1" });
    const p = project({ id: "p1", repositoryIds: [1] });
    const sessions = [
      session({ id: "s-a", repositoryPath: "/r/1" }),
      session({ id: "s-b", repositoryPath: "/r/2" }),
    ];
    const filtered = filterSessionsForWorkspace({
      sessions,
      workspaceMode: "single_repo",
      project: p,
      repositories: [r],
    });
    expect(filtered.map((s) => s.id)).toEqual(["s-a", "s-b"]);
  });

  test("floating repo (no project) → returns sessions unchanged", () => {
    const r = repo({ id: 1, path: "/r/1" });
    const sessions = [
      session({ id: "s-a", repositoryPath: "/r/1" }),
      session({ id: "s-b", repositoryPath: "/r/2" }),
    ];
    const filtered = filterSessionsForWorkspace({
      sessions,
      workspaceMode: "single_repo",
      project: null,
      repositories: [r],
    });
    expect(filtered.map((s) => s.id)).toEqual(["s-a", "s-b"]);
  });

  test("multi_repo declared but project is null → defensive passthrough", () => {
    const r = repo({ id: 1, path: "/r/1" });
    const sessions = [session({ id: "s-a", repositoryPath: "/r/1" })];
    const filtered = filterSessionsForWorkspace({
      sessions,
      workspaceMode: "multi_repo",
      project: null,
      repositories: [r],
    });
    expect(filtered.map((s) => s.id)).toEqual(["s-a"]);
  });

  test("multi_repo project but anchor.path empty (no repos, no rootPath) → passthrough", () => {
    const p = project({ id: "p1", repositoryIds: [], rootPath: "" });
    const sessions = [
      session({ id: "s-x", repositoryPath: "/somewhere" }),
      session({ id: "s-y", repositoryPath: "/elsewhere" }),
    ];
    const filtered = filterSessionsForWorkspace({
      sessions,
      workspaceMode: "multi_repo",
      project: p,
      repositories: [],
    });
    expect(filtered.map((s) => s.id)).toEqual(["s-x", "s-y"]);
  });

  test("path normalization: trailing slash / backslashes match anchor regardless of separator quirks", () => {
    const r1 = repo({ id: 1, path: "/work/wise/frontend" });
    const r2 = repo({ id: 2, path: "/work/wise/backend" });
    const p = project({
      id: "p1",
      name: "Wise",
      repositoryIds: [1, 2],
      rootPath: "/work/wise/",
      sddMode: "wise_trellis",
    });
    const sessions = [
      session({ id: "s-main", repositoryPath: "/work/wise" }),
      session({ id: "s-main-trailing", repositoryPath: "/work/wise/" }),
      session({ id: "s-frontend", repositoryPath: "/work/wise/frontend" }),
    ];
    const filtered = filterSessionsForWorkspace({
      sessions,
      workspaceMode: "multi_repo",
      project: p,
      repositories: [r1, r2],
    });
    expect(filtered.map((s) => s.id).sort()).toEqual(["s-main", "s-main-trailing"]);
  });
});
