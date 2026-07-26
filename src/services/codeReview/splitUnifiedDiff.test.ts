import { describe, expect, test } from "bun:test";
import {
  filterUnifiedDiffToFiles,
  fingerprintUnifiedDiffFiles,
  resolveIncrementalFocusFiles,
  splitUnifiedDiff,
} from "./splitUnifiedDiff";

const SAMPLE = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "diff --git a/src/b.ts b/src/b.ts",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -1 +1 @@",
  "-x",
  "+y",
  "",
].join("\n");

describe("splitUnifiedDiff", () => {
  test("splits multi-file diff", () => {
    const chunks = splitUnifiedDiff(SAMPLE);
    expect(chunks.map((chunk) => chunk.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(chunks[0]?.text).toContain("diff --git a/src/a.ts");
    expect(chunks[0]?.text).not.toContain("src/b.ts");
  });

  test("filters to selected files", () => {
    const filtered = filterUnifiedDiffToFiles(SAMPLE, ["src/b.ts"]);
    expect(filtered).toContain("src/b.ts");
    expect(filtered).not.toContain("src/a.ts");
  });

  test("fingerprints differ per file content", () => {
    const fps = fingerprintUnifiedDiffFiles(SAMPLE);
    expect(fps["src/a.ts"]).toBeTruthy();
    expect(fps["src/b.ts"]).toBeTruthy();
    expect(fps["src/a.ts"]).not.toBe(fps["src/b.ts"]);
  });

  test("resolve focus when one file changes", () => {
    const current = fingerprintUnifiedDiffFiles(SAMPLE);
    const previous = {
      ...current,
      "src/a.ts": "cff1:deadbeef",
    };
    const { focusFiles, unchangedFiles } = resolveIncrementalFocusFiles({
      currentFingerprints: current,
      previousFingerprints: previous,
      currentPaths: ["src/a.ts", "src/b.ts"],
    });
    expect(focusFiles).toEqual(["src/a.ts"]);
    expect(unchangedFiles).toEqual(["src/b.ts"]);
  });
});
