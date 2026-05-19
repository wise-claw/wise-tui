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

export function moveTaskToExecutionWave(
  result: SplitResult,
  taskId: string,
  targetWaveIndex: number,
): SplitResult | null {
  const groups = buildParallelGroups(result.splitTasks);
  const currentWaveIndex = groups.findIndex((group) => group.includes(taskId));
  if (currentWaveIndex < 0) return null;
  const normalizedTargetIndex = Math.max(0, Math.min(targetWaveIndex, groups.length));
  if (normalizedTargetIndex === currentWaveIndex) return null;
  const dependencies = normalizedTargetIndex > 0
    ? (groups[normalizedTargetIndex - 1] ?? []).filter((id) => id !== taskId)
    : [];
  const taskIdsToUnblock = normalizedTargetIndex > currentWaveIndex
    ? new Set(groups.slice(currentWaveIndex, normalizedTargetIndex + 1).flat())
    : new Set<string>();

  const nextTasks = result.splitTasks.map((task) => {
    if (task.id === taskId) {
      return withDependencies(task, uniqueTaskIds(dependencies, taskId));
    }
    if (!taskIdsToUnblock.has(task.id)) return task;
    return {
      ...task,
      dependencies: task.dependencies.filter((id) => id !== taskId),
      dependencyRationale: filterDependencyRationale(task.dependencyRationale, (id) => id !== taskId),
    };
  });

  return finalize(result, nextTasks);
}

export function inferLikelyExecutionDependencies(result: SplitResult): SplitResult {
  const nextTasks = result.splitTasks.map((task, index) => {
    const inferredDeps = result.splitTasks
      .slice(0, index)
      .filter((candidate) => shouldInferDependency(candidate, task))
      .map((candidate) => candidate.id);
    const nextDependencies = uniqueTaskIds([...task.dependencies, ...inferredDeps], task.id);
    if (sameStringArray(nextDependencies, task.dependencies)) return task;
    return {
      ...task,
      dependencies: nextDependencies,
      dependencyRationale: {
        ...task.dependencyRationale,
        ...Object.fromEntries(
          inferredDeps.map((depId) => [depId, "JWT/令牌/请求拦截依赖登录注册基础能力先完成。"]),
        ),
      },
    };
  });
  return finalize(result, nextTasks) ?? result;
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

function shouldInferDependency(candidate: TaskItem, task: TaskItem): boolean {
  if (candidate.id === task.id) return false;
  if (task.dependencies.includes(candidate.id)) return false;
  if (task.role !== candidate.role) return false;
  const candidateText = searchableTaskText(candidate);
  const taskText = searchableTaskText(task);
  return isAuthFoundationTask(candidateText) && isAuthConsumerTask(taskText);
}

function searchableTaskText(task: TaskItem): string {
  return [
    task.id,
    task.title,
    task.description,
    task.subtasks.join(" "),
    task.dod.join(" "),
    task.sourceRefs.join(" "),
  ].join(" ").toLowerCase();
}

function isAuthFoundationTask(text: string): boolean {
  return /登录|注册|登陆|表单|认证页面|login|sign[ -]?in|signup|sign[ -]?up|auth page/.test(text);
}

function isAuthConsumerTask(text: string): boolean {
  return /jwt|令牌|token|鉴权|认证拦截|请求拦截|拦截器|守卫|guard|interceptor|session|cookie/.test(text);
}

function sameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
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
