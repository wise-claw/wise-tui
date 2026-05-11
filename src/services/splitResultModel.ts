import type { SplitResult, TaskItem } from "../types";

/** 合并两类任务 id 空间（用于生成 id、冲突检测等）。 */
export function allSplitResultTaskItems(result: SplitResult): TaskItem[] {
  return [...result.splitTasks, ...result.executableTasks];
}

/**
 * 从持久化或 Claude 原始 JSON 规范化出 `splitTasks` / `executableTasks`。
 * - 新版：根级已有 `splitTasks` + `executableTasks`
 * - 旧版：单一 `tasks` 数组，按 `splitSourceTaskId` 拆成两表语义
 */
export function normalizeSplitResultTaskLists(value: unknown): { splitTasks: TaskItem[]; executableTasks: TaskItem[] } | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const legacy = o.tasks;
  const split = o.splitTasks;
  const exec = o.executableTasks;
  if (Array.isArray(split) && Array.isArray(exec)) {
    return { splitTasks: split as TaskItem[], executableTasks: exec as TaskItem[] };
  }
  if (Array.isArray(legacy)) {
    const tasks = legacy as TaskItem[];
    return {
      splitTasks: tasks.filter((t) => !t.splitSourceTaskId),
      executableTasks: tasks.filter((t) => Boolean(t.splitSourceTaskId)),
    };
  }
  return null;
}
