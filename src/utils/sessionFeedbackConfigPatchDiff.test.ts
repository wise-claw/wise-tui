import { describe, expect, test } from "bun:test";
import {
  buildPatchDiffLines,
  computePatchDiffStats,
  formatPatchDiffStats,
} from "./sessionFeedbackConfigPatchDiff";

describe("sessionFeedbackConfigPatchDiff", () => {
  test("counts added and removed lines", () => {
    const stats = computePatchDiffStats("a\nb\n", "a\nc\n");
    expect(stats.removedLines).toBe(1);
    expect(stats.addedLines).toBe(1);
    expect(formatPatchDiffStats(stats)).toContain("+1");
  });

  test("buildPatchDiffLines marks changes", () => {
    const lines = buildPatchDiffLines("old", "new");
    expect(lines.some((l) => l.kind === "remove")).toBe(true);
    expect(lines.some((l) => l.kind === "add")).toBe(true);
  });
});
