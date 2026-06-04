import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import type { SessionConversationTaskItem } from "../types";

export interface ExecutionEnvironmentDispatchRecord {
  batchId: string;
  anchorSessionId: string;
  repositoryPath: string;
  executionEngine: SessionExecutionEngine;
  createdAt: number;
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
    batchIdsByAnchor.set(anchorSessionId, [batchId, ...prev.filter((id) => id !== batchId)].slice(0, MAX_BATCHES_PER_ANCHOR));
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

export function registerExecutionEnvironmentBatch(input: {
  batchId: string;
  anchorSessionId: string;
  repositoryPath: string;
  executionEngine: SessionExecutionEngine;
  sessionCount: number;
  previewText: string;
}): void {
  const batchId = input.batchId.trim();
  const anchorSessionId = input.anchorSessionId.trim();
  if (!batchId || !anchorSessionId) return;
  const existing = recordsByBatch.get(batchId);
  if (existing) {
    existing.repositoryPath = input.repositoryPath.trim() || existing.repositoryPath;
    existing.executionEngine = input.executionEngine;
    publishAnchor(anchorSessionId);
    return;
  }
  recordsByBatch.set(batchId, {
    batchId,
    anchorSessionId,
    repositoryPath: input.repositoryPath.trim(),
    executionEngine: input.executionEngine,
    createdAt: Date.now(),
    items: [],
  });
  const prev = batchIdsByAnchor.get(anchorSessionId) ?? [];
  batchIdsByAnchor.set(anchorSessionId, [batchId, ...prev.filter((id) => id !== batchId)].slice(0, MAX_BATCHES_PER_ANCHOR));
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
