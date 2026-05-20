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
  test("multi_repo + project focus → keep only Project: display-name sessions", () => {
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
      session({ id: "s-main", repositoryPath: "/work/wise", repositoryName: "Project: Wise" }),
      session({ id: "s-frontend-legacy", repositoryPath: "/work/wise/frontend" }),
      session({ id: "s-backend-legacy", repositoryPath: "/work/wise/backend" }),
    ];
    const filtered = filterSessionsForWorkspace({
      sessions,
      workspaceMode: "multi_repo",
      project: p,
      repositories: [r1, r2],
      activeWorkspaceFocus: "project",
    });
    expect(filtered.map((s) => s.id)).toEqual(["s-main"]);
  });

  test("multi_repo + repository focus → keep repo sessions and exclude Project:", () => {
    const r1 = repo({ id: 1, path: "/parent/a" });
    const r2 = repo({ id: 2, path: "/parent/b" });
    const p = project({
      id: "p1",
      repositoryIds: [1, 2],
      rootPath: "/parent",
    });
    const sessions = [
      session({ id: "s-project", repositoryPath: "/parent/a", repositoryName: "Project: p1" }),
      session({ id: "s-a", repositoryPath: "/parent/a" }),
      session({ id: "s-b", repositoryPath: "/parent/b" }),
    ];
    const filtered = filterSessionsForWorkspace({
      sessions,
      workspaceMode: "multi_repo",
      project: p,
      repositories: [r1, r2],
      activeWorkspaceFocus: "repository",
      activeRepositoryId: 1,
    });
    expect(filtered.map((s) => s.id)).toEqual(["s-a"]);
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

  test("repository focus excludes Project: session even when cwd equals repo path", () => {
    const r1 = repo({ id: 1, path: "/work/wise/frontend" });
    const p = project({ id: "p1", repositoryIds: [1], rootPath: "/work/wise" });
    const sessions = [
      session({
        id: "s-project",
        repositoryPath: "/work/wise/frontend",
        repositoryName: "Project: Wise",
      }),
      session({ id: "s-repo", repositoryPath: "/work/wise/frontend", repositoryName: "frontend" }),
    ];
    const filtered = filterSessionsForWorkspace({
      sessions,
      workspaceMode: "multi_repo",
      project: p,
      repositories: [r1],
      activeWorkspaceFocus: "repository",
      activeRepositoryId: 1,
    });
    expect(filtered.map((s) => s.id)).toEqual(["s-repo"]);
  });
});
