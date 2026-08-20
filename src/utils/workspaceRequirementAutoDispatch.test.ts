import { describe, expect, test } from "bun:test";
import type { WorkspaceRequirementItem } from "../types/workspaceRequirements";
import {
  AUTO_DISPATCH_MAX_PER_SWEEP,
  AUTO_DISPATCH_MAX_RETRY_ATTEMPTS,
  autoDispatchAvailableSlots,
  isRequirementAutoDispatchEligible,
  isRequirementAutoDispatchRetryEligible,
  planAutoDispatchSweep,
  planAutoDispatchSweepWithRetry,
  selectAutoDispatchTargets,
  selectAutoDispatchRetryTargets,
} from "./workspaceRequirementAutoDispatch";

function item(
  partial: Partial<WorkspaceRequirementItem> & Pick<WorkspaceRequirementItem, "id">,
): WorkspaceRequirementItem {
  return {
    title: "需求",
    bodyMarkdown: "需求",
    imagePaths: [],
    status: "open",
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 1,
    lastDispatchedAt: null,
    dispatchAttemptCount: 0,
    executionSessionIds: [],
    repositoryId: null,
    ...partial,
  };
}

describe("workspaceRequirementAutoDispatch", () => {
  test("isRequirementAutoDispatchEligible accepts new open items", () => {
    expect(isRequirementAutoDispatchEligible(item({ id: "a" }))).toBe(true);
  });

  test("isRequirementAutoDispatchEligible rejects done items", () => {
    expect(
      isRequirementAutoDispatchEligible(
        item({ id: "a", status: "done", lastDispatchedAt: null }),
      ),
    ).toBe(false);
  });

  test("isRequirementAutoDispatchEligible rejects verifying items", () => {
    expect(
      isRequirementAutoDispatchEligible(
        item({ id: "a", status: "verifying", lastDispatchedAt: Date.now() }),
      ),
    ).toBe(false);
  });

  test("isRequirementAutoDispatchEligible re-dispatches edited items", () => {
    expect(
      isRequirementAutoDispatchEligible(
        item({ id: "a", updatedAt: 200, lastDispatchedAt: 100 }),
      ),
    ).toBe(true);
  });

  test("isRequirementAutoDispatchEligible skips already-dispatched unchanged items", () => {
    expect(
      isRequirementAutoDispatchEligible(
        item({ id: "a", updatedAt: 100, lastDispatchedAt: 100 }),
      ),
    ).toBe(false);
  });

  test("autoDispatchAvailableSlots fills the gap up to concurrency", () => {
    expect(autoDispatchAvailableSlots(2, 0)).toBe(2);
    expect(autoDispatchAvailableSlots(2, 1)).toBe(1);
    expect(autoDispatchAvailableSlots(2, 2)).toBe(0);
    expect(autoDispatchAvailableSlots(2, 5)).toBe(0);
  });

  test("autoDispatchAvailableSlots clamps negative input", () => {
    expect(autoDispatchAvailableSlots(-1, 0)).toBe(0);
    expect(autoDispatchAvailableSlots(3, -2)).toBe(3);
  });

  test("selectAutoDispatchTargets caps per sweep and picks oldest first", () => {
    const targets = selectAutoDispatchTargets(
      [
        item({ id: "new", updatedAt: 300 }),
        item({ id: "edited", updatedAt: 200, lastDispatchedAt: 100 }),
        item({ id: "fresh", updatedAt: 100 }),
        item({ id: "done", status: "done", updatedAt: 50 }),
        item({ id: "sent", updatedAt: 100, lastDispatchedAt: 100 }),
      ],
      2,
    );
    expect(targets.map((t) => t.id)).toEqual(["fresh", "edited"]);
  });

  test("selectAutoDispatchTargets default limit is AUTO_DISPATCH_MAX_PER_SWEEP", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      item({ id: `r${i}`, updatedAt: i }),
    );
    expect(selectAutoDispatchTargets(items)).toHaveLength(AUTO_DISPATCH_MAX_PER_SWEEP);
  });

  test("planAutoDispatchSweep caps by per-sweep limit even with huge concurrency", () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      item({ id: `r${i}`, updatedAt: i }),
    );
    const targets = planAutoDispatchSweep(99, 0, items);
    expect(targets).toHaveLength(AUTO_DISPATCH_MAX_PER_SWEEP);
  });

  test("planAutoDispatchSweep respects the smaller of slots and per-sweep limit", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      item({ id: `r${i}`, updatedAt: i }),
    );
    expect(planAutoDispatchSweep(2, 1, items)).toHaveLength(1);
    expect(planAutoDispatchSweep(2, 2, items)).toHaveLength(0);
    expect(planAutoDispatchSweep(4, 0, items)).toHaveLength(AUTO_DISPATCH_MAX_PER_SWEEP);
  });

  test("isRequirementAutoDispatchRetryEligible requires dispatched open item", () => {
    const running = new Set<string>();
    expect(
      isRequirementAutoDispatchRetryEligible(
        item({ id: "a", lastDispatchedAt: 100 }),
        running,
      ),
    ).toBe(true);
    expect(isRequirementAutoDispatchRetryEligible(item({ id: "a" }), running)).toBe(false);
    expect(
      isRequirementAutoDispatchRetryEligible(
        item({ id: "a", status: "done", lastDispatchedAt: 100 }),
        running,
      ),
    ).toBe(false);
    expect(
      isRequirementAutoDispatchRetryEligible(
        item({ id: "a", status: "verifying", lastDispatchedAt: 100 }),
        running,
      ),
    ).toBe(false);
  });

  test("isRequirementAutoDispatchRetryEligible skips items with a running session", () => {
    expect(
      isRequirementAutoDispatchRetryEligible(
        item({ id: "a", lastDispatchedAt: 100 }),
        new Set(["a"]),
      ),
    ).toBe(false);
  });

  test("isRequirementAutoDispatchRetryEligible skips edited (eligible) items", () => {
    expect(
      isRequirementAutoDispatchRetryEligible(
        item({ id: "a", updatedAt: 200, lastDispatchedAt: 100 }),
        new Set(),
      ),
    ).toBe(false);
  });

  test("isRequirementAutoDispatchRetryEligible caps at max retry attempts", () => {
    expect(
      isRequirementAutoDispatchRetryEligible(
        item({ id: "a", lastDispatchedAt: 100, dispatchAttemptCount: 2 }),
        new Set(),
      ),
    ).toBe(true);
    expect(
      isRequirementAutoDispatchRetryEligible(
        item({ id: "a", lastDispatchedAt: 100, dispatchAttemptCount: 3 }),
        new Set(),
      ),
    ).toBe(false);
    expect(AUTO_DISPATCH_MAX_RETRY_ATTEMPTS).toBe(3);
  });

  test("selectAutoDispatchRetryTargets picks oldest dispatched without running session", () => {
    const targets = selectAutoDispatchRetryTargets(
      [
        item({ id: "new", updatedAt: 100 }),
        item({ id: "running", lastDispatchedAt: 100 }),
        item({ id: "old", lastDispatchedAt: 50 }),
        item({ id: "exhausted", lastDispatchedAt: 200, dispatchAttemptCount: 3 }),
        item({ id: "sent", lastDispatchedAt: 150 }),
      ],
      new Set(["running"]),
      2,
    );
    expect(targets.map((t) => t.id)).toEqual(["old", "sent"]);
  });

  test("planAutoDispatchSweepWithRetry prefers eligible targets over retry", () => {
    const items = [item({ id: "dispatched", lastDispatchedAt: 100 })];
    const withEligible = [
      item({ id: "fresh", updatedAt: 100 }),
      item({ id: "dispatched", lastDispatchedAt: 100 }),
    ];
    expect(
      planAutoDispatchSweepWithRetry(4, 0, new Set(), withEligible).map((t) => t.id),
    ).toEqual(["fresh"]);
    expect(planAutoDispatchSweepWithRetry(4, 0, new Set(), items).map((t) => t.id)).toEqual([
      "dispatched",
    ]);
  });

  test("planAutoDispatchSweepWithRetry respects running sessions and slots", () => {
    const items = [
      item({ id: "old", lastDispatchedAt: 50 }),
      item({ id: "sent", lastDispatchedAt: 150 }),
    ];
    expect(
      planAutoDispatchSweepWithRetry(2, 0, new Set(["sent"]), items).map((t) => t.id),
    ).toEqual(["old"]);
    expect(planAutoDispatchSweepWithRetry(2, 2, new Set(), items)).toEqual([]);
  });

  test("planAutoDispatchSweepWithRetry stops retrying at max attempts", () => {
    const items = [
      item({ id: "a", lastDispatchedAt: 100, dispatchAttemptCount: 3 }),
      item({ id: "b", lastDispatchedAt: 200, dispatchAttemptCount: 2 }),
    ];
    expect(planAutoDispatchSweepWithRetry(4, 0, new Set(), items).map((t) => t.id)).toEqual([
      "b",
    ]);
  });
});
