import { describe, expect, test } from "bun:test";
import type { ProjectItem, Repository } from "../types";
import { resolveStartupSelection } from "./startupRepoSelection";

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

describe("resolveStartupSelection", () => {
  test("empty workspace → null selection, no cleanup", () => {
    expect(
      resolveStartupSelection({
        lastSessionRepoId: null,
        projects: [],
        repositories: [],
      }),
    ).toEqual({ repositoryId: null, projectId: null, shouldClearLastSession: false });
  });

  test("lastSessionRepoId points to existing floating repo → restore", () => {
    const repos = [repo(1), repo(2)];
    expect(
      resolveStartupSelection({
        lastSessionRepoId: 2,
        projects: [],
        repositories: repos,
      }),
    ).toEqual({ repositoryId: 2, projectId: null, shouldClearLastSession: false });
  });

  test("lastSessionRepoId points to existing project repo → restore with owner project", () => {
    const repos = [repo(1), repo(2)];
    const projects = [project({ id: "p1", repositoryIds: [1, 2] })];
    expect(
      resolveStartupSelection({
        lastSessionRepoId: 2,
        projects,
        repositories: repos,
      }),
    ).toEqual({ repositoryId: 2, projectId: "p1", shouldClearLastSession: false });
  });

  test("lastSessionRepoId references deleted repo → fallback + cleanup flag", () => {
    const repos = [repo(1)];
    const projects = [project({ id: "p1", repositoryIds: [1] })];
    expect(
      resolveStartupSelection({
        lastSessionRepoId: 999,
        projects,
        repositories: repos,
      }),
    ).toEqual({ repositoryId: 1, projectId: "p1", shouldClearLastSession: true });
  });

  test("no lastSession + floating repo present → pick first floating", () => {
    const repos = [repo(1), repo(2), repo(3)];
    const projects = [project({ id: "p1", repositoryIds: [2] })];
    expect(
      resolveStartupSelection({
        lastSessionRepoId: null,
        projects,
        repositories: repos,
      }),
    ).toEqual({ repositoryId: 1, projectId: null, shouldClearLastSession: false });
  });

  test("no lastSession + no floating repo → first project's first repo", () => {
    const repos = [repo(1), repo(2)];
    const projects = [
      project({ id: "p1", repositoryIds: [1, 2] }),
      project({ id: "p2", repositoryIds: [] }),
    ];
    expect(
      resolveStartupSelection({
        lastSessionRepoId: null,
        projects,
        repositories: repos,
      }),
    ).toEqual({ repositoryId: 1, projectId: "p1", shouldClearLastSession: false });
  });

  test("floating-first: floating repo wins over project even if project listed first", () => {
    const repos = [repo(1), repo(2)];
    const projects = [project({ id: "p1", repositoryIds: [1] })];
    expect(
      resolveStartupSelection({
        lastSessionRepoId: null,
        projects,
        repositories: repos,
      }),
    ).toEqual({ repositoryId: 2, projectId: null, shouldClearLastSession: false });
  });

  test("project with orphan repositoryIds is skipped, falls to next project", () => {
    const repos = [repo(2)];
    const projects = [
      project({ id: "p1", repositoryIds: [999] }),
      project({ id: "p2", repositoryIds: [2] }),
    ];
    expect(
      resolveStartupSelection({
        lastSessionRepoId: null,
        projects,
        repositories: repos,
      }),
    ).toEqual({ repositoryId: 2, projectId: "p2", shouldClearLastSession: false });
  });

  test("invalid lastSession falls back to floating-first when present", () => {
    const repos = [repo(5), repo(10)];
    const projects = [project({ id: "p1", repositoryIds: [10] })];
    expect(
      resolveStartupSelection({
        lastSessionRepoId: 999,
        projects,
        repositories: repos,
      }),
    ).toEqual({ repositoryId: 5, projectId: null, shouldClearLastSession: true });
  });
});
