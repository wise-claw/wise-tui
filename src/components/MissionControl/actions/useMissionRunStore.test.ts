import { describe, expect, test } from "bun:test";
import { reduceBackgroundRuns, type ActivePrdRunRow } from "./useMissionRunStore";

function row(overrides: Partial<ActivePrdRunRow> = {}): ActivePrdRunRow {
  return {
    runId: "run-1",
    clusterId: "cluster-fe",
    runDir: "/tmp/run-1",
    startedAtMs: 100,
    status: "running",
    exitCode: null,
    stdoutTail: "",
    stderrTail: "",
    hasRunResult: false,
    projectRootPath: "/repo",
    missionId: null,
    parentTaskPath: ".trellis/tasks/parent",
    stdoutPath: "/tmp/run-1/claude.stdout.log",
    stderrPath: "/tmp/run-1/claude.stderr.log",
    rawResultPath: "/tmp/run-1/split-result.raw.json",
    error: null,
    ...overrides,
  };
}

describe("useMissionRunStore", () => {
  test("reduces active PRD run rows by run id and preserves retry evidence paths", () => {
    const runs = reduceBackgroundRuns([
      row(),
      row({
        runId: "run-2",
        status: "failed",
        exitCode: 1,
        hasRunResult: false,
        error: "No run-result.json after 90s",
      }),
    ]);

    expect(Object.keys(runs)).toEqual(["run-1", "run-2"]);
    expect(runs["run-1"]).toMatchObject({
      clusterId: "cluster-fe",
      status: "running",
      startedAtMs: 100,
      hasRunResult: false,
      stdoutPath: "/tmp/run-1/claude.stdout.log",
    });
    expect(runs["run-2"]).toMatchObject({
      status: "failed",
      exitCode: 1,
      error: "No run-result.json after 90s",
      rawResultPath: "/tmp/run-1/split-result.raw.json",
    });
  });

  test("drops rows without a run id or cluster id", () => {
    const runs = reduceBackgroundRuns([
      row({ runId: "" }),
      row({ clusterId: "" }),
      row({ runId: "run-ok", clusterId: "cluster-ok" }),
    ]);

    expect(Object.keys(runs)).toEqual(["run-ok"]);
    expect(runs["run-ok"].clusterId).toBe("cluster-ok");
  });

  test("preserves cancelled runs for retry and evidence recovery", () => {
    const runs = reduceBackgroundRuns([
      row({
        status: "cancelled",
        exitCode: 130,
        hasRunResult: true,
        error: "PRD split run cancelled by user",
      }),
    ]);

    expect(runs["run-1"]).toMatchObject({
      status: "cancelled",
      exitCode: 130,
      hasRunResult: true,
      error: "PRD split run cancelled by user",
    });
  });
});
