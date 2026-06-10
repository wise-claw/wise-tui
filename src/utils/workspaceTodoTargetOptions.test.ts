import { describe, expect, test } from "bun:test";
import type { Repository, Workspace } from "../types";
import {
  buildWorkspaceTodoTargetTree,
  findFirstSelectableWorkspaceTodoTreeKey,
  resolveDefaultWorkspaceTodoTreeKey,
} from "./workspaceTodoTargetOptions";

function project(id: string, name: string, repositoryIds: number[] = []): Workspace {
  return {
    id,
    name,
    repositoryIds,
    createdAt: 0,
    updatedAt: 0,
  };
}

function repository(id: number, name: string): Repository {
  return {
    id,
    name,
    path: `/tmp/${name}`,
    repositoryType: "backend",
    createdAt: "",
    updatedAt: "",
  };
}

describe("workspaceTodoTargetOptions", () => {
  test("buildWorkspaceTodoTargetTree nests repositories under projects", () => {
    const tree = buildWorkspaceTodoTargetTree(
      [project("github", "github", [1])],
      [repository(1, "wise"), repository(2, "solo")],
    );
    expect(tree).toHaveLength(2);
    expect(tree[0]?.value).toBe("project:github");
    expect(tree[0]?.children?.[0]?.value).toBe("repo:1");
    expect(tree[1]?.title).toBe("独立仓库");
    expect(tree[1]?.children?.[0]?.value).toBe("repo:2");
  });

  test("resolveDefaultWorkspaceTodoTreeKey prefers active repository then project", () => {
    const tree = buildWorkspaceTodoTargetTree(
      [project("github", "github", [1])],
      [repository(1, "wise")],
    );
    expect(
      resolveDefaultWorkspaceTodoTreeKey({
        treeNodes: tree,
        activeProjectId: "github",
        activeRepositoryId: 1,
      }),
    ).toBe("repo:1");
    expect(
      resolveDefaultWorkspaceTodoTreeKey({
        treeNodes: tree,
        activeProjectId: "github",
        activeRepositoryId: null,
      }),
    ).toBe("project:github");
  });

  test("findFirstSelectableWorkspaceTodoTreeKey walks depth-first", () => {
    const tree = buildWorkspaceTodoTargetTree(
      [project("eco", "Eco", [1])],
      [repository(1, "wise")],
    );
    expect(findFirstSelectableWorkspaceTodoTreeKey(tree)).toBe("project:eco");
  });
});
