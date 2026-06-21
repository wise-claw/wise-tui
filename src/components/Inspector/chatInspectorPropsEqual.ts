import { monitorSessionsOverviewFingerprint } from "../../hooks/useMonitorSessionsForOverview";
import { arePropsEqualSkipping } from "../../utils/reactPropsEqual";
import type { ChatInspectorProps } from "./ChatInspector";
import type { CockpitInspectorProps } from "./CockpitInspector";

function monitorTaskItemsFingerprint(
  items: ChatInspectorProps["sessionConversationTaskItems"],
): string {
  if (!items?.length) return "0";
  return items
    .map((item) => `${item.key}|${item.status}|${item.updatedAt}`)
    .join("\n");
}

function employeeMonitorItemsFingerprint(
  items: ChatInspectorProps["employeeMonitorItems"],
): string {
  if (!items?.length) return "0";
  return items
    .map((item) => `${item.employeeId}|${item.status}|${item.name}`)
    .join("\n");
}

function teamMonitorItemsFingerprint(items: ChatInspectorProps["teamMonitorItems"]): string {
  if (!items?.length) return "0";
  return items
    .map((item) => `${item.workflowId}|${item.status}|${item.workflowName}`)
    .join("\n");
}

function monitorStatsFingerprint(stats: ChatInspectorProps["monitorStats"]): string {
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

/** ChatInspector memo：流式正文与 App 壳层新建回调不触发右栏整树重渲染。 */
export function areChatInspectorPropsEqual(
  prev: ChatInspectorProps,
  next: ChatInspectorProps,
): boolean {
  if (prev === next) return true;
  if (prev.dark !== next.dark) return false;
  if (prev.collapsed !== next.collapsed) return false;
  if (prev.siderWidth !== next.siderWidth) return false;
  if (monitorStatsFingerprint(prev.monitorStats) !== monitorStatsFingerprint(next.monitorStats)) {
    return false;
  }
  if (
    prev.monitorPanelSessions !== next.monitorPanelSessions &&
    monitorSessionsOverviewFingerprint(prev.monitorPanelSessions ?? []) !==
      monitorSessionsOverviewFingerprint(next.monitorPanelSessions ?? [])
  ) {
    return false;
  }
  if (
    prev.monitorTranscriptSourceSessions !== next.monitorTranscriptSourceSessions &&
    monitorSessionsOverviewFingerprint(prev.monitorTranscriptSourceSessions ?? []) !==
      monitorSessionsOverviewFingerprint(next.monitorTranscriptSourceSessions ?? [])
  ) {
    return false;
  }
  if (
    prev.sessionConversationTaskItems !== next.sessionConversationTaskItems &&
    monitorTaskItemsFingerprint(prev.sessionConversationTaskItems) !==
      monitorTaskItemsFingerprint(next.sessionConversationTaskItems)
  ) {
    return false;
  }
  if (
    prev.employeeMonitorItems !== next.employeeMonitorItems &&
    employeeMonitorItemsFingerprint(prev.employeeMonitorItems) !==
      employeeMonitorItemsFingerprint(next.employeeMonitorItems)
  ) {
    return false;
  }
  if (
    prev.teamMonitorItems !== next.teamMonitorItems &&
    teamMonitorItemsFingerprint(prev.teamMonitorItems) !==
      teamMonitorItemsFingerprint(next.teamMonitorItems)
  ) {
    return false;
  }
  if (prev.repositoryMemberMonitorItems !== next.repositoryMemberMonitorItems) return false;
  if (prev.executionEnvironmentDispatchHistoryDays !== next.executionEnvironmentDispatchHistoryDays) {
    return false;
  }
  if (
    prev.executionEnvironmentDispatchHistoryDaysSaving !==
    next.executionEnvironmentDispatchHistoryDaysSaving
  ) {
    return false;
  }
  if (prev.monitorActiveTarget !== next.monitorActiveTarget) return false;
  if (prev.hideEmployeeUi !== next.hideEmployeeUi) return false;
  if (prev.projectId !== next.projectId) return false;
  if (prev.historyDrawerSessionId !== next.historyDrawerSessionId) return false;
  if (prev.activeProjectName !== next.activeProjectName) return false;
  if (prev.activeRepositoryName !== next.activeRepositoryName) return false;
  if (prev.activeRepositoryId !== next.activeRepositoryId) return false;
  if (prev.repositoryMainBindings !== next.repositoryMainBindings) return false;
  if (prev.repositories !== next.repositories) return false;
  if (prev.repositoryRepoPanel !== next.repositoryRepoPanel) return false;
  return true;
}

export function areInspectorShellPropsEqual(
  prev: {
    viewMode: import("../../types/viewMode").ViewMode;
    chatInspectorProps: ChatInspectorProps;
    cockpitInspectorProps: CockpitInspectorProps;
  },
  next: {
    viewMode: import("../../types/viewMode").ViewMode;
    chatInspectorProps: ChatInspectorProps;
    cockpitInspectorProps: CockpitInspectorProps;
  },
): boolean {
  if (prev.viewMode !== next.viewMode) return false;
  if (!areChatInspectorPropsEqual(prev.chatInspectorProps, next.chatInspectorProps)) return false;
  if (
    employeeMonitorItemsFingerprint(prev.cockpitInspectorProps.employeeMonitorItems) !==
    employeeMonitorItemsFingerprint(next.cockpitInspectorProps.employeeMonitorItems)
  ) {
    return false;
  }
  return arePropsEqualSkipping(prev.cockpitInspectorProps, next.cockpitInspectorProps, {
    skipKeys: ["employeeMonitorItems"],
    skipFunctions: true,
  });
}
