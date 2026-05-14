import { describe, expect, test } from "bun:test";
import type { ProjectItem, Repository } from "../types";
import { resolveProjectCreationSeedRepository } from "./projectCreationContext";

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

describe("resolveProjectCreationSeedRepository", () => {
  test("returns selected floating repo as project creation seed", () => {
    const repositories = [repo(1), repo(2)];
    const projects = [project({ id: "p", repositoryIds: [2] })];
    expect(resolveProjectCreationSeedRepository({
      activeRepositoryId: 1,
      projects,
      repositories,
    })).toEqual(repo(1));
  });

  test("does not seed from repo already owned by a project", () => {
    const repositories = [repo(1)];
    const projects = [project({ id: "p", repositoryIds: [1] })];
    expect(resolveProjectCreationSeedRepository({
      activeRepositoryId: 1,
      projects,
      repositories,
    })).toBeNull();
  });

  test("returns null when active repo is missing or unset", () => {
    const repositories = [repo(1)];
    expect(resolveProjectCreationSeedRepository({
      activeRepositoryId: null,
      projects: [],
      repositories,
    })).toBeNull();
    expect(resolveProjectCreationSeedRepository({
      activeRepositoryId: 99,
      projects: [],
      repositories,
    })).toBeNull();
  });
});
