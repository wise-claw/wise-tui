import { describe, expect, test } from "bun:test";
import {
  MAX_RESTORED_EXPLORER_EXPANDED_DIRS,
  sanitizeExplorerExpandedDirsForRestore,
} from "./repositoryExplorerSession";

describe("sanitizeExplorerExpandedDirsForRestore", () => {
  test("drops unsafe paths", () => {
    const out = sanitizeExplorerExpandedDirsForRestore(
      new Set(["src", "../etc", "/abs", "ok/deep"]),
    );
    expect(out.has("src")).toBe(true);
    expect(out.has("ok/deep")).toBe(true);
    expect(out.has("../etc")).toBe(false);
    expect(out.has("/abs")).toBe(false);
  });

  test("caps count preferring shallow paths", () => {
    const many = new Set<string>();
    for (let i = 0; i < 60; i += 1) {
      many.add(`d${i}/${"x".repeat(i)}`);
    }
    const out = sanitizeExplorerExpandedDirsForRestore(many);
    expect(out.size).toBe(MAX_RESTORED_EXPLORER_EXPANDED_DIRS);
    const keptMaxLen = Math.max(...[...out].map((p) => p.length));
    const dropped = [...many].filter((p) => !out.has(p));
    const droppedMinLen = dropped.length > 0 ? Math.min(...dropped.map((p) => p.length)) : Infinity;
    expect(keptMaxLen).toBeLessThanOrEqual(droppedMinLen);
  });
});
