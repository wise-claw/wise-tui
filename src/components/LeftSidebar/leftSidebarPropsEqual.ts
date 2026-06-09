import type { LeftSidebarProps } from "./types";
import { monitorSessionsOverviewFingerprint } from "../../hooks/useMonitorSessionsForOverview";

export type LeftSidebarContentProps = Omit<
  LeftSidebarProps,
  "dark" | "collapsed" | "siderWidth" | "parked" | "onOpenActiveRepositoryFile"
>;

function monitorTaskItemsFingerprint(
  items: LeftSidebarProps["sessionConversationTaskItems"],
): string {
  if (!items?.length) return "0";
  return items
    .map((item) => `${item.key}|${item.status}|${item.updatedAt}`)
    .join("\n");
}

function employeeMonitorItemsFingerprint(
  items: LeftSidebarProps["employeeMonitorItems"],
): string {
  if (!items?.length) return "0";
  return items
    .map((item) => `${item.employeeId}|${item.status}|${item.name}`)
    .join("\n");
}

function teamMonitorItemsFingerprint(
  items: LeftSidebarProps["teamMonitorItems"],
): string {
  if (!items?.length) return "0";
  return items
    .map((item) => `${item.workflowId}|${item.status}|${item.workflowName}`)
    .join("\n");
}

/** 侧栏内容 props memo：不含 `dark` / `collapsed` 等壳层字段。 */
export function areLeftSidebarContentPropsEqual(
  prev: LeftSidebarContentProps,
  next: LeftSidebarContentProps,
): boolean {
  if (prev === next) return true;
  if (prev.sessionsStructureKey !== next.sessionsStructureKey) return false;
  if (
    monitorSessionsOverviewFingerprint(prev.monitorPanelSessions ?? []) !==
    monitorSessionsOverviewFingerprint(next.monitorPanelSessions ?? [])
  ) {
    return false;
  }
  if (
    monitorTaskItemsFingerprint(prev.sessionConversationTaskItems) !==
    monitorTaskItemsFingerprint(next.sessionConversationTaskItems)
  ) {
    return false;
  }
  if (
    employeeMonitorItemsFingerprint(prev.employeeMonitorItems) !==
    employeeMonitorItemsFingerprint(next.employeeMonitorItems)
  ) {
    return false;
  }
  if (prev.activeSessionId !== next.activeSessionId) return false;
  if (prev.activeProjectId !== next.activeProjectId) return false;
  if (prev.activeRepositoryId !== next.activeRepositoryId) return false;
  if (prev.activeWorkspaceFocus !== next.activeWorkspaceFocus) return false;
  if (prev.showLeftSidebarMonitorPanel !== next.showLeftSidebarMonitorPanel) return false;
  if (prev.historyDrawerSessionId !== next.historyDrawerSessionId) return false;
  if (prev.monitorActiveTarget !== next.monitorActiveTarget) return false;
  if (
    teamMonitorItemsFingerprint(prev.teamMonitorItems) !==
    teamMonitorItemsFingerprint(next.teamMonitorItems)
  ) {
    return false;
  }
  if (prev.repositoryMemberMonitorItems !== next.repositoryMemberMonitorItems) return false;
  if (prev.projects !== next.projects) return false;
  if (prev.repositories !== next.repositories) return false;
  if (prev.floatingRepositories !== next.floatingRepositories) return false;
  if (prev.repositoryMainSessionBindings !== next.repositoryMainSessionBindings) return false;
  if (prev.pinnedProjectIds !== next.pinnedProjectIds) return false;
  if (prev.leftSidebarHubQuickEntryIds !== next.leftSidebarHubQuickEntryIds) return false;
  if (prev.executionEnvironmentDispatchHistoryDays !== next.executionEnvironmentDispatchHistoryDays) return false;
  if (prev.hideEmployeeUi !== next.hideEmployeeUi) return false;
  if (prev.mcpHubActive !== next.mcpHubActive) return false;
  if (prev.skillsHubActive !== next.skillsHubActive) return false;
  if (prev.automationHubActive !== next.automationHubActive) return false;
  if (prev.assistantsHubActive !== next.assistantsHubActive) return false;
  if (prev.claudePluginsHubActive !== next.claudePluginsHubActive) return false;
  if (prev.authorDisabled !== next.authorDisabled) return false;
  if (prev.workspaceCreateRequest !== next.workspaceCreateRequest) return false;
  if (prev.standaloneRepoAddRequest !== next.standaloneRepoAddRequest) return false;
  if (prev.gitPanelPlacement !== next.gitPanelPlacement) return false;
  if (prev.filesPanelPlacement !== next.filesPanelPlacement) return false;
  if (prev.activeRepositoryPath !== next.activeRepositoryPath) return false;
  if (prev.activeRepositoryName !== next.activeRepositoryName) return false;
  if (prev.repoPanelRightRailAvailable !== next.repoPanelRightRailAvailable) return false;
  return true;
}

/** 侧栏 memo：流式正文增长时 `sessions` 引用会变，但结构指纹不变则跳过重渲染。 */
export function areLeftSidebarPropsEqual(
  prev: LeftSidebarProps,
  next: LeftSidebarProps,
): boolean {
  if (prev.dark !== next.dark) return false;
  if (prev.collapsed !== next.collapsed) return false;
  if (prev.parked !== next.parked) return false;
  if (prev.siderWidth !== next.siderWidth) return false;
  return areLeftSidebarContentPropsEqual(prev, next);
}
