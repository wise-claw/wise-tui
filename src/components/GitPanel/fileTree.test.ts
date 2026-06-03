import { describe, expect, test } from "bun:test";
import {
  buildExplorerEntryIndex,
  buildRepositoryFileTree,
  sliceExplorerEntriesForSearch,
} from "./fileTree";
import type { RepositoryExplorerEntry } from "../../services/repositoryFiles";

function entries(paths: Array<[string, boolean]>): RepositoryExplorerEntry[] {
  return paths.map(([path, isDir]) => ({ path, isDir }));
}

describe("buildExplorerEntryIndex", () => {
  test("indexes paths for lookup", () => {
    const all = entries([["src/index.ts", false]]);
    const index = buildExplorerEntryIndex(all);
    expect(index.byPath.get("src/index.ts")?.isDir).toBe(false);
    expect(index.rows[0]?.nameLower).toBe("index.ts");
  });
});

describe("sliceExplorerEntriesForSearch", () => {
  test("returns empty rows when query is empty", () => {
    const index = buildExplorerEntryIndex(entries([["src/index.ts", false]]));
    const slice = sliceExplorerEntriesForSearch(index, "");
    expect(slice.rows.length).toBe(0);
    expect(slice.tooShort).toBe(false);
  });

  test("marks single-character query as too short", () => {
    const index = buildExplorerEntryIndex(entries([["src/home.ts", false]]));
    const slice = sliceExplorerEntriesForSearch(index, "h");
    expect(slice.tooShort).toBe(true);
    expect(slice.rows.length).toBe(0);
  });

  test("ranks basename matches and builds tree from kept paths", () => {
    const all = entries([
      ["src", true],
      ["src/api", true],
      ["src/api/mes", true],
      ["src/api/mes/home", true],
      ["src/api/mes/home/index.ts", false],
      ["src/api/wms", true],
      ["src/api/wms/home", true],
      ["src/api/wms/home/index.ts", false],
      ["src/views", true],
      ["src/views/erp", true],
      ["src/views/erp/home", true],
      ["src/other.ts", false],
    ]);
    const index = buildExplorerEntryIndex(all);
    const slice = sliceExplorerEntriesForSearch(index, "home");
    expect(slice.truncated).toBe(false);
    expect(slice.rows.some((r) => r.path === "src/api/mes/home/index.ts")).toBe(true);
    expect(slice.rows.some((r) => r.path === "src/other.ts")).toBe(false);
    expect(slice.rows[0]?.score).toBeLessThanOrEqual(slice.rows.at(-1)?.score ?? 99);

    const paths = new Set(slice.rows.map((r) => r.path));
    const subset = all.filter((e) => paths.has(e.path));
    const tree = buildRepositoryFileTree(subset);
    const collectHomeDirs = (nodes: ReturnType<typeof buildRepositoryFileTree>): string[] =>
      nodes.flatMap((n) => [
        ...(n.isDir && n.name === "home" ? [n.path] : []),
        ...(n.children ? collectHomeDirs(n.children) : []),
      ]);
    expect(collectHomeDirs(tree).length).toBeGreaterThan(0);
  });
});
