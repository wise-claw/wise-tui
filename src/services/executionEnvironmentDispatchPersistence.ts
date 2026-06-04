import { invoke } from "@tauri-apps/api/core";
import { normalizeSessionExecutionEngine } from "../constants/sessionExecutionEngine";
import type {
  ExecutionEnvironmentDispatchItem,
  ExecutionEnvironmentDispatchRecord,
} from "../stores/executionEnvironmentDispatchStore";

type ExecutionEnvironmentDispatchItemDto = {
  key: string;
  batchId: string;
  anchorSessionId: string;
  workerSessionId: string;
  label: string;
  previewText: string;
  batchIndex: number;
  sessionCount: number;
  updatedAt: number;
};

type ExecutionEnvironmentDispatchRecordDto = {
  batchId: string;
  anchorSessionId: string;
  repositoryPath: string;
  executionEngine: string;
  createdAt: number;
  items: ExecutionEnvironmentDispatchItemDto[];
};

function mapItemDto(row: ExecutionEnvironmentDispatchItemDto): ExecutionEnvironmentDispatchItem {
  return {
    key: row.key.trim() || `exec-env:${row.batchId}:${row.workerSessionId}`,
    batchId: row.batchId.trim(),
    anchorSessionId: row.anchorSessionId.trim(),
    workerSessionId: row.workerSessionId.trim(),
    label: row.label.trim() || "任务",
    previewText: row.previewText.trim(),
    batchIndex: Math.max(1, row.batchIndex),
    sessionCount: Math.max(1, row.sessionCount),
    updatedAt: row.updatedAt > 0 ? row.updatedAt : Date.now(),
  };
}

function mapRecordDto(row: ExecutionEnvironmentDispatchRecordDto): ExecutionEnvironmentDispatchRecord | null {
  const batchId = row.batchId.trim();
  const anchorSessionId = row.anchorSessionId.trim();
  if (!batchId || !anchorSessionId) return null;
  return {
    batchId,
    anchorSessionId,
    repositoryPath: row.repositoryPath.trim(),
    executionEngine: normalizeSessionExecutionEngine(row.executionEngine),
    createdAt: row.createdAt > 0 ? row.createdAt : Date.now(),
    items: (row.items ?? []).map(mapItemDto).filter((item) => item.workerSessionId.length > 0),
  };
}

export async function persistExecutionEnvironmentDispatchBatch(input: {
  batchId: string;
  anchorSessionId: string;
  repositoryPath: string;
  executionEngine: string;
  sessionCount: number;
  previewText: string;
  batchHint?: string | null;
  createdAtMs: number;
}): Promise<void> {
  await invoke("upsert_execution_environment_dispatch_batch", {
    batchId: input.batchId,
    anchorSessionId: input.anchorSessionId,
    repositoryPath: input.repositoryPath,
    executionEngine: input.executionEngine,
    sessionCount: input.sessionCount,
    previewText: input.previewText,
    batchHint: input.batchHint ?? null,
    createdAtMs: input.createdAtMs,
  });
}

export async function persistExecutionEnvironmentDispatchItem(input: {
  itemKey: string;
  batchId: string;
  anchorSessionId: string;
  workerSessionId: string;
  label: string;
  previewText: string;
  batchIndex: number;
  sessionCount: number;
  updatedAtMs: number;
}): Promise<void> {
  await invoke("upsert_execution_environment_dispatch_item", {
    itemKey: input.itemKey,
    batchId: input.batchId,
    anchorSessionId: input.anchorSessionId,
    workerSessionId: input.workerSessionId,
    label: input.label,
    previewText: input.previewText,
    batchIndex: input.batchIndex,
    sessionCount: input.sessionCount,
    updatedAtMs: input.updatedAtMs,
  });
}

export async function listExecutionEnvironmentDispatchesForAnchor(
  anchorSessionId: string,
  sinceMs: number,
): Promise<ExecutionEnvironmentDispatchRecord[]> {
  const anchor = anchorSessionId.trim();
  if (!anchor) return [];
  const rows = await invoke<ExecutionEnvironmentDispatchRecordDto[]>(
    "list_execution_environment_dispatches_for_anchor",
    { anchorSessionId: anchor, sinceMs: Math.max(0, sinceMs) },
  );
  return (rows ?? [])
    .map(mapRecordDto)
    .filter((row): row is ExecutionEnvironmentDispatchRecord => Boolean(row));
}
