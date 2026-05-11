import { invoke } from "@tauri-apps/api/core";
import type { SplitResult, TaskItem } from "../types";
import { migrateStoredSplitResult } from "./taskSplitter";
import { normalizeSplitResultTaskLists } from "./splitResultModel";

interface ScopedTaskSplitStorePayload {
  schemaVersion: 2;
  activeRequirementId: string | null;
  resultsByRequirementId: Record<string, SplitResult>;
}

interface ScopedExecutableStorePayload {
  schemaVersion: 2;
  activeRequirementId: string | null;
  executablesByRequirementId: Record<string, TaskItem[]>;
}

let scopedRequirementId: string | null = null;

export function setPrdTaskSplitRequirementScope(requirementId: string | null): void {
  const normalized = requirementId?.trim();
  scopedRequirementId = normalized ? normalized : null;
}

function isScopedTaskSplitStorePayload(value: unknown): value is ScopedTaskSplitStorePayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as ScopedTaskSplitStorePayload;
  if (payload.schemaVersion !== 2) return false;
  if (payload.activeRequirementId !== null && typeof payload.activeRequirementId !== "string") return false;
  if (!payload.resultsByRequirementId || typeof payload.resultsByRequirementId !== "object") return false;
  return true;
}

function isScopedExecutableStorePayload(value: unknown): value is ScopedExecutableStorePayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as ScopedExecutableStorePayload;
  if (payload.schemaVersion !== 2) return false;
  if (payload.activeRequirementId !== null && typeof payload.activeRequirementId !== "string") return false;
  if (!payload.executablesByRequirementId || typeof payload.executablesByRequirementId !== "object") return false;
  return true;
}

function mergeExecutableTasksIntoSplitShape(rawSplit: unknown, executableRaw: unknown | null): SplitResult | null {
  if (!rawSplit || typeof rawSplit !== "object") return null;
  const lists = normalizeSplitResultTaskLists(rawSplit);
  if (!lists) return null;
  const base = { ...(rawSplit as object), splitTasks: lists.splitTasks, executableTasks: lists.executableTasks } as SplitResult;
  /** 可执行任务表尚无行时保持拆分 JSON 内的可执行任务（旧版混表迁移）；有表数据则以表为准。 */
  const executableTasks =
    executableRaw !== undefined && executableRaw !== null && Array.isArray(executableRaw)
      ? (executableRaw as TaskItem[])
      : lists.executableTasks;
  return migrateStoredSplitResult({ ...base, executableTasks });
}

function stripExecutableTasksForPersistence(result: SplitResult): SplitResult {
  return { ...result, executableTasks: [] };
}

function buildExecutablePersistencePayload(
  result: SplitResult,
  scope: string | null,
  previousExecutableRaw: unknown | null,
): unknown {
  if (!scope) {
    return result.executableTasks;
  }
  const base: ScopedExecutableStorePayload = isScopedExecutableStorePayload(previousExecutableRaw)
    ? previousExecutableRaw
    : {
      schemaVersion: 2,
      activeRequirementId: scope,
      executablesByRequirementId: {},
    };
  return {
    schemaVersion: 2,
    activeRequirementId: scope,
    executablesByRequirementId: {
      ...base.executablesByRequirementId,
      [scope]: result.executableTasks,
    },
  };
}

async function loadRawTaskSplitStore(): Promise<unknown | null> {
  return invoke<unknown | null>("get_prd_task_split_result");
}

async function loadRawExecutableStore(): Promise<unknown | null> {
  try {
    return invoke<unknown | null>("get_prd_executable_tasks_result");
  } catch {
    return null;
  }
}

