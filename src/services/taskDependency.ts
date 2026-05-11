import type { TaskItem } from "../types";

export function buildParallelGroups(tasks: TaskItem[]): string[][] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const task of tasks) {
    indegree.set(task.id, task.dependencies.length);
    for (const dep of task.dependencies) {
      if (!byId.has(dep)) continue;
      const list = outgoing.get(dep) ?? [];
      list.push(task.id);
      outgoing.set(dep, list);
    }
  }

  const groups: string[][] = [];
  let frontier = Array.from(indegree.entries())
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id);

  while (frontier.length > 0) {
    groups.push(frontier);
    const next: string[] = [];
    for (const node of frontier) {
      for (const child of outgoing.get(node) ?? []) {
        const degree = (indegree.get(child) ?? 0) - 1;
        indegree.set(child, degree);
        if (degree === 0) next.push(child);
      }
    }
    frontier = next;
  }

  return groups;
}

export function buildCriticalPath(tasks: TaskItem[]): string[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const memo = new Map<string, string[]>();

  function dfs(taskId: string, stack: Set<string>): string[] {
    if (memo.has(taskId)) return memo.get(taskId) ?? [];
    if (stack.has(taskId)) return [taskId];

    const task = taskById.get(taskId);
    if (!task) return [taskId];

    stack.add(taskId);
    let bestPath: string[] = [taskId];

    for (const dep of task.dependencies) {
      if (!taskById.has(dep)) continue;
      const candidate = [...dfs(dep, stack), taskId];
      if (candidate.length > bestPath.length) bestPath = candidate;
    }

    stack.delete(taskId);
    memo.set(taskId, bestPath);
    return bestPath;
  }

  let result: string[] = [];
  for (const task of tasks) {
    const path = dfs(task.id, new Set<string>());
    if (path.length > result.length) result = path;
  }
  return result;
}

export function validateTaskDependencies(tasks: TaskItem[]): string | null {
  const taskIds = new Set(tasks.map((task) => task.id));

  for (const task of tasks) {
    if (task.dependencies.includes(task.id)) {
      return `任务 ${task.id} 不能依赖自己`;
    }
    for (const dep of task.dependencies) {
      if (!taskIds.has(dep)) {
        return `任务 ${task.id} 依赖了不存在的任务 ${dep}`;
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(tasks.map((task) => [task.id, task]));

  function hasCycle(node: string): boolean {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    const task = byId.get(node);
    if (task) {
      for (const dep of task.dependencies) {
        if (hasCycle(dep)) return true;
      }
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }

  for (const task of tasks) {
    if (hasCycle(task.id)) return "依赖关系存在环，请检查任务前置关系";
  }

  return null;
}
