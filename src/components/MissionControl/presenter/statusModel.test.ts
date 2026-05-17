import { describe, expect, test } from "bun:test";
import type { ClusterRunState } from "../../PrdSplitWizard/types";
import { toUserStatus } from "./statusModel";

function run(status: ClusterRunState["status"]): ClusterRunState {
  return {
    clusterId: "c-a",
    parentTaskName: null,
    parentTaskPath: null,
    status,
    errors: [],
  };
}

describe("toUserStatus", () => {
  test("maps idle to queued", () => {
    expect(toUserStatus({ run: run("idle") })).toBe("queued");
  });

  test("maps parent creation to preparing", () => {
    expect(toUserStatus({ run: run("creating-parent") })).toBe("preparing");
  });

  test("maps dispatching to running", () => {
    expect(toUserStatus({ run: run("dispatching") })).toBe("running");
  });

  test("maps successful and skipped runs to completed", () => {
    expect(toUserStatus({ run: run("succeeded") })).toBe("completed");
    expect(toUserStatus({ run: run("skipped-clean") })).toBe("completed");
  });

  test("maps failed, validation issues, and write errors to blocked", () => {
    expect(toUserStatus({ run: run("failed") })).toBe("blocked");
    expect(toUserStatus({ run: run("succeeded"), validationIssueCount: 1 })).toBe("blocked");
    expect(toUserStatus({ run: run("succeeded"), writeResult: { clusterId: "c-a", parentTaskName: "p", childTaskNames: [], childTasks: [], warnings: [], error: "x" } })).toBe("blocked");
  });

  test("maps cancelled runs to cancelled", () => {
    expect(toUserStatus({ run: run("cancelled") })).toBe("cancelled");
  });

  test("maps stale runs to stale", () => {
    expect(toUserStatus({ run: run("stale") })).toBe("stale");
  });
});
