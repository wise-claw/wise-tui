import { describe, expect, test } from "bun:test";
import type { WorkspaceRequirementItem } from "../types/workspaceRequirements";
import {
  AUTO_DISPATCH_MAX_PER_SWEEP,
  autoDispatchAvailableSlots,
  isRequirementAutoDispatchEligible,
  planAutoDispatchSweep,
  selectAutoDispatchTargets,
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
});
