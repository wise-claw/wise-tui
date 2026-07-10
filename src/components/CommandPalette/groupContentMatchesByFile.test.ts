import { describe, expect, test } from "bun:test";
import {
  countContentFileGroupHits,
  groupContentMatchesByFile,
} from "./groupContentMatchesByFile";

describe("groupContentMatchesByFile", () => {
  test("空数组返回空", () => {
    expect(groupContentMatchesByFile([])).toEqual([]);
  });

  test("单文件单匹配", () => {
    expect(
      groupContentMatchesByFile([
        { path: "src/a.ts", line: 3, preview: "const index = 1", matchStart: 6, matchEnd: 11 },
      ]),
    ).toEqual([
      {
        kind: "content-file",
        path: "src/a.ts",
        hits: [{ line: 3, preview: "const index = 1", matchStart: 6, matchEnd: 11 }],
      },
    ]);
  });

  test("同文件多处匹配合并为一组并按行号排序", () => {
    const groups = groupContentMatchesByFile([
      { path: "a.ts", line: 10, preview: "index ten" },
      { path: "b.ts", line: 1, preview: "other" },
      { path: "a.ts", line: 2, preview: "index two" },
      { path: "a.ts", line: 5, preview: "index five" },
    ]);
    expect(groups.map((g) => g.path)).toEqual(["a.ts", "b.ts"]);
    expect(groups[0]?.hits.map((h) => h.line)).toEqual([2, 5, 10]);
    expect(groups[1]?.hits.map((h) => h.line)).toEqual([1]);
  });

  test("countContentFileGroupHits 统计总匹配数", () => {
    const groups = groupContentMatchesByFile([
      { path: "a.ts", line: 1, preview: "x" },
      { path: "a.ts", line: 2, preview: "y" },
      { path: "b.ts", line: 3, preview: "z" },
    ]);
    expect(countContentFileGroupHits(groups)).toBe(3);
  });
});
