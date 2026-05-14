import { describe, expect, test } from "bun:test";
import { buildHighlightSegments } from "./clusterPrdSlice";

describe("buildHighlightSegments", () => {
  test("returns the whole text when no ranges", () => {
    const segs = buildHighlightSegments("Hello", []);
    expect(segs).toEqual([{ text: "Hello", taskIds: [] }]);
  });

  test("returns empty array when text empty", () => {
    expect(buildHighlightSegments("", [{ from: 0, to: 1, taskId: "t1" }])).toEqual([]);
  });

  test("splits at single range boundary", () => {
    const segs = buildHighlightSegments("Hello world", [
      { from: 6, to: 11, taskId: "t1" },
    ]);
    expect(segs).toEqual([
      { text: "Hello ", taskIds: [] },
      { text: "world", taskIds: ["t1"] },
    ]);
  });

  test("merges overlapping ranges into combined hits", () => {
    const segs = buildHighlightSegments("abcdefghij", [
      { from: 1, to: 5, taskId: "t1" },
      { from: 3, to: 7, taskId: "t2" },
    ]);
    expect(segs).toEqual([
      { text: "a", taskIds: [] },
      { text: "bc", taskIds: ["t1"] },
      { text: "de", taskIds: ["t1", "t2"] },
      { text: "fg", taskIds: ["t2"] },
      { text: "hij", taskIds: [] },
    ]);
  });

  test("clamps ranges to text bounds", () => {
    const segs = buildHighlightSegments("hi", [
      { from: -5, to: 100, taskId: "t1" },
    ]);
    expect(segs).toEqual([{ text: "hi", taskIds: ["t1"] }]);
  });

  test("ignores zero-length ranges", () => {
    const segs = buildHighlightSegments("abc", [
      { from: 1, to: 1, taskId: "t1" },
    ]);
    expect(segs).toEqual([{ text: "abc", taskIds: [] }]);
  });
});