export async function loadPrdTaskSplitResult(): Promise<SplitResult | null> {
  try {
    const splitRaw = await loadRawTaskSplitStore();
    const execRaw = await loadRawExecutableStore();
    if (!splitRaw) return null;
    if (!isScopedTaskSplitStorePayload(splitRaw)) {
      const merged = mergeExecutableTasksIntoSplitShape(splitRaw, execRaw);
      return merged;
    }
    const scope = scopedRequirementId ?? splitRaw.activeRequirementId;
    if (!scope) return null;
    const inner = splitRaw.resultsByRequirementId?.[scope];
    if (!inner) return null;
    let scopedExec: TaskItem[] | undefined;
    if (Array.isArray(execRaw)) {
      scopedExec = execRaw as TaskItem[];
    } else if (isScopedExecutableStorePayload(execRaw)) {
      scopedExec = execRaw.executablesByRequirementId?.[scope];
    }
    const mergedInner = mergeExecutableTasksIntoSplitShape(inner, scopedExec ?? null);
    return mergedInner;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("loadPrdTaskSplitResult:", msg);
    return null;
  }
}

/** 写入拆分表与可执行任务表（同一事务）。 */
export async function savePrdTaskSplitResult(payload: SplitResult): Promise<void> {
  const execRawPrevious = await loadRawExecutableStore().catch(() => null);
  const scope = scopedRequirementId;
  if (!scope) {
    const splitOnly = stripExecutableTasksForPersistence(payload);
    const execPersistence = buildExecutablePersistencePayload(payload, null, execRawPrevious);
    await invoke("set_prd_task_split_result", { split: splitOnly, executable: execPersistence });
    return;
  }
  const raw = await loadRawTaskSplitStore().catch(() => null);
  const base: ScopedTaskSplitStorePayload = isScopedTaskSplitStorePayload(raw)
    ? raw
    : {
      schemaVersion: 2,
      activeRequirementId: scope,
      resultsByRequirementId: {},
    };
  const strippedEntries = Object.fromEntries(
    Object.entries(base.resultsByRequirementId).map(([k, v]) => [k, stripExecutableTasksForPersistence(v)]),
  );
  const splitPayload: ScopedTaskSplitStorePayload = {
    schemaVersion: 2,
    activeRequirementId: scope,
    resultsByRequirementId: {
      ...strippedEntries,
      [scope]: stripExecutableTasksForPersistence(payload),
    },
  };
  const execPersistence = buildExecutablePersistencePayload(payload, scope, execRawPrevious);
  await invoke("set_prd_task_split_result", { split: splitPayload, executable: execPersistence });
}

export async function clearPrdTaskSplitResult(): Promise<void> {
  const scope = scopedRequirementId;
  if (!scope) {
    await invoke("clear_prd_task_split_result");
    return;
  }
  const raw = await loadRawTaskSplitStore().catch(() => null);
  if (!isScopedTaskSplitStorePayload(raw)) {
    await invoke("clear_prd_task_split_result");
    return;
  }
  const nextMap = { ...raw.resultsByRequirementId };
  delete nextMap[scope];
  const execRaw = await loadRawExecutableStore().catch(() => null);
  let nextExecPayload: unknown = null;
  if (isScopedExecutableStorePayload(execRaw)) {
    const nextExecMap = { ...execRaw.executablesByRequirementId };
    delete nextExecMap[scope];
    if (Object.keys(nextExecMap).length === 0) {
      nextExecPayload = [];
    } else {
      nextExecPayload = {
        schemaVersion: 2,
        activeRequirementId: raw.activeRequirementId === scope ? Object.keys(nextMap)[0] ?? null : raw.activeRequirementId,
        executablesByRequirementId: nextExecMap,
      };
    }
  } else {
    nextExecPayload = [];
  }
  if (Object.keys(nextMap).length === 0) {
    await invoke("clear_prd_task_split_result");
    return;
  }
  const nextSplit: ScopedTaskSplitStorePayload = {
    schemaVersion: 2,
    activeRequirementId: raw.activeRequirementId === scope ? Object.keys(nextMap)[0] ?? null : raw.activeRequirementId,
    resultsByRequirementId: nextMap,
  };
  await invoke("set_prd_task_split_result", { split: nextSplit, executable: nextExecPayload ?? [] });
}
