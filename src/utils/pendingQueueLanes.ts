import type { PendingExecutionTask } from "../types";

/** 执行体车道：主会话 / 单终端 / 单团队流程各自独立 FIFO。 */
export function pendingTaskExecutorLaneKey(task: PendingExecutionTask): string {
  const targetType = task.targetType ?? "main";
  if (targetType === "employee") {
    const name = (task.targetEmployeeName ?? task.executorLabel).trim().replace(/^@/, "");
    return `employee:${name || "unknown"}`;
  }
  if (targetType === "team") {
    const id = (task.targetWorkflowId ?? task.targetWorkflowName ?? task.executorLabel).trim();
    return `team:${id || "unknown"}`;
  }
  return "main";
}

/** 每个执行体车道在全局队列中的队首（按入队顺序保留 FIFO）。 */
export function findHeadTaskPerLane(tasks: readonly PendingExecutionTask[]): Map<string, PendingExecutionTask> {
  const heads = new Map<string, PendingExecutionTask>();
  for (const task of tasks) {
    const key = pendingTaskExecutorLaneKey(task);
    if (!heads.has(key)) {
      heads.set(key, task);
    }
  }
  return heads;
}

/** 各车道队首里当前可派发的任务（允许多车道并行出队）。 */
export function findDispatchableHeadTasksPerLane(
  tasks: readonly PendingExecutionTask[],
  canDispatch: (task: PendingExecutionTask) => boolean,
): PendingExecutionTask[] {
  const heads = findHeadTaskPerLane(tasks);
  const result: PendingExecutionTask[] = [];
  for (const task of heads.values()) {
    if (canDispatch(task)) {
      result.push(task);
    }
  }
  return result;
}

/** 按全局入队顺序找第一条「车道队首且可派发」的任务（手动「发送下一项」）。 */
export function findNextDispatchableLaneHead(
  tasks: readonly PendingExecutionTask[],
  canDispatch: (task: PendingExecutionTask) => boolean,
): PendingExecutionTask | null {
  const heads = findHeadTaskPerLane(tasks);
  for (const task of tasks) {
    const key = pendingTaskExecutorLaneKey(task);
    const head = heads.get(key);
    if (head?.id !== task.id) continue;
    if (canDispatch(task)) {
      return task;
    }
  }
  return null;
}

/** 主会话车道队首（用于「本轮结束后发送」仅阻塞主会话，不影响终端/团队）。 */
export function findMainLaneHead(tasks: readonly PendingExecutionTask[]): PendingExecutionTask | undefined {
  return tasks.find((task) => (task.targetType ?? "main") === "main");
}
