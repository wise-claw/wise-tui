/**
 * Apply user edits (字段 patch / 新增任务 / 删除任务) on top of normalizer output.
 *
 * 纯函数；不修改入参；返回应用编辑后的 `splitTasks` 数组（保留 `taskAnchors` /
 * `claudeSplitMapping` 等溯源字段不变）。
 */

import type { SplitResult, TaskItem } from "../../types";
import type { ClusterEditState, TaskEditPatch } from "./types";

export function applyTaskEdits(
  source: SplitResult["splitTasks"],
  edits: ClusterEditState | undefined,
): TaskItem[] {
  if (!edits) return source;
  const deletedSet = new Set(edits.deletedTaskIds);
  const kept = source
    .filter((task) => !deletedSet.has(task.id))
    .map((task) => mergePatch(task, edits.patches[task.id]));
  return [...kept, ...edits.manualTasks];
}

function mergePatch(task: TaskItem, patch: TaskEditPatch | undefined): TaskItem {
  if (!patch) return task;
  return {
    ...task,
    title: patch.title ?? task.title,
    description: patch.description ?? task.description,
    role: patch.role ?? task.role,
    subtasks: patch.subtasks ?? task.subtasks,
    dod: patch.dod ?? task.dod,
    sourceRequirementIds: patch.sourceRequirementIds ?? task.sourceRequirementIds,
    taskAnchors: patch.taskAnchors ?? task.taskAnchors,
  };
}

/** Convenience: 把 SplitResult 内的 splitTasks 替换为编辑后的版本，其它字段原样。 */
export function applyEditsToSplitResult(
  split: SplitResult,
  edits: ClusterEditState | undefined,
): SplitResult {
  if (!edits) return split;
  return {
    ...split,
    splitTasks: applyTaskEdits(split.splitTasks, edits),
  };
}

export function isEditedTask(task: TaskItem, edits: ClusterEditState | undefined): boolean {
  if (!edits) return false;
  if (edits.manualTasks.some((t) => t.id === task.id)) return true;
  const patch = edits.patches[task.id];
  if (!patch) return false;
  return Object.keys(patch).length > 0;
}

export function isManualTask(task: TaskItem, edits: ClusterEditState | undefined): boolean {
  return Boolean(edits?.manualTasks.some((t) => t.id === task.id));
}

export function ensureClusterEdit(
  state: Record<string, ClusterEditState>,
  clusterId: string,
): ClusterEditState {
  return state[clusterId] ?? { patches: {}, manualTasks: [], deletedTaskIds: [] };
}

export function emptyTaskEdit(): TaskEditPatch {
  return {};
}
