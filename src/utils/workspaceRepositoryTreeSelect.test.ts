import { describe, expect, test } from "bun:test";
import type { ProjectItem, Repository } from "../types";
import {
  buildWorkspaceRepositoryTreeData,
  findProjectOwningRepository,
  formatWorkspaceRepositoryContextLabel,
  parseWorkspaceRepositoryTreeValue,
  resolveGitPanelContextOpenPath,
  resolveProjectDirectoryOpenPath,
  resolveTreeNodeOpenPath,
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

describe("workspaceRepositoryTreeSelect", () => {
  test("formats workspace and repository label", () => {
    expect(formatWorkspaceRepositoryContextLabel(project, repo)).toBe("eco / eco-ai-web");
    expect(formatWorkspaceRepositoryContextLabel(null, repo)).toBe("eco-ai-web");
    expect(
      formatWorkspaceRepositoryContextLabel(project, repo, { workspaceFocus: "project" }),
    ).toBe("eco");
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
});
