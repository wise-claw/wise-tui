import type { TaskItem } from "../types";
import type {
  TrellisRequirementPrdRow,
  TrellisRequirementTaskRow,
} from "../services/trellisTaskBridge";
import {
  countSplitTodoExecutableTasks,
  isRunnableTrellisRequirementTask,
} from "./requirementWorkspaceExecutable";

export type TrellisTaskDrawerFocus = {
  parentTaskName: string | null;
  childTaskNames: string[];
};

export type TaskDrawerTrellisScope = {
  /** 限定某成员仓库时，与任务抽屉在该仓库会话下展示一致 */
  repositoryId?: number | null;
  focus?: TrellisTaskDrawerFocus | null;
};

/** Workspace 级 Trellis 子任务（与 ClaudeChat 任务抽屉同源：项目根 `.trellis/tasks`）。 */
export function isProjectWorkspaceTrellisTask(task: TrellisRequirementTaskRow): boolean {
  return task.sourceKind === "project";
}

/** 成员仓库下的 Trellis 子任务（仓库路径 `.trellis/tasks`）。 */
export function isRepositoryWorkspaceTrellisTask(task: TrellisRequirementTaskRow): boolean {
  return task.sourceKind === "projectRepository";
}

/** 工作区根目录下的需求 PRD（`project` 源，可跨成员仓库下发）。 */
export function isProjectWorkspaceRequirementPrd(prd: TrellisRequirementPrdRow): boolean {
  return prd.sourceKind === "project";
}

/** 成员仓库下的需求 PRD（`projectRepository` 源，仅本仓下发）。 */
export function isRepositoryWorkspaceRequirementPrd(prd: TrellisRequirementPrdRow): boolean {
  return prd.sourceKind === "projectRepository";
}

export type RequirementSnapshotCountScope =
  | { kind: "workspace" }
  | { kind: "repository"; repositoryId: number };

function applyTrellisTaskFocus(
  runnable: TrellisRequirementTaskRow[],
  focus: TrellisTaskDrawerFocus | null | undefined,
): TrellisRequirementTaskRow[] {
  if (!focus) return runnable;
  const parent = focus.parentTaskName?.trim() ?? "";
  const children = new Set(focus.childTaskNames.map((name) => name.trim()).filter(Boolean));
  const focused = runnable.filter((task) => {
    const taskId = task.taskId.trim();
    const parentName = task.parent?.trim() ?? "";
    if (children.has(taskId)) return true;
    return parent.length > 0 && parentName === parent;
  });
  return focused.length > 0 ? focused : runnable;
}

/**
 * 与主会话「任务」抽屉中 Trellis 区块列表一致的可执行任务（含 parent 子任务、排除终态）。
 * - 项目级：仅 `sourceKind === project`
 * - 仓库级：该 `repositoryId` 下的 `project` + `projectRepository` 子任务
 */
export function listDrawerTrellisTasks(
  tasks: readonly TrellisRequirementTaskRow[],
  scope?: TaskDrawerTrellisScope,
): TrellisRequirementTaskRow[] {
  const repositoryId = scope?.repositoryId ?? null;
  const sourceScoped =
    repositoryId != null
      ? tasks.filter(
          (task) =>
            task.repositoryId === repositoryId &&
            (isProjectWorkspaceTrellisTask(task) || isRepositoryWorkspaceTrellisTask(task)),
        )
      : tasks.filter(isProjectWorkspaceTrellisTask);

  const runnable = sourceScoped.filter(isRunnableTrellisRequirementTask);
  return applyTrellisTaskFocus(runnable, scope?.focus);
}

/** Wise 可执行任务：flowStatus 为 todo（含 in_progress 等未完成态，与 store 统计一致）。 */
export function countDrawerWiseTodoTasks(tasks: readonly TaskItem[]): number {
  return countSplitTodoExecutableTasks(tasks);
}

export function countDrawerExecutableTasks(
  splitTodoTasks: readonly TaskItem[],
  trellisTasks: readonly TrellisRequirementTaskRow[],
  scope?: TaskDrawerTrellisScope,
): { wiseTodo: number; trellisRunnable: number; total: number } {
  const wiseTodo = countDrawerWiseTodoTasks(splitTodoTasks);
  const trellisRunnable = listDrawerTrellisTasks(trellisTasks, scope).length;
  return { wiseTodo, trellisRunnable, total: wiseTodo + trellisRunnable };
}

/** 侧栏：按 Workspace 快照统计可执行任务（与任务抽屉计数规则一致）。 */
export function countExecutableTrellisTasksInSnapshot(
  snapshot: { tasks: readonly TrellisRequirementTaskRow[] },
  scope?: Pick<TaskDrawerTrellisScope, "repositoryId">,
): number {
  return listDrawerTrellisTasks(snapshot.tasks, scope).length;
}
