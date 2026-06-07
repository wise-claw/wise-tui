import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import type { SessionConversationTaskItem } from "../types";

export interface ExecutionEnvironmentDispatchRecord {
  batchId: string;
  anchorSessionId: string;
  repositoryPath: string;
  executionEngine: SessionExecutionEngine;
  createdAt: number;
  /** 批次级摘要（items 为空时用于列表展示） */
  previewText?: string;
  sessionCount?: number;
  items: ExecutionEnvironmentDispatchItem[];
}

export interface ExecutionEnvironmentDispatchItem {
  key: string;
  batchId: string;
  anchorSessionId: string;
  workerSessionId: string;
  label: string;
  previewText: string;
  batchIndex: number;
  sessionCount: number;
  updatedAt: number;
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** batchId → record */
const recordsByBatch = new Map<string, ExecutionEnvironmentDispatchRecord>();
/** anchorSessionId → batchIds（新批次在前） */
const batchIdsByAnchor = new Map<string, string[]>();

const MAX_BATCHES_PER_ANCHOR = 40;
const MAX_ITEMS_PER_BATCH = 12;

const EMPTY_ANCHOR_SNAPSHOT: ExecutionEnvironmentDispatchRecord[] = [];

/** anchorSessionId → 稳定快照（仅 digest 变化时替换引用，供 useSyncExternalStore） */
const anchorSnapshotById = new Map<
  string,
  { digest: string; snapshot: ExecutionEnvironmentDispatchRecord[] }
>();

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

function listRecordsForAnchorUncached(anchorSessionId: string): ExecutionEnvironmentDispatchRecord[] {
  const ids = batchIdsByAnchor.get(anchorSessionId.trim()) ?? [];
  return ids
    .map((id) => recordsByBatch.get(id))
    .filter((row): row is ExecutionEnvironmentDispatchRecord => Boolean(row));
}

function digestAnchorRecords(records: readonly ExecutionEnvironmentDispatchRecord[]): string {
  const parts: string[] = [];
  for (const batch of records) {
    parts.push(batch.batchId);
    parts.push(batch.executionEngine);
    parts.push(String(batch.createdAt));
    parts.push(batch.repositoryPath);
    for (const item of batch.items) {
      parts.push(
        [
          item.key,
          item.workerSessionId,
          item.label,
          item.previewText,
          String(item.batchIndex),
          String(item.sessionCount),
          String(item.updatedAt),
        ].join("|"),
      );
    }
  }
  return parts.join("\n");
}

function refreshAnchorSnapshot(anchorSessionId: string): boolean {
  const id = anchorSessionId.trim();
  if (!id) return false;
  const next = listRecordsForAnchorUncached(id);
  const digest = digestAnchorRecords(next);
  const prev = anchorSnapshotById.get(id);
  if (prev?.digest === digest) {
    return false;
  }
  const snapshot = next.length === 0 ? EMPTY_ANCHOR_SNAPSHOT : next;
  anchorSnapshotById.set(id, { digest, snapshot });
  return true;
}

function publishAnchor(anchorSessionId: string): void {
  if (refreshAnchorSnapshot(anchorSessionId)) {
    notify();
  }
}

/** 更新 anchor 批次索引并淘汰被 slice 裁掉的 record，避免 recordsByBatch / anchorSnapshotById 无界增长。 */
function setAnchorBatchIds(anchorSessionId: string, batchIds: readonly string[]): void {
  const anchor = anchorSessionId.trim();
  if (!anchor) return;
  const prevIds = batchIdsByAnchor.get(anchor) ?? [];
  const trimmed = batchIds.slice(0, MAX_BATCHES_PER_ANCHOR);
  const keep = new Set(trimmed);
  for (const id of prevIds) {
    if (keep.has(id)) continue;
    const record = recordsByBatch.get(id);
    if (record?.anchorSessionId.trim() === anchor) {
      recordsByBatch.delete(id);
    }
  }
  if (trimmed.length === 0) {
    batchIdsByAnchor.delete(anchor);
    anchorSnapshotById.delete(anchor);
    return;
  }
  batchIdsByAnchor.set(anchor, trimmed);
  for (const [snapshotAnchorId] of anchorSnapshotById) {
    if (!batchIdsByAnchor.has(snapshotAnchorId)) {
      anchorSnapshotById.delete(snapshotAnchorId);
    }
  }
}

export function subscribeExecutionEnvironmentDispatches(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** useSyncExternalStore 用：返回与 digest 绑定的稳定数组引用 */
export function getExecutionEnvironmentDispatchesSnapshotForAnchor(
  anchorSessionId: string | null | undefined,
): ExecutionEnvironmentDispatchRecord[] {
  const id = anchorSessionId?.trim() ?? "";
  if (!id) return EMPTY_ANCHOR_SNAPSHOT;
  const cached = anchorSnapshotById.get(id);
  if (cached) return cached.snapshot;
  refreshAnchorSnapshot(id);
  return anchorSnapshotById.get(id)?.snapshot ?? EMPTY_ANCHOR_SNAPSHOT;
}

export function getExecutionEnvironmentDispatchesSnapshot(): ExecutionEnvironmentDispatchRecord[] {
  return [...recordsByBatch.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/** @deprecated 优先使用 getExecutionEnvironmentDispatchesSnapshotForAnchor */
export function getExecutionEnvironmentDispatchesForAnchor(
  anchorSessionId: string,
): ExecutionEnvironmentDispatchRecord[] {
  return getExecutionEnvironmentDispatchesSnapshotForAnchor(anchorSessionId);
}

export function upsertExecutionEnvironmentDispatchItem(
  item: Omit<ExecutionEnvironmentDispatchItem, "key" | "updatedAt"> & { updatedAt?: number },
): void {
  const batchId = item.batchId.trim();
  const anchorSessionId = item.anchorSessionId.trim();
  if (!batchId || !anchorSessionId) return;

  let record = recordsByBatch.get(batchId);
  if (!record) {
    record = {
      batchId,
      anchorSessionId,
      repositoryPath: "",
      executionEngine: "claude",
      createdAt: Date.now(),
      items: [],
    };
    recordsByBatch.set(batchId, record);
    const prev = batchIdsByAnchor.get(anchorSessionId) ?? [];
    setAnchorBatchIds(anchorSessionId, [batchId, ...prev.filter((id) => id !== batchId)]);
  }

  const key = `exec-env:${batchId}:${item.workerSessionId}`;
  const row: ExecutionEnvironmentDispatchItem = {
    ...item,
    key,
    updatedAt: item.updatedAt ?? Date.now(),
  };
  const idx = record.items.findIndex((r) => r.workerSessionId === item.workerSessionId);
  if (idx >= 0) {
    record.items[idx] = { ...record.items[idx]!, ...row };
  } else {
    record.items = [...record.items, row].slice(-MAX_ITEMS_PER_BATCH);
  }
  publishAnchor(anchorSessionId);
}

export function mergeExecutionEnvironmentDispatchesForAnchor(
  anchorSessionId: string,
  records: readonly ExecutionEnvironmentDispatchRecord[],
): void {
  const anchor = anchorSessionId.trim();
  if (!anchor) return;

  for (const record of records) {
    if (record.anchorSessionId.trim() !== anchor) continue;
    const batchId = record.batchId.trim();
    if (!batchId) continue;

    const existing = recordsByBatch.get(batchId);
    const mergedItems = mergeDispatchItems(existing?.items ?? [], record.items);
    recordsByBatch.set(batchId, {
      batchId,
      anchorSessionId: anchor,
      repositoryPath: record.repositoryPath.trim() || existing?.repositoryPath || "",
      executionEngine: record.executionEngine,
      createdAt: record.createdAt > 0 ? record.createdAt : (existing?.createdAt ?? Date.now()),
      previewText: record.previewText?.trim() || existing?.previewText,
      sessionCount: record.sessionCount ?? existing?.sessionCount,
      items: mergedItems,
    });

    const prevIds = batchIdsByAnchor.get(anchor) ?? [];
    if (!prevIds.includes(batchId)) {
      setAnchorBatchIds(anchor, [batchId, ...prevIds.filter((id) => id !== batchId)]);
    }
  }

  publishAnchor(anchor);
}

function mergeDispatchItems(
  existing: readonly ExecutionEnvironmentDispatchItem[],
  incoming: readonly ExecutionEnvironmentDispatchItem[],
): ExecutionEnvironmentDispatchItem[] {
  const byWorker = new Map<string, ExecutionEnvironmentDispatchItem>();
  for (const item of existing) {
    byWorker.set(item.workerSessionId, item);
  }
  for (const item of incoming) {
    const prev = byWorker.get(item.workerSessionId);
    if (!prev || item.updatedAt >= prev.updatedAt) {
      byWorker.set(item.workerSessionId, item);
    }
  }
  return [...byWorker.values()];
}

export function replaceExecutionEnvironmentDispatchesForAnchor(
  anchorSessionId: string,
  records: readonly ExecutionEnvironmentDispatchRecord[],
): void {
  const anchor = anchorSessionId.trim();
  if (!anchor) return;

  const prevIds = batchIdsByAnchor.get(anchor) ?? [];
  for (const batchId of prevIds) {
    recordsByBatch.delete(batchId);
  }
  batchIdsByAnchor.delete(anchor);
  anchorSnapshotById.delete(anchor);

  const nextIds: string[] = [];
  for (const record of records) {
    if (record.anchorSessionId.trim() !== anchor) continue;
    const batchId = record.batchId.trim();
    if (!batchId) continue;
    recordsByBatch.set(batchId, {
      ...record,
      anchorSessionId: anchor,
      items: [...record.items],
    });
    nextIds.push(batchId);
  }
  setAnchorBatchIds(anchor, nextIds);
  publishAnchor(anchor);
}

export function registerExecutionEnvironmentBatch(input: {
  batchId: string;
  anchorSessionId: string;
  repositoryPath: string;
  executionEngine: SessionExecutionEngine;
  sessionCount: number;
  previewText: string;
  createdAt?: number;
}): void {
  const batchId = input.batchId.trim();
  const anchorSessionId = input.anchorSessionId.trim();
  if (!batchId || !anchorSessionId) return;
  const existing = recordsByBatch.get(batchId);
  if (existing) {
    existing.repositoryPath = input.repositoryPath.trim() || existing.repositoryPath;
    existing.executionEngine = input.executionEngine;
    if (input.previewText?.trim()) {
      existing.previewText = input.previewText.trim();
    }
    if (input.sessionCount > 0) {
      existing.sessionCount = input.sessionCount;
    }
    publishAnchor(anchorSessionId);
    return;
  }
  recordsByBatch.set(batchId, {
    batchId,
    anchorSessionId,
    repositoryPath: input.repositoryPath.trim(),
    executionEngine: input.executionEngine,
    createdAt: input.createdAt ?? Date.now(),
    previewText: input.previewText?.trim() || undefined,
    sessionCount: input.sessionCount > 0 ? input.sessionCount : undefined,
    items: [],
  });
  const prev = batchIdsByAnchor.get(anchorSessionId) ?? [];
  setAnchorBatchIds(anchorSessionId, [batchId, ...prev.filter((id) => id !== batchId)]);
  publishAnchor(anchorSessionId);
}

export function sessionStatusToConversationTaskStatus(
  status: import("../types").ClaudeSession["status"],
): SessionConversationTaskItem["status"] {
  if (status === "running" || status === "connecting") return "running";
  if (status === "error" || status === "cancelled") return "failed";
  return "completed";
}

export function resetExecutionEnvironmentDispatchStore(): void {
  recordsByBatch.clear();
  batchIdsByAnchor.clear();
  anchorSnapshotById.clear();
  notify();
}
