import { describe, expect, test } from "bun:test";
import {
  getExecutionEnvironmentDispatchesSnapshot,
  getExecutionEnvironmentDispatchesSnapshotForAnchor,
  registerExecutionEnvironmentBatch,
  resetExecutionEnvironmentDispatchStore,
} from "./executionEnvironmentDispatchStore";

describe("executionEnvironmentDispatchStore memory bounds", () => {
  test("evicts dropped batch records when anchor exceeds MAX_BATCHES_PER_ANCHOR", () => {
    resetExecutionEnvironmentDispatchStore();
    const anchor = "anchor-session-1";
    for (let i = 0; i < 41; i += 1) {
      registerExecutionEnvironmentBatch({
        batchId: `batch-${i}`,
        anchorSessionId: anchor,
        repositoryPath: "/tmp/repo",
        executionEngine: "claude",
        sessionCount: 1,
        previewText: `batch ${i}`,
        createdAt: i,
      });
    }

    const anchorSnapshot = getExecutionEnvironmentDispatchesSnapshotForAnchor(anchor);
    expect(anchorSnapshot).toHaveLength(40);
    expect(anchorSnapshot[0]?.batchId).toBe("batch-40");
    expect(anchorSnapshot[39]?.batchId).toBe("batch-1");
    expect(getExecutionEnvironmentDispatchesSnapshot()).toHaveLength(40);
    expect(getExecutionEnvironmentDispatchesSnapshot().some((row) => row.batchId === "batch-0")).toBe(false);
  });
});
