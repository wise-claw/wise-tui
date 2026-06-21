import type { MonitorDrawerTarget } from "../../types";
import {
  employeeMonitorItemsFingerprint,
  monitorSessionsFingerprint,
  teamMonitorItemsFingerprint,
} from "../../utils/monitorUiPropsFingerprints";
import { arePropsEqualSkipping } from "../../utils/reactPropsEqual";

function monitorTargetFingerprint(target: MonitorDrawerTarget | null | undefined): string {
  if (!target) return "";
  if (target.type === "team") return `team:${target.workflowId}`;
  if (target.type === "task") return `task:${target.taskId}`;
  return "";
}

/** 监控抽屉关闭时不比较重 props，避免 App 壳层抖动触发整抽屉 reconcile。 */
export function progressMonitorDrawerPropsEqual(
  prev: import("../ProgressMonitorDrawer").ProgressMonitorDrawerProps,
  next: import("../ProgressMonitorDrawer").ProgressMonitorDrawerProps,
): boolean {
  if (prev.open !== next.open) return false;
  if (monitorTargetFingerprint(prev.target) !== monitorTargetFingerprint(next.target)) return false;
  if (!prev.open && !next.open) {
    return arePropsEqualSkipping(prev, next, {
      skipKeys: ["open", "target"],
      skipFunctions: true,
    });
  }
  if (
    employeeMonitorItemsFingerprint(prev.employeeItems) !==
    employeeMonitorItemsFingerprint(next.employeeItems)
  ) {
    return false;
  }
  if (
    teamMonitorItemsFingerprint(prev.teamItems) !== teamMonitorItemsFingerprint(next.teamItems)
  ) {
    return false;
  }
  if (
    monitorSessionsFingerprint(prev.sessions) !== monitorSessionsFingerprint(next.sessions)
  ) {
    return false;
  }
  if (prev.workflowTasks !== next.workflowTasks) return false;
  if (prev.workflowTaskEventsByTaskId !== next.workflowTaskEventsByTaskId) return false;
  if (prev.workflowRuntimeSnapshotsByTaskId !== next.workflowRuntimeSnapshotsByTaskId) return false;
  if (prev.taskPendingEmployeesByTaskId !== next.taskPendingEmployeesByTaskId) return false;
  if (prev.employees !== next.employees) return false;
  if (prev.workflowTemplates !== next.workflowTemplates) return false;
  if (prev.workflowGraphsByWorkflowId !== next.workflowGraphsByWorkflowId) return false;
  return arePropsEqualSkipping(prev, next, {
    skipKeys: [
      "open",
      "target",
      "employeeItems",
      "teamItems",
      "sessions",
      "workflowTasks",
      "workflowTaskEventsByTaskId",
      "workflowRuntimeSnapshotsByTaskId",
      "taskPendingEmployeesByTaskId",
      "employees",
      "workflowTemplates",
      "workflowGraphsByWorkflowId",
    ],
    skipFunctions: true,
  });
}

export function monitorHistoryTranscriptDrawerPropsEqual(
  prev: import("./MonitorHistorySessionTranscriptDrawer").MonitorHistorySessionTranscriptDrawerProps,
  next: import("./MonitorHistorySessionTranscriptDrawer").MonitorHistorySessionTranscriptDrawerProps,
): boolean {
  if (prev.open !== next.open) return false;
  if (prev.sessionId !== next.sessionId) return false;
  if (!prev.open && !next.open) {
    return arePropsEqualSkipping(prev, next, {
      skipKeys: ["open", "sessionId", "transcriptSourceSessions"],
      skipFunctions: true,
    });
  }
  if (
    monitorSessionsFingerprint(prev.transcriptSourceSessions) !==
    monitorSessionsFingerprint(next.transcriptSourceSessions)
  ) {
    return false;
  }
  return arePropsEqualSkipping(prev, next, {
    skipKeys: ["open", "sessionId", "transcriptSourceSessions"],
    skipFunctions: true,
  });
}
