import { describe, expect, test } from "bun:test";
import type { ProjectItem, Repository } from "../../types";
import {
  ownerProjectForRepository,
  projectSelectOptions,
  projectWorkspaceLabel,
  repositorySelectOptions,
  repositoryWorkspaceLabel,
  resolveBindingProjectId,
} from "./workspaceDirectory";

function repo(id: number, path: string, name = "stale-name"): Repository {
  return {
    id,
    name,
    path,
    repositoryType: "backend",
    createdAt: "",
    updatedAt: "",
  };
}

function project(id: string, name: string, repositoryIds: number[], iconDisplayName?: string): ProjectItem {
  return {
    id,
    name,
    repositoryIds,
    createdAt: 0,
    updatedAt: 0,
    iconDisplayName,
  };
}

describe("workspaceDirectory", () => {
  test("repository label uses folder basename, not stale repo.name", () => {
    expect(repositoryWorkspaceLabel(repo(1, "/Users/me/code/wise-tui", "oldName"))).toBe("wise-tui");
  });

  test("project label prefers member workspace names over projects.name", () => {
    const repositories = [repo(1, "/work/ai-message-platform"), repo(2, "/work/starar-ai")];
    expect(projectWorkspaceLabel(project("p1", "aiMessageplatat", [1]), repositories)).toBe("ai-message-platform");
    expect(projectWorkspaceLabel(project("p2", "legacy", [1, 2]), repositories)).toBe("ai-message-platform、starar-ai");
    expect(projectWorkspaceLabel(project("p3", "empty-old", []), repositories)).toBe("empty-old");
    expect(projectWorkspaceLabel(project("p4", "empty-old", [], "展示名"), repositories)).toBe("展示名");
  });

  test("select options list all repositories and hide empty projects", () => {
    const repositories = [repo(2, "/work/wise-tui"), repo(1, "/work/githubback")];
    const projects = [project("p1", "aiMessageplatat", [1]), project("empty", "ghost", [])];
    expect(repositorySelectOptions(repositories, projects).map((o) => o.label)).toEqual([
      "githubback",
      "wise-tui（未加入项目）",
    ]);
    expect(projectSelectOptions(projects, repositories)).toEqual([{ value: "p1", label: "githubback" }]);
  });

  test("resolve binding project prefers owner membership", () => {
    const projects = [project("p1", "a", [1]), project("p2", "b", [2])];
    expect(ownerProjectForRepository(projects, 2)?.id).toBe("p2");
    expect(resolveBindingProjectId(projects, 1, "p2")).toBe("p1");
    expect(resolveBindingProjectId(projects, 3, "p1")).toBeNull();
  });
});
