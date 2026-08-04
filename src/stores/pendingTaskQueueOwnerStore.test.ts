import { describe, expect, test, beforeEach } from "bun:test";
import {
  claimPendingTaskQueueOwner,
  hasPendingTaskQueueOwner,
  resetPendingTaskQueueOwnerStoreForTests,
} from "./pendingTaskQueueOwnerStore";

describe("pendingTaskQueueOwnerStore", () => {
  beforeEach(() => {
    resetPendingTaskQueueOwnerStoreForTests();
  });

  test("claim / release refcount", () => {
    expect(hasPendingTaskQueueOwner("s1")).toBe(false);
    const a = claimPendingTaskQueueOwner("s1");
    const b = claimPendingTaskQueueOwner("s1");
    expect(hasPendingTaskQueueOwner("s1")).toBe(true);
    a();
    expect(hasPendingTaskQueueOwner("s1")).toBe(true);
    b();
    expect(hasPendingTaskQueueOwner("s1")).toBe(false);
  });
});
