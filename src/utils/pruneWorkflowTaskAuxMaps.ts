import type { WorkflowTaskItem } from "../types";

const DEFAULT_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_TASKS = 120;

export function collectLiveWorkflowTaskIds(tasks: readonly WorkflowTaskItem[]): Set<string> {
  return new Set(tasks.map((task) => task.id));
}

export function pruneRecordByTaskIds<T>(
  prev: Record<string, T>,
  liveTaskIds: ReadonlySet<string>,
  updates?: ReadonlyArray<readonly [string, T]>,
): Record<string, T> {
  const updateMap = updates ? new Map(updates) : null;
  let changed = false;
  const next: Record<string, T> = {};

  for (const taskId of liveTaskIds) {
    const value = updateMap?.get(taskId) ?? prev[taskId];
    if (value === undefined) continue;
    next[taskId] = value;
    if (prev[taskId] !== value) changed = true;
  }

  if (Object.keys(prev).length !== Object.keys(next).length) {
    changed = true;
  }

  return changed ? next : prev;
}

/** 合并当前会话任务，并淘汰其它会话里过旧/过多的 completed 任务，避免 workflow 辅助 Map 无限增长。 */
export function mergeWorkflowTasksForSession(
  prev: WorkflowTaskItem[],
  activeSessionId: string,
  sessionTasks: WorkflowTaskItem[],
  options?: { staleMs?: number; maxTotal?: number },
): WorkflowTaskItem[] {
  const staleMs = options?.staleMs ?? DEFAULT_STALE_MS;
  const maxTotal = options?.maxTotal ?? DEFAULT_MAX_TASKS;
  const now = Date.now();
  const untouched = prev.filter((item) => {
    if (item.creator === activeSessionId) return false;
    if (item.status === "in_progress") return true;
    return now - item.updatedAt < staleMs;
  });
  const merged = [...untouched, ...sessionTasks];
  if (merged.length <= maxTotal) return merged;

  const inProgress = merged.filter((task) => task.status === "in_progress");
  const rest = merged
    .filter((task) => task.status !== "in_progress")
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const restSlots = Math.max(0, maxTotal - inProgress.length);
  return [...inProgress, ...rest.slice(0, restSlots)];
}

export function removeWorkflowTasksForSessionCreators(
  tasks: WorkflowTaskItem[],
  creatorIds: ReadonlySet<string>,
): WorkflowTaskItem[] {
  if (creatorIds.size === 0) return tasks;
  const next = tasks.filter((task) => !creatorIds.has(task.creator));
  return next.length === tasks.length ? tasks : next;
}
