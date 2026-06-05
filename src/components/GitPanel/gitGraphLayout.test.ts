import { describe, expect, test } from "bun:test";
import {
  buildGitGraphEdgePath,
  computeGitGraphLayout,
  resolveGitGraphDisplayWidthPx,
  resolveGitGraphLaneWidthPx,
} from "./gitGraphLayout";

describe("computeGitGraphLayout", () => {
  test("keeps linear history on one lane", () => {
    const layout = computeGitGraphLayout([
      { sha: "c", parentShas: ["b"] },
      { sha: "b", parentShas: ["a"] },
      { sha: "a", parentShas: [] },
    ]);

    expect(layout.laneColumns).toBe(1);
    expect(layout.rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(layout.edges).toHaveLength(2);
  });

  test("forks lanes for merge parents and merges back at shared base", () => {
    const layout = computeGitGraphLayout([
      { sha: "merge", parentShas: ["feature", "main"] },
      { sha: "feature", parentShas: ["base"] },
      { sha: "main", parentShas: ["base"] },
      { sha: "base", parentShas: [] },
    ]);

    expect(layout.rows[0]?.lane).toBe(0);
    expect(layout.rows[0]?.parentLanes.length).toBe(2);
    expect(layout.laneColumns).toBe(2);
    expect(layout.rows.find((row) => row.sha === "base")?.lane).toBe(0);
    expect(layout.edges.some((edge) => edge.fromLane !== edge.toLane)).toBe(true);
  });

  test("merge edges originate from commit dot lane", () => {
    const layout = computeGitGraphLayout([
      { sha: "merge", parentShas: ["feature", "main"] },
      { sha: "feature", parentShas: ["base"] },
      { sha: "main", parentShas: ["base"] },
      { sha: "base", parentShas: [] },
    ]);
    const mergeRow = layout.rows.find((row) => row.sha === "merge");
    const mergeEdges = layout.edges.filter((edge) => edge.fromSha === "merge");
    expect(mergeEdges.length).toBe(2);
    expect(mergeEdges.every((edge) => edge.fromLane === mergeRow?.lane)).toBe(true);
  });

  test("does not keep ghost lanes for parents outside loaded range", () => {
    const layout = computeGitGraphLayout([
      { sha: "tip-a", parentShas: ["missing"] },
      { sha: "tip-b", parentShas: ["missing"] },
      { sha: "tip-c", parentShas: ["missing"] },
    ]);

    expect(layout.laneColumns).toBe(1);
  });

  test("long linear history stays on one lane", () => {
    const commits = Array.from({ length: 10 }, (_, index) => {
      const id = 9 - index;
      return {
        sha: `c${id}`,
        parentShas: id > 0 ? [`c${id - 1}`] : [],
      };
    });
    const layout = computeGitGraphLayout(commits);

    expect(layout.laneColumns).toBe(1);
    expect(layout.rows.every((row) => row.lane === 0)).toBe(true);
  });
});

describe("resolveGitGraphDisplayMetrics", () => {
  test("keeps default lane width for small histories", () => {
    expect(resolveGitGraphLaneWidthPx(3)).toBe(14);
    expect(resolveGitGraphDisplayWidthPx(3)).toBe(42);
  });

  test("caps total width and compresses lanes for busy histories", () => {
    expect(resolveGitGraphDisplayWidthPx(20)).toBe(112);
    expect(resolveGitGraphLaneWidthPx(20)).toBeCloseTo(5.6);
  });
});

describe("buildGitGraphEdgePath", () => {
  test("draws straight line when lanes match", () => {
    expect(buildGitGraphEdgePath(0, 0, 1, 0)).toBe("M 7 20 L 7 60");
  });

  test("draws smooth bezier when lanes differ", () => {
    const path = buildGitGraphEdgePath(0, 0, 1, 1);
    expect(path).toBe("M 7 20 C 7 40, 21 40, 21 60");
  });
});
