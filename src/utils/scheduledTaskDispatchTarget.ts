export type ScheduledTaskDispatchTargetType = "session" | "team";

/** 默认：每次新建独立会话执行（历史 key `main` 仍解析为此类）。 */
export const SCHEDULED_TASK_DISPATCH_NEW_SESSION = "session" as const;

/** @deprecated 使用 `SCHEDULED_TASK_DISPATCH_NEW_SESSION`；仍可作为历史/兼容 key。 */
export const SCHEDULED_TASK_DISPATCH_MAIN = SCHEDULED_TASK_DISPATCH_NEW_SESSION;

export function scheduledTaskDispatchTargetKey(task: {
  workflowId?: string | null;
}): string {
  const workflowId = task.workflowId?.trim();
  if (workflowId) return `team:${workflowId}`;
  return SCHEDULED_TASK_DISPATCH_NEW_SESSION;
}

export function parseScheduledTaskDispatchTargetKey(key: string): {
  type: ScheduledTaskDispatchTargetType;
  workflowId: string | null;
} {
  const normalized = key.trim();
  if (normalized.startsWith("team:")) {
    const workflowId = normalized.slice("team:".length).trim();
    return { type: "team", workflowId: workflowId || null };
  }
  // 兼容旧 key：main / employee:* 一律按新建会话处理（员工目标已下线）。
  return { type: "session", workflowId: null };
}

export function formatScheduledTaskDispatchTargetLabel(params: {
  workflowId?: string | null;
  workflowName?: string;
}): string {
  const workflowId = params.workflowId?.trim();
  if (workflowId) {
    return params.workflowName?.trim() ? `工作流：${params.workflowName.trim()}` : "团队工作流";
  }
  return "新建会话";
}
