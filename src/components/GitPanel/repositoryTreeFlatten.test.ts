import { describe, expect, test } from "bun:test";
import { flattenRepositoryTreeRows } from "./repositoryTreeFlatten";
import type { RepositoryFileTreeNode } from "./types";

describe("flattenRepositoryTreeRows", () => {
  test("includes only expanded directory descendants", () => {
    const nodes: RepositoryFileTreeNode[] = [
      {
        name: "src",
        path: "src",
        isDir: true,
        children: [
          { name: "a.ts", path: "src/a.ts", isDir: false },
          {
            name: "lib",
            path: "src/lib",
            isDir: true,
            children: [{ name: "b.ts", path: "src/lib/b.ts", isDir: false }],
          },
        ],
      },
      { name: "README.md", path: "README.md", isDir: false },
    ];

    const rows = flattenRepositoryTreeRows({
      nodes,
      expandedDirs: new Set(["src"]),
      loadingDirKeys: new Set(),
      inlineCreate: null,
    });

    expect(rows.map((row) => row.kind)).toEqual(["dir", "file", "dir", "file"]);
    expect(rows.find((row) => row.kind === "file" && row.node.path === "src/lib/b.ts")).toBeUndefined();
  });

  test("emits loading and inline-create rows under expanded parent", () => {
    const nodes: RepositoryFileTreeNode[] = [
      { name: "pkg", path: "pkg", isDir: true, children: undefined },
    ];

    const rows = flattenRepositoryTreeRows({
      nodes,
      expandedDirs: new Set(["pkg"]),
      loadingDirKeys: new Set(["pkg"]),
      inlineCreate: { type: "file", parentDir: "pkg", value: "new.ts" },
    });

    expect(rows.map((row) => row.kind)).toEqual(["dir", "loading", "inline-create"]);
  });
});
