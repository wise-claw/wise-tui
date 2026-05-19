import type { SplitResult, TaskItem } from "../../types";
import { buildParallelGroups, validateTaskDependencies } from "../../services/taskDependency";
import { refreshSplitResultDerivedFields } from "../../services/taskSplitter";

export type ExecutionPlanMoveDirection = "earlier" | "later";

export function moveTaskInExecutionPlan(
  result: SplitResult,
  taskId: string,
  direction: ExecutionPlanMoveDirection,
): SplitResult | null {
  const groups = buildParallelGroups(result.splitTasks);
  const groupIndex = groups.findIndex((group) => group.includes(taskId));
  if (groupIndex < 0) return null;
  if (direction === "earlier") {
    return moveTaskEarlier(result, groups, groupIndex, taskId);
  }
  return moveTaskLater(result, groups, groupIndex, taskId);
}

function moveTaskEarlier(
  result: SplitResult,
  groups: string[][],
  groupIndex: number,
  taskId: string,
): SplitResult | null {
  if (groupIndex <= 0) return null;
  const dependencies = groupIndex > 1 ? groups[groupIndex - 2] ?? [] : [];
  return applyDependencies(result, taskId, dependencies);
}

function moveTaskLater(
  result: SplitResult,
  groups: string[][],
  groupIndex: number,
  taskId: string,
): SplitResult | null {
  const sameWavePeers = (groups[groupIndex] ?? []).filter((id) => id !== taskId);
  if (sameWavePeers.length === 0 && groupIndex >= groups.length - 1) return null;
  const dependencies = sameWavePeers.length > 0
    ? sameWavePeers
    : (groups[groupIndex + 1] ?? []).filter((id) => id !== taskId);
  if (dependencies.length === 0) return null;

  const nextTasks = result.splitTasks.map((task) => {
    if (dependencies.includes(task.id)) {
      return {
        ...task,
        dependencies: task.dependencies.filter((id) => id !== taskId),
        dependencyRationale: filterDependencyRationale(task.dependencyRationale, (id) => id !== taskId),
      };
    }
    if (task.id === taskId) {
      const nextDependencies = uniqueTaskIds(dependencies, taskId);
      return {
        ...task,
        dependencies: nextDependencies,
        dependencyRationale: preserveDependencyRationale(task.dependencyRationale, nextDependencies),
      };
    }
    return task;
  });

  return finalize(result, nextTasks);
}

function applyDependencies(
  result: SplitResult,
  taskId: string,
  dependencies: string[],
): SplitResult | null {
  const nextTasks = result.splitTasks.map((task) => (
    task.id === taskId
      ? withDependencies(task, uniqueTaskIds(dependencies, taskId))
      : task
  ));
  return finalize(result, nextTasks);
}

function withDependencies(task: TaskItem, dependencies: string[]): TaskItem {
  return {
    ...task,
    dependencies,
    dependencyRationale: preserveDependencyRationale(task.dependencyRationale, dependencies),
  };
}

function finalize(result: SplitResult, splitTasks: TaskItem[]): SplitResult | null {
  const error = validateTaskDependencies(splitTasks);
  if (error) return null;
  return refreshSplitResultDerivedFields({ ...result, splitTasks });
}

function uniqueTaskIds(ids: string[], selfId: string): string[] {
  return Array.from(new Set(ids.map((id) => id.trim()).filter((id) => id && id !== selfId)));
}

function preserveDependencyRationale(
  rationale: Record<string, string> | undefined,
  dependencies: string[],
): Record<string, string> | undefined {
  return filterDependencyRationale(rationale, (id) => dependencies.includes(id));
}

function filterDependencyRationale(
  rationale: Record<string, string> | undefined,
  predicate: (id: string) => boolean,
): Record<string, string> | undefined {
  if (!rationale) return undefined;
  const out: Record<string, string> = {};
  for (const [id, value] of Object.entries(rationale)) {
    if (!predicate(id)) continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    out[id] = trimmed;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
