import { describe, expect, test } from "bun:test";
import type { ProjectItem, Repository } from "../types";
import { selectFloatingRepositories } from "./floatingRepositories";

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

describe("selectFloatingRepositories", () => {
  test("returns all repos when no projects exist", () => {
    const repos = [repo(1), repo(2), repo(3)];
    expect(selectFloatingRepositories([], repos)).toEqual(repos);
  });

  test("excludes repos referenced by any project", () => {
    const repos = [repo(1), repo(2), repo(3), repo(4)];
    const projects = [
      project({ id: "p1", repositoryIds: [1, 3] }),
    ];
    expect(selectFloatingRepositories(projects, repos)).toEqual([repo(2), repo(4)]);
  });

  test("repo referenced by multiple projects is still excluded (M:N)", () => {
    const repos = [repo(1), repo(2)];
    const projects = [
      project({ id: "p1", repositoryIds: [1] }),
      project({ id: "p2", repositoryIds: [1] }),
    ];
    expect(selectFloatingRepositories(projects, repos)).toEqual([repo(2)]);
  });

  test("returns empty when every repo is assigned", () => {
    const repos = [repo(1), repo(2)];
    const projects = [project({ id: "p1", repositoryIds: [1, 2] })];
    expect(selectFloatingRepositories(projects, repos)).toEqual([]);
  });

  test("preserves input repository order in result", () => {
    const repos = [repo(3), repo(1), repo(2)];
    const projects = [project({ id: "p1", repositoryIds: [1] })];
    expect(selectFloatingRepositories(projects, repos).map((r) => r.id)).toEqual([3, 2]);
  });

  test("ignores project repositoryIds that point to non-existent repos (orphan link)", () => {
    const repos = [repo(1)];
    const projects = [project({ id: "p1", repositoryIds: [1, 999] })];
    expect(selectFloatingRepositories(projects, repos)).toEqual([]);
  });

  test("empty project list and empty repo list → empty result", () => {
    expect(selectFloatingRepositories([], [])).toEqual([]);
  });
});
