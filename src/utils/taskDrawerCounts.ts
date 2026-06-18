import type { TaskItem } from "../types";

export function countDrawerWiseTodoTasks(tasks: readonly TaskItem[]): number {
  return tasks.filter((task) => {
    const status = task.flowStatus?.trim().toLowerCase() ?? "";
    return status === "todo" || status === "in_progress" || status === "pending";
  }).length;
}

export function countDrawerExecutableTasks(
  splitTodoTasks: readonly TaskItem[],
): { wiseTodo: number; total: number } {
  const wiseTodo = countDrawerWiseTodoTasks(splitTodoTasks);
  return { wiseTodo, total: wiseTodo };
}
