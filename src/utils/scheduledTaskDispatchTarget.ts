export type ScheduledTaskDispatchTargetType = "main" | "employee" | "team";

export const SCHEDULED_TASK_DISPATCH_MAIN = "main" as const;

export function scheduledTaskDispatchTargetKey(task: {
  employeeId?: string | null;
  workflowId?: string | null;
}): string {
  const workflowId = task.workflowId?.trim();
  if (workflowId) return `team:${workflowId}`;
  const employeeId = task.employeeId?.trim();
  if (employeeId) return `employee:${employeeId}`;
  return SCHEDULED_TASK_DISPATCH_MAIN;
}

export function parseScheduledTaskDispatchTargetKey(key: string): {
  type: ScheduledTaskDispatchTargetType;
  employeeId: string | null;
  workflowId: string | null;
} {
  const normalized = key.trim();
  if (normalized.startsWith("employee:")) {
    const employeeId = normalized.slice("employee:".length).trim();
    return { type: "employee", employeeId: employeeId || null, workflowId: null };
  }
  if (normalized.startsWith("team:")) {
    const workflowId = normalized.slice("team:".length).trim();
    return { type: "team", employeeId: null, workflowId: workflowId || null };
  }
  return { type: "main", employeeId: null, workflowId: null };
}

export function formatScheduledTaskDispatchTargetLabel(params: {
  employeeId?: string | null;
  workflowId?: string | null;
  employeeName?: string;
  workflowName?: string;
}): string {
  const workflowId = params.workflowId?.trim();
  if (workflowId) {
    return params.workflowName?.trim() ? `团队：${params.workflowName.trim()}` : "团队工作流";
  }
  const employeeId = params.employeeId?.trim();
  if (employeeId) {
    return params.employeeName?.trim() ? `员工：${params.employeeName.trim()}` : "员工";
  }
  return "主会话";
}
