import { Suspense, lazy, memo } from "react";
import type { LeftSidebarProps } from "./types";
import type { ClaudeSession } from "../../types";

const ProgressMonitorPanelLazy = lazy(() =>
  import("../ProgressMonitorPanel").then((module) => ({ default: module.ProgressMonitorPanel })),
);

export type LeftSidebarMonitorPanelSlotProps = {
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
};

function monitorTaskItemsFingerprint(
  items: LeftSidebarMonitorPanelSlotProps["sessionConversationTaskItems"],
): string {
  if (!items?.length) return "0";
  return items
    .map((item) => `${item.key}|${item.status}|${item.updatedAt}`)
    .join("\n");
}

function monitorPanelPropsEqual(
  prev: LeftSidebarMonitorPanelSlotProps,
  next: LeftSidebarMonitorPanelSlotProps,
): boolean {
  return (
    prev.monitorPanelSectionCollapsed === next.monitorPanelSectionCollapsed &&
    prev.onMonitorPanelSectionCollapsedChange === next.onMonitorPanelSectionCollapsedChange &&
    prev.monitorPanelSessions === next.monitorPanelSessions &&
    prev.transcriptSourceSessions === next.transcriptSourceSessions &&
    prev.employeeMonitorItems === next.employeeMonitorItems &&
    prev.repositoryMemberMonitorItems === next.repositoryMemberMonitorItems &&
    prev.teamMonitorItems === next.teamMonitorItems &&
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
}: LeftSidebarMonitorPanelSlotProps) {
  return (
    <div
      className={
        "app-left-sidebar-monitor-panel" +
        (monitorPanelSectionCollapsed ? " app-left-sidebar-monitor-panel--section-collapsed" : "")
      }
    >
      <Suspense fallback={null}>
        <ProgressMonitorPanelLazy
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
      </Suspense>
    </div>
  );
}, monitorPanelPropsEqual);
