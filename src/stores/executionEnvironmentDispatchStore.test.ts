import { describe, expect, test } from "bun:test";
import {
  getExecutionEnvironmentDispatchesSnapshot,
  getExecutionEnvironmentDispatchesSnapshotForAnchor,
  mergeExecutionEnvironmentDispatchesForAnchor,
  registerExecutionEnvironmentBatch,
  resetExecutionEnvironmentDispatchStore,
  upsertExecutionEnvironmentDispatchItem,
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

describe("executionEnvironmentDispatchStore rehydrated placeholder pruning", () => {
  function placeholderRecord(anchor: string, batchId: string) {
    return {
      batchId,
      anchorSessionId: anchor,
      repositoryPath: "/tmp/repo",
      executionEngine: "claude" as const,
      createdAt: 100,
      items: [
        {
          key: `exec-env:${batchId}:rehydrated`,
          batchId,
          anchorSessionId: anchor,
          workerSessionId: `rehydrated:${batchId}`,
          label: "任务",
          previewText: "已派发任务",
          batchIndex: 1,
          sessionCount: 1,
          updatedAt: 100,
        },
      ],
    };
  }

  function itemsOf(anchor: string, batchId: string) {
    const snap = getExecutionEnvironmentDispatchesSnapshotForAnchor(anchor);
    return snap.find((row) => row.batchId === batchId)?.items ?? [];
  }

  test("upsert 真实 worker 后清除同 batch 的 rehydrated 占位（rehydrate 先产占位、派发后写真实）", () => {
    resetExecutionEnvironmentDispatchStore();
    const anchor = "anchor-prune-1";
    const batchId = "batch-prune-1";
    mergeExecutionEnvironmentDispatchesForAnchor(anchor, [placeholderRecord(anchor, batchId)]);
    expect(itemsOf(anchor, batchId)).toHaveLength(1);
    expect(itemsOf(anchor, batchId)[0]?.workerSessionId).toBe(`rehydrated:${batchId}`);

    upsertExecutionEnvironmentDispatchItem({
      batchId,
      anchorSessionId: anchor,
      workerSessionId: "real-worker-1",
      label: "任务",
      previewText: "已派发任务",
      batchIndex: 1,
      sessionCount: 1,
    });

    const items = itemsOf(anchor, batchId);
    expect(items).toHaveLength(1);
    expect(items[0]?.workerSessionId).toBe("real-worker-1");
  });

  test("merge 含真实 worker 的 record 进占位 batch 后清除占位（持久化加载真实合并）", () => {
    resetExecutionEnvironmentDispatchStore();
    const anchor = "anchor-prune-2";
    const batchId = "batch-prune-2";
    mergeExecutionEnvironmentDispatchesForAnchor(anchor, [placeholderRecord(anchor, batchId)]);

    mergeExecutionEnvironmentDispatchesForAnchor(anchor, [
      {
        batchId,
        anchorSessionId: anchor,
        repositoryPath: "/tmp/repo",
        executionEngine: "claude",
        createdAt: 100,
        items: [
          {
            key: `exec-env:${batchId}:real-worker-2`,
            batchId,
            anchorSessionId: anchor,
            workerSessionId: "real-worker-2",
            label: "任务",
            previewText: "已派发任务",
            batchIndex: 1,
            sessionCount: 1,
            updatedAt: 200,
          },
        ],
      },
    ]);

    const items = itemsOf(anchor, batchId);
    expect(items).toHaveLength(1);
    expect(items[0]?.workerSessionId).toBe("real-worker-2");
  });

  test("仅占位（无真实 worker）时保留占位，不误删", () => {
    resetExecutionEnvironmentDispatchStore();
    const anchor = "anchor-prune-3";
    const batchId = "batch-prune-3";
    mergeExecutionEnvironmentDispatchesForAnchor(anchor, [placeholderRecord(anchor, batchId)]);

    const items = itemsOf(anchor, batchId);
    expect(items).toHaveLength(1);
    expect(items[0]?.workerSessionId).toBe(`rehydrated:${batchId}`);
  });
});
