import { describe, expect, test } from "bun:test";
import {
  getExecutionEnvironmentDispatchesSnapshot,
  getExecutionEnvironmentDispatchesSnapshotForAnchor,
  markExecutionEnvironmentDispatchItemExited,
  mergeExecutionEnvironmentDispatchesForAnchor,
  registerExecutionEnvironmentBatch,
  removeExecutionEnvironmentDispatchItem,
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


describe("executionEnvironmentDispatchStore background-script lifecycle", () => {
  function setupBackgroundScriptItem(input: {
    batchId: string;
    anchor: string;
    workerSessionId: string;
    workspaceId: string;
    terminalId: string;
    pid?: number;
  }) {
    upsertExecutionEnvironmentDispatchItem({
      batchId: input.batchId,
      anchorSessionId: input.anchor,
      workerSessionId: input.workerSessionId,
      label: "执行脚本·测试助手",
      previewText: "echo hi",
      batchIndex: 1,
      sessionCount: 1,
      workspaceId: input.workspaceId,
      terminalId: input.terminalId,
      cwd: input.workspaceId,
      pid: input.pid ?? 4242,
    });
  }

  test("markExited 退出码 0 → previewText=已完成，exitCode=0", () => {
    resetExecutionEnvironmentDispatchStore();
    setupBackgroundScriptItem({
      anchor: "anchor-bg-1",
      batchId: "bg-1",
      workerSessionId: "assistant-script:a:1",
      workspaceId: "/repo/a",
      terminalId: "assistant-script:a:1",
    });
    markExecutionEnvironmentDispatchItemExited({
      workerSessionId: "assistant-script:a:1",
      exitCode: 0,
    });
    const item = getExecutionEnvironmentDispatchesSnapshotForAnchor("anchor-bg-1")
      .flatMap((row) => row.items)
      .find((it) => it.workerSessionId === "assistant-script:a:1");
    expect(item?.exitCode).toBe(0);
    expect(item?.previewText).toBe("已完成");
    expect(item?.killedByUser).toBeUndefined();
  });

  test("markExited 退出码非 0 → previewText=已退出（code N），exitCode 写入", () => {
    resetExecutionEnvironmentDispatchStore();
    setupBackgroundScriptItem({
      anchor: "anchor-bg-2",
      batchId: "bg-2",
      workerSessionId: "assistant-script:a:2",
      workspaceId: "/repo/a",
      terminalId: "assistant-script:a:2",
    });
    markExecutionEnvironmentDispatchItemExited({
      workerSessionId: "assistant-script:a:2",
      exitCode: 137,
    });
    const item = getExecutionEnvironmentDispatchesSnapshotForAnchor("anchor-bg-2")
      .flatMap((row) => row.items)
      .find((it) => it.workerSessionId === "assistant-script:a:2");
    expect(item?.exitCode).toBe(137);
    expect(item?.previewText).toBe("已退出（code 137）");
  });

  test("markExited killedByUser:true + exitMessage → previewText=已手动结束", () => {
    resetExecutionEnvironmentDispatchStore();
    setupBackgroundScriptItem({
      anchor: "anchor-bg-3",
      batchId: "bg-3",
      workerSessionId: "assistant-script:a:3",
      workspaceId: "/repo/a",
      terminalId: "assistant-script:a:3",
    });
    markExecutionEnvironmentDispatchItemExited({
      workerSessionId: "assistant-script:a:3",
      killedByUser: true,
      exitMessage: "已手动结束",
    });
    const item = getExecutionEnvironmentDispatchesSnapshotForAnchor("anchor-bg-3")
      .flatMap((row) => row.items)
      .find((it) => it.workerSessionId === "assistant-script:a:3");
    expect(item?.killedByUser).toBe(true);
    expect(item?.previewText).toBe("已手动结束");
  });

  test("markExited 找不到 workerSessionId 时静默返回", () => {
    resetExecutionEnvironmentDispatchStore();
    setupBackgroundScriptItem({
      anchor: "anchor-bg-4",
      batchId: "bg-4",
      workerSessionId: "assistant-script:a:4",
      workspaceId: "/repo/a",
      terminalId: "assistant-script:a:4",
    });
    const before = getExecutionEnvironmentDispatchesSnapshotForAnchor("anchor-bg-4");
    expect(() =>
      markExecutionEnvironmentDispatchItemExited({
        workerSessionId: "assistant-script:nonexistent:nope",
        exitCode: 0,
      }),
    ).not.toThrow();
    const after = getExecutionEnvironmentDispatchesSnapshotForAnchor("anchor-bg-4");
    expect(after).toEqual(before);
  });

  test("removeExecutionEnvironmentDispatchItem 按 workerSessionId 单条移除", () => {
    resetExecutionEnvironmentDispatchStore();
    setupBackgroundScriptItem({
      anchor: "anchor-bg-5",
      batchId: "bg-5",
      workerSessionId: "assistant-script:a:5",
      workspaceId: "/repo/a",
      terminalId: "assistant-script:a:5",
    });
    setupBackgroundScriptItem({
      anchor: "anchor-bg-5",
      batchId: "bg-5",
      workerSessionId: "assistant-script:a:6",
      workspaceId: "/repo/a",
      terminalId: "assistant-script:a:6",
    });
    removeExecutionEnvironmentDispatchItem({ workerSessionId: "assistant-script:a:5" });
    const items = getExecutionEnvironmentDispatchesSnapshotForAnchor("anchor-bg-5").flatMap(
      (row) => row.items,
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.workerSessionId).toBe("assistant-script:a:6");
  });
});
