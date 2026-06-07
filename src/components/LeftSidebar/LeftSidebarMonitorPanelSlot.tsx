import { memo, useRef } from "react";
import type { LeftSidebarProps } from "./types";
import type { ClaudeSession } from "../../types";
import { LEFT_SIDEBAR_SCROLLING_CLASS } from "../../constants/leftSidebarScrollPerformance";
import { useScrollEndClass } from "../../hooks/useScrollEndClass";
import { ProgressMonitorPanel } from "../ProgressMonitorPanel";

export type LeftSidebarMonitorPanelSlotProps = {
  visible?: boolean;
  monitorPanelSectionCollapsed: boolean;
  onMonitorPanelSectionCollapsedChange: (collapsed: boolean) => void;
  monitorPanelSessions: ClaudeSession[];
  transcriptSourceSessions: ClaudeSession[];
  employeeMonitorItems: LeftSidebarProps["employeeMonitorItems"];
  repositoryMemberMonitorItems: LeftSidebarProps["repositoryMemberMonitorItems"];
  sessionConversationTaskItems: LeftSidebarProps["sessionConversationTaskItems"];
  showSessionConversationTasks?: boolean;
  executionEnvironmentDispatchHistoryDays?: LeftSidebarProps["executionEnvironmentDispatchHistoryDays"];
  onExecutionEnvironmentDispatchHistoryDaysChange?: LeftSidebarProps["onExecutionEnvironmentDispatchHistoryDaysChange"];
  executionEnvironmentDispatchHistoryDaysSaving?: LeftSidebarProps["executionEnvironmentDispatchHistoryDaysSaving"];
  teamMonitorItems: LeftSidebarProps["teamMonitorItems"];
  activeSessionId: LeftSidebarProps["activeSessionId"];
  monitorActiveTarget: LeftSidebarProps["monitorActiveTarget"];
  onOpenTeamMonitorDetail?: LeftSidebarProps["onOpenTeamMonitorDetail"];
  onOpenEmployeeConfig?: LeftSidebarProps["onOpenEmployeeConfig"];
  onOpenWorkflowConfig?: LeftSidebarProps["onOpenWorkflowConfig"];
  onStopEmployeeMonitor?: LeftSidebarProps["onStopEmployeeMonitor"];
  onStopTeamMonitor?: LeftSidebarProps["onStopTeamMonitor"];
  hideEmployeeUi?: LeftSidebarProps["hideEmployeeUi"];
  onCancelSessionFromMonitor?: LeftSidebarProps["onCancelSessionFromMonitor"];
  onOpenTaskDetailFromMonitor?: LeftSidebarProps["onOpenTaskDetailFromMonitor"];
  onOpenOmcBatchInvocationDetail?: LeftSidebarProps["onOpenOmcBatchInvocationDetail"];
  onCancelOmcDirectBatchInvocation?: LeftSidebarProps["onCancelOmcDirectBatchInvocation"];
  onStopSessionConversationTask?: LeftSidebarProps["onStopSessionConversationTask"];
  onReloadFullDiskTranscript?: LeftSidebarProps["onReloadFullDiskTranscript"];
  onCompactSessionHistory?: LeftSidebarProps["onCompactSessionHistory"];
  projectId?: LeftSidebarProps["projectId"];
  historyDrawerSessionId?: LeftSidebarProps["historyDrawerSessionId"];
  onHistoryDrawerSessionIdChange?: LeftSidebarProps["onHistoryDrawerSessionIdChange"];
  onRestoreHistorySessionAsMain?: LeftSidebarProps["onRestoreHistorySessionAsMain"];
  onResumeSession?: LeftSidebarProps["onResumeSession"];
  onPrepareSessionForMonitorDrawer?: LeftSidebarProps["onPrepareSessionForMonitorDrawer"];
  repositoryMainSessionBindings: LeftSidebarProps["repositoryMainSessionBindings"];
  repositories: LeftSidebarProps["repositories"];
  /** 由 LeftSidebar useMemo 预计算，避免 memo 比较时重复扫描 sessions。 */
  monitorSessionsFingerprint: string;
  transcriptSessionsFingerprint: string;
};

