import type { MonitorDrawerTarget } from "../../types";
import type { ProgressMonitorPanelProps } from "./index";
import {
  employeeMonitorItemsFingerprint,
  monitorSessionsFingerprint,
  monitorTaskItemsFingerprint,
  teamMonitorItemsFingerprint,
} from "../../utils/monitorUiPropsFingerprints";
import { arePropsEqualSkipping } from "../../utils/reactPropsEqual";

function monitorTargetFingerprint(target: MonitorDrawerTarget | null | undefined): string {
  if (!target) return "";
  if (target.type === "team") return `team:${target.workflowId}`;
  if (target.type === "task") return `task:${target.taskId}`;
  return "";
}

/** 运行监控面板 memo：流式正文与 App 壳层回调不触发整面板重渲染。 */
export function progressMonitorPanelPropsEqual(
  prev: ProgressMonitorPanelProps,
  next: ProgressMonitorPanelProps,
): boolean {
  if (prev === next) return true;
  if (
    employeeMonitorItemsFingerprint(prev.employeeItems) !==
    employeeMonitorItemsFingerprint(next.employeeItems)
  ) {
    return false;
  }
  if (prev.repositoryMemberItems !== next.repositoryMemberItems) return false;
  if (
    teamMonitorItemsFingerprint(prev.teamItems) !== teamMonitorItemsFingerprint(next.teamItems)
  ) {
    return false;
  }
  if (
    monitorTaskItemsFingerprint(prev.sessionConversationTaskItems) !==
    monitorTaskItemsFingerprint(next.sessionConversationTaskItems)
  ) {
    return false;
  }
  if (prev.showSessionConversationTasks !== next.showSessionConversationTasks) return false;
  if (
    prev.executionEnvironmentDispatchHistoryDays !== next.executionEnvironmentDispatchHistoryDays
  ) {
    return false;
  }
  if (
    prev.executionEnvironmentDispatchHistoryDaysSaving !==
    next.executionEnvironmentDispatchHistoryDaysSaving
  ) {
    return false;
  }
  if (
    monitorSessionsFingerprint(prev.sessions) !== monitorSessionsFingerprint(next.sessions)
  ) {
    return false;
  }
  if (
    monitorSessionsFingerprint(prev.transcriptSourceSessions) !==
    monitorSessionsFingerprint(next.transcriptSourceSessions)
  ) {
    return false;
  }
  if (prev.activeSessionId !== next.activeSessionId) return false;
  if (
    monitorTargetFingerprint(prev.activeTarget) !== monitorTargetFingerprint(next.activeTarget)
  ) {
    return false;
  }
  if (prev.hideEmployeeUi !== next.hideEmployeeUi) return false;
  if (prev.projectId !== next.projectId) return false;
  if (prev.historyDrawerSessionId !== next.historyDrawerSessionId) return false;
  if (prev.repositoryMainBindings !== next.repositoryMainBindings) return false;
  if (prev.repositories !== next.repositories) return false;
  if (prev.sectionCollapsed !== next.sectionCollapsed) return false;
  if (prev.compactSidebarScrollRootRef !== next.compactSidebarScrollRootRef) return false;
  if (prev.monitorPanelVisibleRows !== next.monitorPanelVisibleRows) return false;
  return arePropsEqualSkipping(prev, next, {
    skipKeys: [
      "employeeItems",
      "repositoryMemberItems",
      "teamItems",
      "sessionConversationTaskItems",
      "sessions",
      "transcriptSourceSessions",
      "activeTarget",
    ],
    skipFunctions: true,
  });
}
