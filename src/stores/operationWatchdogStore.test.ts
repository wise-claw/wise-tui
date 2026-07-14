import { afterEach, describe, expect, test } from "bun:test";
import {
  beginTrackedOperation,
  dismissStuckOperations,
  endTrackedOperation,
  getStuckOperationsSnapshot,
  getTrackedOperationsSnapshot,
  markTrackedOperationStuckForTests,
  resetOperationWatchdogForTests,
  trackAsyncOperation,
} from "./operationWatchdogStore";

describe("operationWatchdogStore", () => {
  afterEach(() => {
    resetOperationWatchdogForTests();
  });

  test("begin/end tracks in-flight ops", () => {
    const id = beginTrackedOperation("推送");
    expect(getTrackedOperationsSnapshot()).toHaveLength(1);
    expect(getStuckOperationsSnapshot()).toHaveLength(0);
    endTrackedOperation(id);
    expect(getTrackedOperationsSnapshot()).toHaveLength(0);
  });

  test("stuck ops can be dismissed", () => {
    const id = beginTrackedOperation("拉取");
    markTrackedOperationStuckForTests(id);
    expect(getStuckOperationsSnapshot()).toHaveLength(1);
    const cleared = dismissStuckOperations();
    expect(cleared).toHaveLength(1);
    expect(getStuckOperationsSnapshot()).toHaveLength(0);
  });

  test("getStuckOperationsSnapshot returns stable empty reference", () => {
    const a = getStuckOperationsSnapshot();
    const b = getStuckOperationsSnapshot();
    expect(a).toBe(b);
    expect(a).toHaveLength(0);
  });

  test("trackAsyncOperation times out and unregisters", async () => {
    await expect(
      trackAsyncOperation("测试", new Promise<number>(() => {}), 30),
    ).rejects.toThrow("测试超时");
    expect(getTrackedOperationsSnapshot()).toHaveLength(0);
    expect(getStuckOperationsSnapshot()).toBe(getStuckOperationsSnapshot());
  });
});