function monitorTaskItemsFingerprint(
  items: LeftSidebarMonitorPanelSlotProps["sessionConversationTaskItems"],
): string {
  if (!items?.length) return "0";
  return items
    .map((item) => `${item.key}|${item.status}|${item.updatedAt}`)
    .join("\n");
}

function employeeMonitorItemsFingerprint(
  items: LeftSidebarMonitorPanelSlotProps["employeeMonitorItems"],
): string {
  if (!items?.length) return "0";
  return items
    .map((item) => `${item.employeeId}|${item.status}|${item.name}`)
    .join("\n");
}

function teamMonitorItemsFingerprint(
  items: LeftSidebarMonitorPanelSlotProps["teamMonitorItems"],
): string {
  if (!items?.length) return "0";
  return items
    .map((item) => `${item.workflowId}|${item.status}|${item.workflowName}`)
    .join("\n");
}

function repositoryMemberMonitorItemsFingerprint(
  items: LeftSidebarMonitorPanelSlotProps["repositoryMemberMonitorItems"],
): string {
  if (!items?.length) return "0";
  return items.map((item) => `${item.repositoryPath}|${item.subagents.length}`).join("\n");
}

function monitorPanelPropsEqual(
  prev: LeftSidebarMonitorPanelSlotProps,
  next: LeftSidebarMonitorPanelSlotProps,
): boolean {
  return (
    prev.visible === next.visible &&
    prev.monitorPanelSectionCollapsed === next.monitorPanelSectionCollapsed &&
    prev.onMonitorPanelSectionCollapsedChange === next.onMonitorPanelSectionCollapsedChange &&
    prev.monitorSessionsFingerprint === next.monitorSessionsFingerprint &&
    prev.transcriptSessionsFingerprint === next.transcriptSessionsFingerprint &&
    employeeMonitorItemsFingerprint(prev.employeeMonitorItems) ===
      employeeMonitorItemsFingerprint(next.employeeMonitorItems) &&
    repositoryMemberMonitorItemsFingerprint(prev.repositoryMemberMonitorItems) ===
      repositoryMemberMonitorItemsFingerprint(next.repositoryMemberMonitorItems) &&
    teamMonitorItemsFingerprint(prev.teamMonitorItems) ===
      teamMonitorItemsFingerprint(next.teamMonitorItems) &&
    prev.activeSessionId === next.activeSessionId &&
    prev.monitorActiveTarget === next.monitorActiveTarget &&
    prev.executionEnvironmentDispatchHistoryDays === next.executionEnvironmentDispatchHistoryDays &&
    prev.executionEnvironmentDispatchHistoryDaysSaving ===
      next.executionEnvironmentDispatchHistoryDaysSaving &&
    prev.hideEmployeeUi === next.hideEmployeeUi &&
    prev.projectId === next.projectId &&
    prev.historyDrawerSessionId === next.historyDrawerSessionId &&
    monitorTaskItemsFingerprint(prev.sessionConversationTaskItems) ===
      monitorTaskItemsFingerprint(next.sessionConversationTaskItems)
  );
}

