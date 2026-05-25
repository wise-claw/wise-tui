import type { TaskItem } from "../types";
import type {
  TrellisRequirementTaskRow,
  TrellisRequirementWorkspaceSnapshot,
} from "../services/trellisTaskBridge";
import { normalizeSplitTaskListFlowStatus } from "../components/ClaudeSessions/claudeChatHelpers";

export function isRunnableTrellisRequirementTask(task: TrellisRequirementTaskRow): boolean {
  if (task.archived || !task.parent?.trim()) return false;
  const status = task.status.trim().toLowerCase();
  return status !== "completed" && status !== "rejected" && status !== "archived";
}

function filterTasksByRepository(
  tasks: TrellisRequirementTaskRow[],
  repositoryId?: number | null,
): TrellisRequirementTaskRow[] {
  if (repositoryId == null) return tasks;
  return tasks.filter((task) => task.repositoryId === repositoryId);
}

/**
 * @deprecated 请使用 `countExecutableTrellisTasksInSnapshot`（`taskDrawerCounts.ts`），
 * 与主会话任务抽屉计数规则一致。
 */
export function countRunnableTrellisTasksInSnapshot(
  snapshot: TrellisRequirementWorkspaceSnapshot,
  options?: { repositoryId?: number | null },
): number {
  const scopedTasks = filterTasksByRepository(snapshot.tasks, options?.repositoryId);
  return scopedTasks.filter(isRunnableTrellisRequirementTask).length;
}

export function countSplitTodoExecutableTasks(tasks: readonly TaskItem[]): number {
  return tasks.filter((task) => normalizeSplitTaskListFlowStatus(task.flowStatus) === "todo").length;
}
