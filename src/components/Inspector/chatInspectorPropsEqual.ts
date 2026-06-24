import {
  employeeMonitorItemsFingerprint,
  monitorSessionsFingerprint,
  monitorStatsFingerprint,
  monitorTaskItemsFingerprint,
  teamMonitorItemsFingerprint,
} from "../../utils/monitorUiPropsFingerprints";
import { arePropsEqualSkipping } from "../../utils/reactPropsEqual";
import type { ChatInspectorProps } from "./ChatInspector";
import type { CockpitInspectorProps } from "./CockpitInspector";

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
    monitorSessionsFingerprint(prev.monitorPanelSessions) !==
      monitorSessionsFingerprint(next.monitorPanelSessions)
  ) {
    return false;
  }
  if (
    prev.monitorTranscriptSourceSessions !== next.monitorTranscriptSourceSessions &&
    monitorSessionsFingerprint(prev.monitorTranscriptSourceSessions) !==
      monitorSessionsFingerprint(next.monitorTranscriptSourceSessions)
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
  if (prev.rightTerminalPanelNode !== next.rightTerminalPanelNode) return false;
  return true;
}

export function areCockpitInspectorPropsEqual(
  prev: CockpitInspectorProps,
  next: CockpitInspectorProps,
): boolean {
  if (prev.dark !== next.dark) return false;
  if (prev.collapsed !== next.collapsed) return false;
  if (prev.siderWidth !== next.siderWidth) return false;
  if (prev.activeProject !== next.activeProject) return false;
  if (prev.activeProjectId !== next.activeProjectId) return false;
  if (prev.activeRepositoryId !== next.activeRepositoryId) return false;
  if (prev.activeRepositoryName !== next.activeRepositoryName) return false;
  if (
    employeeMonitorItemsFingerprint(prev.employeeMonitorItems) !==
    employeeMonitorItemsFingerprint(next.employeeMonitorItems)
  ) {
    return false;
  }
  return arePropsEqualSkipping(prev, next, {
    skipKeys: ["employeeMonitorItems"],
    skipFunctions: true,
  });
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
  return areCockpitInspectorPropsEqual(prev.cockpitInspectorProps, next.cockpitInspectorProps);
}