export const LeftSidebarMonitorPanelSlot = memo(function LeftSidebarMonitorPanelSlot({
  visible = true,
  monitorPanelSectionCollapsed,
  onMonitorPanelSectionCollapsedChange,
  monitorPanelSessions,
  transcriptSourceSessions,
  sessionConversationTaskItems,
  showSessionConversationTasks,
  employeeMonitorItems,
  repositoryMemberMonitorItems,
  teamMonitorItems,
  activeSessionId,
  monitorActiveTarget,
  onOpenTeamMonitorDetail,
  onOpenEmployeeConfig,
  onOpenWorkflowConfig,
  onStopEmployeeMonitor,
  onStopTeamMonitor,
  hideEmployeeUi,
  onCancelSessionFromMonitor,
  onOpenTaskDetailFromMonitor,
  onOpenOmcBatchInvocationDetail,
  onCancelOmcDirectBatchInvocation,
  onStopSessionConversationTask,
  onReloadFullDiskTranscript,
  onCompactSessionHistory,
  projectId,
  historyDrawerSessionId,
  onHistoryDrawerSessionIdChange,
  onRestoreHistorySessionAsMain,
  onResumeSession,
  onPrepareSessionForMonitorDrawer,
  repositoryMainSessionBindings,
  repositories,
  executionEnvironmentDispatchHistoryDays,
  onExecutionEnvironmentDispatchHistoryDaysChange,
  executionEnvironmentDispatchHistoryDaysSaving,
  monitorSessionsFingerprint: _monitorSessionsFingerprint,
  transcriptSessionsFingerprint: _transcriptSessionsFingerprint,
}: LeftSidebarMonitorPanelSlotProps) {
  const scrollRootRef = useRef<HTMLDivElement>(null);
  useScrollEndClass(scrollRootRef, LEFT_SIDEBAR_SCROLLING_CLASS);

  return (
    <div
      ref={scrollRootRef}
      className={
        "app-left-sidebar-monitor-panel" +
        (monitorPanelSectionCollapsed ? " app-left-sidebar-monitor-panel--section-collapsed" : "") +
        (!visible ? " app-left-sidebar-monitor-panel--hidden" : "")
      }
      hidden={!visible ? true : undefined}
      aria-hidden={!visible ? true : undefined}
    >
      <ProgressMonitorPanel
        compactSidebarScrollRootRef={scrollRootRef}
        sectionCollapsed={monitorPanelSectionCollapsed}
        onSectionCollapsedChange={onMonitorPanelSectionCollapsedChange}
        sessions={monitorPanelSessions}
        transcriptSourceSessions={transcriptSourceSessions}
        sessionConversationTaskItems={sessionConversationTaskItems ?? []}
        showSessionConversationTasks={showSessionConversationTasks}
        executionEnvironmentDispatchHistoryDays={executionEnvironmentDispatchHistoryDays}
        onExecutionEnvironmentDispatchHistoryDaysChange={
          onExecutionEnvironmentDispatchHistoryDaysChange
        }
        executionEnvironmentDispatchHistoryDaysSaving={executionEnvironmentDispatchHistoryDaysSaving}
        employeeItems={employeeMonitorItems ?? []}
        repositoryMemberItems={repositoryMemberMonitorItems ?? []}
        teamItems={teamMonitorItems ?? []}
        activeSessionId={activeSessionId}
        activeTarget={monitorActiveTarget}
        onOpenTeamDetail={onOpenTeamMonitorDetail}
        onOpenEmployeeConfig={onOpenEmployeeConfig}
        onOpenWorkflowConfig={onOpenWorkflowConfig}
        onStopEmployee={onStopEmployeeMonitor}
        onStopTeam={onStopTeamMonitor}
        hideEmployeeUi={hideEmployeeUi}
        onCancelSession={onCancelSessionFromMonitor}
        onOpenTaskDetail={onOpenTaskDetailFromMonitor}
        onOpenOmcBatchInvocationDetail={onOpenOmcBatchInvocationDetail}
        onCancelOmcDirectBatchInvocation={onCancelOmcDirectBatchInvocation}
        onStopSessionConversationTask={onStopSessionConversationTask}
        onReloadFullDiskTranscript={onReloadFullDiskTranscript}
        onCompactSessionHistory={onCompactSessionHistory}
        projectId={projectId}
        historyDrawerSessionId={historyDrawerSessionId}
        onHistoryDrawerSessionIdChange={onHistoryDrawerSessionIdChange}
        onRestoreHistorySessionAsMain={onRestoreHistorySessionAsMain}
        onResumeSession={onResumeSession}
        onPrepareSessionForMonitorDrawer={onPrepareSessionForMonitorDrawer}
        repositoryMainBindings={repositoryMainSessionBindings}
        repositories={repositories}
      />
    </div>
  );
}, monitorPanelPropsEqual);

/** 左栏挂载后预加载运行面板，避免首次展开 Suspense 卡顿。 */
export function preloadLeftSidebarMonitorPanel(): void {
  void import("../ProgressMonitorPanel");
}
