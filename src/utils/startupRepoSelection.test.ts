import { describe, expect, test } from "bun:test";
import type { ProjectItem, Repository } from "../types";
import {
  parseWorkspaceLastSelection,
  resolveStartupSelection,
  workspaceWindowSelectionStorageKey,
} from "./startupRepoSelection";

function repo(id: number, path = `/r/${id}`): Repository {
  return {
    id,
    name: `repo-${id}`,
    path,
    repositoryType: "frontend",
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

describe("parseWorkspaceLastSelection", () => {
  test("parses project focus payload", () => {
    expect(
      parseWorkspaceLastSelection(
        JSON.stringify({ focus: "project", projectId: "eco", repositoryId: null }),
      ),
    ).toEqual({ focus: "project", projectId: "eco", repositoryId: null });
  });

  test("rejects invalid focus", () => {
    expect(parseWorkspaceLastSelection(JSON.stringify({ focus: "workspace" }))).toBeNull();
  });
});

describe("resolveStartupSelection", () => {
  test("empty workspace → null selection, no cleanup", () => {
    expect(
      resolveStartupSelection({
        lastSelection: null,
        lastSessionRepoId: null,
        projects: [],
        repositories: [],
      }),
    ).toEqual({
      repositoryId: null,
      projectId: null,
      workspaceFocus: "repository",
      shouldClearLastSession: false,
    });
  });

  test("lastSelection project focus → restore workspace without first repo", () => {
    const repos = [repo(1), repo(2), repo(3)];
    const projects = [project({ id: "eco", repositoryIds: [1, 2, 3], rootPath: "/eco" })];
    expect(
      resolveStartupSelection({
        lastSelection: { focus: "project", projectId: "eco", repositoryId: null },
        lastSessionRepoId: 1,
        projects,
        repositories: repos,
      }),
    ).toEqual({
      repositoryId: null,
      projectId: "eco",
      workspaceFocus: "project",
      shouldClearLastSession: false,
    });
  });

  test("lastSelection repository focus → restore repo over legacy", () => {
    const repos = [repo(1), repo(2)];
    const projects = [project({ id: "p1", repositoryIds: [1, 2] })];
    expect(
      resolveStartupSelection({
        lastSelection: { focus: "repository", projectId: "p1", repositoryId: 2 },
        lastSessionRepoId: 1,
        projects,
        repositories: repos,
      }),
    ).toEqual({
      repositoryId: 2,
      projectId: "p1",
      workspaceFocus: "repository",
      shouldClearLastSession: false,
    });
  });

  test("lastSessionRepoId points to existing floating repo → restore", () => {
    const repos = [repo(1), repo(2)];
    expect(
      resolveStartupSelection({
        lastSelection: null,
        lastSessionRepoId: 2,
        projects: [],
        repositories: repos,
      }),
    ).toEqual({
      repositoryId: 2,
      projectId: null,
      workspaceFocus: "repository",
      shouldClearLastSession: false,
    });
  });

  test("lastSessionRepoId points to existing project repo → restore with owner project", () => {
    const repos = [repo(1), repo(2)];
    const projects = [project({ id: "p1", repositoryIds: [1, 2] })];
    expect(
      resolveStartupSelection({
        lastSelection: null,
        lastSessionRepoId: 2,
        projects,
        repositories: repos,
      }),
    ).toEqual({
      repositoryId: 2,
      projectId: "p1",
      workspaceFocus: "repository",
      shouldClearLastSession: false,
    });
  });

  test("lastSessionRepoId references deleted repo → fallback + cleanup flag", () => {
    const repos = [repo(1)];
    const projects = [project({ id: "p1", repositoryIds: [1] })];
    expect(
      resolveStartupSelection({
        lastSelection: null,
        lastSessionRepoId: 999,
        projects,
        repositories: repos,
      }),
    ).toEqual({
      repositoryId: 1,
      projectId: "p1",
      workspaceFocus: "repository",
      shouldClearLastSession: true,
    });
  });

  test("no lastSession + floating repo present → pick first floating", () => {
    const repos = [repo(1), repo(2), repo(3)];
    const projects = [project({ id: "p1", repositoryIds: [2] })];
    expect(
      resolveStartupSelection({
        lastSelection: null,
        lastSessionRepoId: null,
        projects,
        repositories: repos,
      }),
    ).toEqual({
      repositoryId: 1,
      projectId: null,
      workspaceFocus: "repository",
      shouldClearLastSession: false,
    });
  });

  test("no lastSession + no floating repo → first project's first repo", () => {
    const repos = [repo(1), repo(2)];
    const projects = [
      project({ id: "p1", repositoryIds: [1, 2] }),
      project({ id: "p2", repositoryIds: [] }),
    ];
    expect(
      resolveStartupSelection({
        lastSelection: null,
        lastSessionRepoId: null,
        projects,
        repositories: repos,
      }),
    ).toEqual({
      repositoryId: 1,
      projectId: "p1",
      workspaceFocus: "repository",
      shouldClearLastSession: false,
    });
  });

  test("floating-first: floating repo wins over project even if project listed first", () => {
    const repos = [repo(1), repo(2)];
    const projects = [project({ id: "p1", repositoryIds: [1] })];
    expect(
      resolveStartupSelection({
        lastSelection: null,
        lastSessionRepoId: null,
        projects,
        repositories: repos,
      }),
    ).toEqual({
      repositoryId: 2,
      projectId: null,
      workspaceFocus: "repository",
      shouldClearLastSession: false,
    });
  });

  test("project with orphan repositoryIds is skipped, falls to next project", () => {
    const repos = [repo(2)];
    const projects = [
      project({ id: "p1", repositoryIds: [999] }),
      project({ id: "p2", repositoryIds: [2] }),
    ];
    expect(
      resolveStartupSelection({
        lastSelection: null,
        lastSessionRepoId: null,
        projects,
        repositories: repos,
      }),
    ).toEqual({
      repositoryId: 2,
      projectId: "p2",
      workspaceFocus: "repository",
      shouldClearLastSession: false,
    });
  });

  test("invalid lastSession falls back to floating-first when present", () => {
    const repos = [repo(5), repo(10)];
    const projects = [project({ id: "p1", repositoryIds: [10] })];
    expect(
      resolveStartupSelection({
        lastSelection: null,
        lastSessionRepoId: 999,
        projects,
        repositories: repos,
      }),
    ).toEqual({
      repositoryId: 5,
      projectId: null,
      workspaceFocus: "repository",
      shouldClearLastSession: true,
    });
  });
});

describe("workspaceWindowSelectionStorageKey", () => {
  test("scopes aux window selection by sanitized label", () => {
    expect(workspaceWindowSelectionStorageKey("main-dock-123")).toBe(
      "wise.workspace.windowSelection.v1:main-dock-123",
    );
  });
});
