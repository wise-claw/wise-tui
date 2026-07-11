import { describe, expect, test } from "bun:test";
import {
  commitWorkspaceTodoCountsSnapshotForTests,
  getWorkspaceTodoCountsSnapshot,
  subscribeWorkspaceTodoCounts,
} from "./workspaceTodoCountsStore";

describe("workspaceTodoCountsStore", () => {
  test("global count notifies subscribers on change", () => {
    commitWorkspaceTodoCountsSnapshotForTests(0);
    let revision = 0;
    const unsub = subscribeWorkspaceTodoCounts(() => {
      revision += 1;
    });

    commitWorkspaceTodoCountsSnapshotForTests(3);
    expect(getWorkspaceTodoCountsSnapshot()).toBe(3);
    expect(revision).toBe(1);

    // 同值不通知
    commitWorkspaceTodoCountsSnapshotForTests(3);
    expect(revision).toBe(1);

    commitWorkspaceTodoCountsSnapshotForTests(0);
    expect(getWorkspaceTodoCountsSnapshot()).toBe(0);
    expect(revision).toBe(2);

    unsub();
  });
});
