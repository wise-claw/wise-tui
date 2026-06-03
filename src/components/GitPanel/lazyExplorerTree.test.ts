import { describe, expect, test } from "bun:test";
import type { RepositoryExplorerEntry } from "../../services/repositoryFiles";
import {
  buildLazyRepositoryFileTree,
  patchLazyRepositoryFileTree,
  pruneLoadedChildrenMap,
} from "./lazyExplorerTree";

describe("buildLazyRepositoryFileTree", () => {
  test("builds root and one expanded level from lazy map", () => {
    const loaded = new Map<string, RepositoryExplorerEntry[]>([
      [
        "",
        [
          { path: "src", isDir: true },
          { path: "readme.md", isDir: false },
        ],
      ],
      [
        "src",
        [
          { path: "src/index.ts", isDir: false },
          { path: "src/components", isDir: true },
        ],
      ],
    ]);
    const tree = buildLazyRepositoryFileTree(loaded);
    expect(tree.map((n) => n.path)).toEqual(["src", "readme.md"]);
    const src = tree.find((n) => n.path === "src");
    expect(src?.children?.map((n) => n.path)).toEqual(["src/components", "src/index.ts"]);
  });
});

describe("patchLazyRepositoryFileTree", () => {
  test("patches only the changed directory branch", () => {
    const rootOnly = new Map<string, RepositoryExplorerEntry[]>([
      ["", [{ path: "src", isDir: true }]],
    ]);
    const tree = buildLazyRepositoryFileTree(rootOnly);
    const src = tree.find((n) => n.path === "src");
    expect(src?.children).toBeUndefined();

    const withSrc = new Map(rootOnly);
    withSrc.set("src", [{ path: "src/index.ts", isDir: false }]);
    const patched = patchLazyRepositoryFileTree(tree, withSrc, "src");
    expect(patched).not.toBe(tree);
    const patchedSrc = patched.find((n) => n.path === "src");
    expect(patchedSrc?.children?.map((n) => n.path)).toEqual(["src/index.ts"]);
  });
});

describe("pruneLoadedChildrenMap", () => {
  test("drops removed directory and descendants", () => {
    const prev = new Map<string, RepositoryExplorerEntry[]>([
      ["", [{ path: "a", isDir: true }]],
      ["a", [{ path: "a/b", isDir: true }]],
      ["a/b", [{ path: "a/b/c.ts", isDir: false }]],
      ["x", [{ path: "x/y.ts", isDir: false }]],
    ]);
    const next = pruneLoadedChildrenMap(prev, "a");
    expect([...next.keys()].sort()).toEqual(["", "x"]);
  });
});
