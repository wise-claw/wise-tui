import { describe, expect, test } from "bun:test";
import type { ProjectItem, Repository } from "../types";
import {
  buildWorkspaceRepositoryTreeData,
  findProjectOwningRepository,
  formatWorkspaceRepositoryContextLabel,
  globalWorkspaceToTreeSelection,
  parseWorkspaceRepositoryTreeValue,
  resolveGitPanelContextOpenPath,
  resolveGitPanelRepositoryEntries,
  resolveProjectDirectoryOpenPath,
  resolveProjectExplorerOpenPath,
  resolveTreeNodeOpenPath,
  resolveWorkspaceRepositoryTreeSelectionView,
} from "./workspaceRepositoryTreeSelect";

const project: ProjectItem = {
  id: "p1",
  name: "eco",
  repositoryIds: [1],
  createdAt: 0,
  updatedAt: 0,
  rootPath: "/eco",
};

const repo: Repository = {
  id: 1,
  name: "eco-ai-web",
  path: "/eco/eco-ai-web",
  repositoryType: "git",
};

const repo2: Repository = {
  id: 2,
  name: "eco-ai",
  path: "/eco/eco-ai",
  repositoryType: "git",
};

const multiRepoProject: ProjectItem = {
  id: "p2",
  name: "eco-suite",
  repositoryIds: [1, 2],
  createdAt: 0,
  updatedAt: 0,
  rootPath: "/eco",
};

describe("workspaceRepositoryTreeSelect", () => {
  test("formats workspace and repository label", () => {
    expect(formatWorkspaceRepositoryContextLabel(project, repo)).toBe("eco-ai-web");
    expect(formatWorkspaceRepositoryContextLabel(null, repo)).toBe("eco-ai-web");
    expect(
      formatWorkspaceRepositoryContextLabel(project, repo, { workspaceFocus: "project" }),
    ).toBe("eco");
    expect(
      formatWorkspaceRepositoryContextLabel(project, repo, { workspaceFocus: "repository" }),
    ).toBe("eco-ai-web");
  });

  test("builds nested tree with standalone group", () => {
    const floating: Repository = { ...repo, id: 2, name: "solo" };
    const tree = buildWorkspaceRepositoryTreeData([project], [repo, floating]);
    expect(tree).toHaveLength(2);
    expect(tree[0]?.selectable).toBe(true);
    expect(tree[0]?.children?.[0]?.value).toBe("repo:1");
    expect(tree[1]?.title).toBe("独立仓库");
  });

  test("parses repository and project tree values", () => {
    expect(parseWorkspaceRepositoryTreeValue("repo:42")).toEqual({
      kind: "repository",
      repositoryId: 42,
    });
    expect(parseWorkspaceRepositoryTreeValue("project:p1")).toEqual({
      kind: "project",
      projectId: "p1",
    });
  });

  test("resolves project directory open path from rootPath", () => {
    expect(resolveProjectDirectoryOpenPath(project, [repo])).toBe("/eco");
  });

  test("prefers project path when workspace focus is project", () => {
    expect(
      resolveGitPanelContextOpenPath({
        activeWorkspaceFocus: "project",
        activeProject: project,
        activeRepositoryPath: "/eco/eco-ai-web",
        repositories: [repo],
      }),
    ).toBe("/eco");
  });

  test("finds owning project", () => {
    expect(findProjectOwningRepository([project], 1)?.id).toBe("p1");
    expect(findProjectOwningRepository([project], 99)).toBeNull();
  });

  test("resolves open path for project and repo tree nodes", () => {
    const tree = buildWorkspaceRepositoryTreeData([project], [repo]);
    const projectNode = tree[0]!;
    const repoNode = projectNode.children![0]!;
    expect(resolveTreeNodeOpenPath(projectNode, [project], [repo])).toBe("/eco");
    expect(resolveTreeNodeOpenPath(repoNode, [project], [repo])).toBe("/eco/eco-ai-web");
  });

  test("maps global workspace focus to tree selection", () => {
    expect(
      globalWorkspaceToTreeSelection({
        activeWorkspaceFocus: "project",
        activeProjectId: "p1",
        activeRepositoryId: 1,
      }),
    ).toEqual({ kind: "project", projectId: "p1" });
    expect(
      globalWorkspaceToTreeSelection({
        activeWorkspaceFocus: "repository",
        activeProjectId: "p1",
        activeRepositoryId: 1,
      }),
    ).toEqual({ kind: "repository", repositoryId: 1 });
  });

  test("resolveProjectExplorerOpenPath falls back to first member when anchor is empty", () => {
    const multi: ProjectItem = {
      id: "p2",
      name: "Split",
      repositoryIds: [1, 2],
      createdAt: 0,
      updatedAt: 0,
      rootPath: "",
    };
    const a = { ...repo, id: 1, path: "/work/p/a", name: "a" };
    const b = { ...repo, id: 2, path: "/other/p/b", name: "b" };
    expect(resolveProjectExplorerOpenPath(multi, [a, b])).toBe("/work/p/a");
    expect(resolveProjectDirectoryOpenPath(multi, [a, b])).toBe("");
  });

  test("resolves file-tree-only selection view without changing global ids", () => {
    const sibling: Repository = { ...repo, id: 2, name: "eco-ai", path: "/eco/eco-ai" };
    const view = resolveWorkspaceRepositoryTreeSelectionView(
      { kind: "repository", repositoryId: 2 },
      [project],
      [repo, sibling],
    );
    expect(view?.path).toBe("/eco/eco-ai");
    expect(view?.label).toBe("eco-ai");
    expect(view?.activeRepositoryId).toBe(2);
    expect(view?.activeWorkspaceFocus).toBe("repository");
  });

  test("resolveGitPanelRepositoryEntries scopes by workspace or repository selection", () => {
    expect(
      resolveGitPanelRepositoryEntries({
        treeSelection: { kind: "project", projectId: "p2" },
        projects: [multiRepoProject],
        repositories: [repo, repo2],
      }),
    ).toEqual([
      { repositoryId: 1, path: "/eco/eco-ai-web", name: "eco-ai-web" },
      { repositoryId: 2, path: "/eco/eco-ai", name: "eco-ai" },
    ]);
    expect(
      resolveGitPanelRepositoryEntries({
        treeSelection: { kind: "repository", repositoryId: 1 },
        projects: [multiRepoProject],
        repositories: [repo, repo2],
      }),
    ).toEqual([{ repositoryId: 1, path: "/eco/eco-ai-web", name: "eco-ai-web" }]);
    expect(
      resolveGitPanelRepositoryEntries({
        treeSelection: { kind: "project", projectId: "p1" },
        projects: [project, multiRepoProject],
        repositories: [repo, repo2],
      }),
    ).toEqual([{ repositoryId: 1, path: "/eco/eco-ai-web", name: "eco-ai-web" }]);
  });
});
