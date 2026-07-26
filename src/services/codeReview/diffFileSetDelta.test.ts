import { describe, expect, test } from "bun:test";
import {
  describeCodeReviewIncremental,
  diffCodeReviewFileSets,
  inferCodeReviewRunFilePaths,
} from "./diffFileSetDelta";

describe("diffCodeReviewFileSets", () => {
  test("computes added removed retained", () => {
    const delta = diffCodeReviewFileSets(["a.ts", "b.ts"], ["b.ts", "c.ts"], {
      patchChanged: true,
    });
    expect(delta.added).toEqual(["c.ts"]);
    expect(delta.removed).toEqual(["a.ts"]);
    expect(delta.retained).toEqual(["b.ts"]);
    expect(delta.patchChanged).toBe(true);
  });

  test("describe covers content-only change", () => {
    const delta = diffCodeReviewFileSets(["a.ts"], ["a.ts"], { patchChanged: true });
    expect(describeCodeReviewIncremental(delta)).toBe("文件集相同，patch 内容已变");
  });
});

describe("inferCodeReviewRunFilePaths", () => {
  test("prefers filePaths then findings", () => {
    expect(
      inferCodeReviewRunFilePaths({
        filePaths: ["src/a.ts"],
        findings: [{ path: "src/b.ts" }],
      }),
    ).toEqual(["src/a.ts"]);
    expect(
      inferCodeReviewRunFilePaths({
        findings: [{ path: "src/b.ts" }, { path: "src/a.ts" }],
      }),
    ).toEqual(["src/a.ts", "src/b.ts"]);
  });
});
