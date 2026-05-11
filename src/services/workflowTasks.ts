import { invoke } from "@tauri-apps/api/core";
import type {
  AcceptanceVerdictSourceStatsItem,
  TaskPendingEmployeeItem,
  WorkflowTaskEventItem,
  WorkflowTaskItem,
} from "../types";

export async function createWorkflowTask(input: {
  title: string;
  content: string;
  creator: string;
  workflowId?: string;
}): Promise<WorkflowTaskItem> {
  return invoke<WorkflowTaskItem>("create_workflow_task", input);
}

export async function listWorkflowTasks(creator?: string): Promise<WorkflowTaskItem[]> {
  return invoke<WorkflowTaskItem[]>("list_workflow_tasks", { creator });
}

/** Claude 标签 id 合并后同步 SQLite：`tasks.creator`、`workflow_runs` 与 payload 内 `sessionId`，供 OMC/团队监控与执行详情跳转。 */
export async function migrateWorkflowSessionTabReferences(input: {
  fromTabId: string;
  toSessionId: string;
}): Promise<void> {
  const fromTabId = input.fromTabId.trim();
  const toSessionId = input.toSessionId.trim();
  if (!fromTabId || !toSessionId || fromTabId === toSessionId) return;
  await invoke<void>("migrate_workflow_session_tab_references", { fromTabId, toSessionId });
}

export async function listTaskEvents(taskId: string): Promise<WorkflowTaskEventItem[]> {
  return invoke<WorkflowTaskEventItem[]>("list_task_events", { taskId });
}

export async function listTaskPendingEmployees(taskId: string): Promise<TaskPendingEmployeeItem[]> {
  return invoke<TaskPendingEmployeeItem[]>("list_task_pending_employees", { taskId });
}

export async function decideWorkflowTaskStage(input: {
  taskId: string;
  employeeId: string;
  decision: "approved" | "rejected";
  reason?: string;
}): Promise<WorkflowTaskItem> {
  return invoke<WorkflowTaskItem>("decide_workflow_task_stage", input);
}

export async function endWorkflowTask(input: {
  taskId: string;
  reason?: string;
}): Promise<WorkflowTaskItem> {
  return invoke<WorkflowTaskItem>("end_workflow_task", input);
}

export async function appendTaskEvent(input: {
  taskId: string;
  eventType: string;
  payloadJson: string;
}): Promise<WorkflowTaskEventItem> {
  return invoke<WorkflowTaskEventItem>("append_task_event", input);
}

export async function getAcceptanceVerdictSourceStats(taskId?: string): Promise<AcceptanceVerdictSourceStatsItem[]> {
  return invoke<AcceptanceVerdictSourceStatsItem[]>("get_acceptance_verdict_source_stats", { taskId });
}
