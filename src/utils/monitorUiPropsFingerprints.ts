import type {
  ClaudeSession,
  EmployeeMonitorItem,
  MonitorStats,
  SessionConversationTaskItem,
  TeamMonitorItem,
} from "../types";
import { monitorSessionsOverviewFingerprint } from "../hooks/useMonitorSessionsForOverview";

export function monitorTaskItemsFingerprint(
  items: readonly SessionConversationTaskItem[] | undefined,
): string {
  if (!items?.length) return "0";
  return items
    .map((item) => `${item.key}|${item.status}|${item.updatedAt}`)
    .join("\n");
}

export function employeeMonitorItemsFingerprint(
  items: readonly EmployeeMonitorItem[] | undefined,
): string {
  if (!items?.length) return "0";
  return items
    .map((item) => `${item.employeeId}|${item.status}|${item.name}`)
    .join("\n");
}

export function teamMonitorItemsFingerprint(
  items: readonly TeamMonitorItem[] | undefined,
): string {
  if (!items?.length) return "0";
  return items
    .map((item) => `${item.workflowId}|${item.status}|${item.workflowName}`)
    .join("\n");
}

export function monitorStatsFingerprint(stats: MonitorStats | null | undefined): string {
  if (!stats) return "";
  return [
    stats.activeEmployees,
    stats.employeesInProgress,
    stats.employeesIdle,
    stats.teamsTotal,
    stats.teamsInProgress,
    stats.teamsIdle,
  ].join("|");
}

export function monitorSessionsFingerprint(
  sessions: readonly ClaudeSession[] | undefined,
): string {
  return monitorSessionsOverviewFingerprint(sessions ?? []);
}
