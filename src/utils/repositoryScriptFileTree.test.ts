import { describe, expect, test } from "bun:test";
import {
  buildRepositoryScriptFileTreeNodes,
  ensureSelectedFileTreeNode,
  patchRepositoryScriptFileTreeChildren,
  repositoryScriptFileTreeNodeTitle,
} from "./repositoryScriptFileTree";

describe("repositoryScriptFileTreeNodeTitle", () => {
  test("returns the last path segment", () => {
    expect(repositoryScriptFileTreeNodeTitle("scripts/echo.sh")).toBe("echo.sh");
    expect(repositoryScriptFileTreeNodeTitle("package.json")).toBe("package.json");
  });
});

describe("buildRepositoryScriptFileTreeNodes", () => {
  test("directories are expandable and not selectable; files are leaves", () => {
    const nodes = buildRepositoryScriptFileTreeNodes([
      { path: "README.md", isDir: false },
      { path: "scripts", isDir: true },
      { path: "../secret.sh", isDir: false },
    ]);
    expect(nodes.map((n) => n.value)).toEqual(["scripts", "README.md"]);
    expect(nodes[0]).toMatchObject({ selectable: false, isLeaf: false, title: "scripts" });
    expect(nodes[1]).toMatchObject({ selectable: true, isLeaf: true, title: "README.md" });
  });
});

describe("patchRepositoryScriptFileTreeChildren", () => {
  test("attaches children under the matching directory", () => {
    const root = buildRepositoryScriptFileTreeNodes([
      { path: "scripts", isDir: true },
      { path: "README.md", isDir: false },
    ]);
    const children = buildRepositoryScriptFileTreeNodes([{ path: "scripts/echo.sh", isDir: false }]);
    const next = patchRepositoryScriptFileTreeChildren(root, "scripts", children);
    expect(next[0]?.children).toEqual([
      { title: "scripts/echo.sh", value: "scripts/echo.sh", selectable: true, isLeaf: true },
    ]);
    expect(next[0]?.isLeaf).toBe(false);
  });

  test("marks empty directories as leaves", () => {
    const root = buildRepositoryScriptFileTreeNodes([{ path: "empty", isDir: true }]);
    const next = patchRepositoryScriptFileTreeChildren(root, "empty", []);
    expect(next[0]?.isLeaf).toBe(true);
    expect(next[0]?.children).toEqual([]);
  });
});

describe("ensureSelectedFileTreeNode", () => {
  test("prepends a leaf when the selected path is not loaded yet", () => {
    const root = buildRepositoryScriptFileTreeNodes([{ path: "scripts", isDir: true }]);
    const next = ensureSelectedFileTreeNode(root, "scripts/echo.sh");
    expect(next[0]).toEqual({
      title: "scripts/echo.sh",
      value: "scripts/echo.sh",
      selectable: true,
      isLeaf: true,
    });
  });

  test("does not duplicate a path already in the tree", () => {
    const root = buildRepositoryScriptFileTreeNodes([{ path: "a.sh", isDir: false }]);
    expect(ensureSelectedFileTreeNode(root, "a.sh")).toEqual(root);
  });
});
