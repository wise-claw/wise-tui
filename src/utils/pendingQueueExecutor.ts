import type { EmployeeItem, PendingExecutionTask, Prompt } from "../types";
import { isOmcMonitorDispatchMentionName, isOmcMonitorEmployeeRecord } from "./omcMonitorEmployeeSession";

export const PENDING_QUEUE_MAIN_EXECUTOR_LABEL = "主会话";

function isAgentPillOmcDispatchRoute(normalizedName: string, employees?: readonly EmployeeItem[]): boolean {
  if (isOmcMonitorDispatchMentionName(normalizedName)) return true;
  if (!employees?.length) return false;
  const hit = employees.find((e) => e.enabled && e.name.trim() === normalizedName.trim());
  return Boolean(hit && isOmcMonitorEmployeeRecord(hit));
}

export interface PendingQueueTargetInfo {
  executorLabel: string;
  targetType: "main" | "employee" | "team";
  targetEmployeeName?: string;
  targetWorkflowId?: string;
  targetWorkflowName?: string;
}

/** 从编辑器段落推断「由谁执行」：优先 @员工 / 团队药丸，否则为主会话。 */
export function inferExecutorLabelFromPrompt(
  prompt: Prompt,
  _modelDisplayLabel?: string,
  employees?: readonly EmployeeItem[],
): string {
  return inferPendingQueueTargetFromPrompt(prompt, _modelDisplayLabel, employees).executorLabel;
}

/** 从编辑器段落推断队列调度目标。 */
export function inferPendingQueueTargetFromPrompt(
  prompt: Prompt,
  _modelDisplayLabel?: string,
  employees?: readonly EmployeeItem[],
): PendingQueueTargetInfo {
  for (const p of prompt) {
    if (p.type === "agent" && p.name?.trim()) {
      const n = p.name.trim();
      const normalized = n.startsWith("@") ? n.slice(1) : n;
      if (isAgentPillOmcDispatchRoute(normalized, employees)) {
        continue;
      }
      return {
        executorLabel: n.startsWith("@") ? n : `@${n}`,
        targetType: "employee",
        targetEmployeeName: normalized,
      };
    }
    if (p.type === "team" && p.name?.trim()) {
      return {
        executorLabel: `团队:${p.name.trim()}`,
        targetType: "team",
        targetWorkflowId: p.workflowId,
        targetWorkflowName: p.name.trim(),
      };
    }
  }
  return {
    executorLabel: PENDING_QUEUE_MAIN_EXECUTOR_LABEL,
    targetType: "main",
  };
}

/** 队列行展示：只显示执行体（主会话 / @员工 / 团队），不展示模型名。 */
export function resolvePendingQueueExecutorDisplayLabel(
  task: Pick<
    PendingExecutionTask,
    "executorLabel" | "targetType" | "targetEmployeeName" | "targetWorkflowName"
  >,
): string {
  const targetType = task.targetType ?? "main";
  if (targetType === "employee") {
    const name = task.targetEmployeeName?.trim();
    if (name) return name.startsWith("@") ? name : `@${name}`;
    return task.executorLabel;
  }
  if (targetType === "team") {
    const name = task.targetWorkflowName?.trim();
    return name ? `团队:${name}` : task.executorLabel;
  }
  return PENDING_QUEUE_MAIN_EXECUTOR_LABEL;
}
