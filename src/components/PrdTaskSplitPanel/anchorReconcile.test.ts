import { describe, expect, test } from "bun:test";
import type { SplitResult } from "../../types";
import { reconcileResolvedAnchorRanges } from "./anchorReconcile";

function makeResult(overrides: Partial<SplitResult> = {}): SplitResult {
  return {
    splitTasks: [
      { id: "t1", title: "t1", description: "", role: "fullstack", size: "M" },
      { id: "t2", title: "t2", description: "", role: "fullstack", size: "M" },
    ],
    requirements: [],
    splitContext: { rawInput: "", normalizedSections: [] },
    ...overrides,
  } as unknown as SplitResult;
}

describe("reconcileResolvedAnchorRanges", () => {
  test("returns null when no ranges resolve to known task ids", () => {
    const prev = makeResult();
    expect(reconcileResolvedAnchorRanges(prev, { unknownTask: { from: 0, to: 5 } })).toBeNull();
  });

  test("drops non-finite or zero-width ranges", () => {
    const prev = makeResult();
    expect(
      reconcileResolvedAnchorRanges(prev, {
        t1: { from: Number.NaN, to: 5 },
        t2: { from: 5, to: 5 },
      }),
    ).toBeNull();
  });

  test("floors fractional offsets to integers", () => {
    const prev = makeResult();
    const merged = reconcileResolvedAnchorRanges(prev, {
      t1: { from: 1.9, to: 5.4 },
    });
    expect(merged?.taskAnchorPositions?.t1).toEqual({ from: 1, to: 5 });
  });

  test("merges incrementally instead of erasing prior positions", () => {
    const prev = makeResult({
      taskAnchorPositions: { t1: { from: 0, to: 10 } },
    });
    const merged = reconcileResolvedAnchorRanges(prev, { t2: { from: 20, to: 30 } });
    expect(merged?.taskAnchorPositions).toEqual({
      t1: { from: 0, to: 10 },
      t2: { from: 20, to: 30 },
    });
  });

  test("drops positions whose taskId is no longer in splitTasks", () => {
    const prev = makeResult({
      taskAnchorPositions: { t1: { from: 0, to: 10 }, removed: { from: 1, to: 2 } },
    });
    const merged = reconcileResolvedAnchorRanges(prev, { t2: { from: 20, to: 30 } });
    expect(merged?.taskAnchorPositions).toEqual({
      t1: { from: 0, to: 10 },
      t2: { from: 20, to: 30 },
    });
  });

  test("returns null when merged positions match existing positions", () => {
    const prev = makeResult({
      taskAnchorPositions: { t1: { from: 0, to: 10 } },
    });
    expect(reconcileResolvedAnchorRanges(prev, { t1: { from: 0, to: 10 } })).toBeNull();
  });
});
