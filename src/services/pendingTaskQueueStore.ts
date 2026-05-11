import type { PendingExecutionTask } from "../types";
import { deleteAppSetting, getAppSetting, setAppSetting } from "./appSettingsStore";

const STORAGE_PREFIX = "wise.pendingTaskQueue.v1";

export function pendingTaskQueueStorageKey(sessionId: string, repositoryPath: string): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(repositoryPath)}:${sessionId}`;
}

function isPendingExecutionTask(x: unknown): x is PendingExecutionTask {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.promptText === "string" &&
    typeof o.executorLabel === "string" &&
    typeof o.createdAt === "number"
  );
}

export async function readPendingTaskQueue(sessionId: string, repositoryPath: string): Promise<PendingExecutionTask[]> {
  try {
    const raw = await getAppSetting(pendingTaskQueueStorageKey(sessionId, repositoryPath));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPendingExecutionTask);
  } catch {
    return [];
  }
}

export async function writePendingTaskQueue(sessionId: string, repositoryPath: string, tasks: PendingExecutionTask[]): Promise<boolean> {
  try {
    await setAppSetting(pendingTaskQueueStorageKey(sessionId, repositoryPath), JSON.stringify(tasks));
    return true;
  } catch {
    return false;
  }
}

/** 「本轮结束后发送队首」意图（与任务队列同会话分桶，刷新不丢） */
export function deferredSendNextStorageKey(sessionId: string, repositoryPath: string): string {
  return `${STORAGE_PREFIX}.deferred:${encodeURIComponent(repositoryPath)}:${sessionId}`;
}

export async function readDeferredSendNext(sessionId: string, repositoryPath: string): Promise<boolean> {
  try {
    return (await getAppSetting(deferredSendNextStorageKey(sessionId, repositoryPath))) === "1";
  } catch {
    return false;
  }
}

export async function writeDeferredSendNext(sessionId: string, repositoryPath: string, value: boolean): Promise<void> {
  try {
    const k = deferredSendNextStorageKey(sessionId, repositoryPath);
    if (value) {
      await setAppSetting(k, "1");
    } else {
      await deleteAppSetting(k);
    }
  } catch {
    /* noop */
  }
}
