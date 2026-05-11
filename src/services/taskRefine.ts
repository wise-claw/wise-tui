import type { SplitResult, TaskRefinePatch, TaskSplitSnapshot } from "../types";
import { buildCriticalPath, buildParallelGroups } from "./taskDependency";

export function applyTaskRefinePatch(result: SplitResult, patch: TaskRefinePatch): SplitResult {
  const tasks = result.splitTasks.map((task) => {
    if (task.id !== patch.taskId) return task;
    return {
      ...task,
      title: patch.title ?? task.title,
      role: patch.role ?? task.role,
      apiSpec: patch.apiSpec ?? task.apiSpec,
      size: patch.size ?? task.size,
      estimateDays: patch.estimateDays ?? task.estimateDays,
      dependencies: patch.dependencies ?? task.dependencies,
      dod: patch.dod ?? task.dod,
      subtasks: patch.subtasks ?? task.subtasks,
    };
  });

  return {
    ...result,
    splitTasks: tasks,
    criticalPath: buildCriticalPath(tasks),
    parallelGroups: buildParallelGroups(tasks),
  };
}

export function createTaskSplitSnapshot(
  version: number,
  label: string,
  result: SplitResult,
): TaskSplitSnapshot {
  return {
    version,
    label,
    createdAt: Date.now(),
    result,
  };
}

export function reorderTask(result: SplitResult, taskId: string, direction: "up" | "down"): SplitResult {
  const tasks = [...result.splitTasks];
  const idx = tasks.findIndex((task) => task.id === taskId);
  if (idx < 0) return result;

  const targetIdx = direction === "up" ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= tasks.length) return result;

  const [picked] = tasks.splice(idx, 1);
  tasks.splice(targetIdx, 0, picked);

  return {
    ...result,
    splitTasks: tasks,
    criticalPath: buildCriticalPath(tasks),
    parallelGroups: buildParallelGroups(tasks),
  };
}
