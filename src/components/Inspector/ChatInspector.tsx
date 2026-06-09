import { Layout } from "antd";
import type { ReactNode } from "react";
import type {
  ClaudeSession,
  EmployeeMonitorItem,
  MonitorDrawerTarget,
  MonitorStats,
  Repository,
  RepositoryMemberMonitorItem,
  SessionConversationTaskItem,
  TeamMonitorItem,
} from "../../types";
import { MAIN_LAYOUT_RIGHT_SIDER_WIDTH_PX } from "../../constants/mainLayoutWidths";
import { ProgressMonitorPanel } from "../ProgressMonitorPanel";
import { useChromePanelHoverHandlers } from "../../hooks/useChromePanelHoverHandlers";
import { WorkspaceInspectorPanelsSection } from "./WorkspaceInspectorPanelsSection";
import "./Inspector.css";

const { Sider } = Layout;

export interface ChatInspectorProps {
  dark: boolean;
  collapsed: boolean;
  /** 右栏 `Sider` 宽度（px）；默认 300 */
  siderWidth?: number;
  /** 「我的团队」：有数据时显示在右栏 */
  monitorStats?: MonitorStats | null;
  monitorPanelSessions?: ClaudeSession[];
  monitorTranscriptSourceSessions?: ClaudeSession[];
  employeeMonitorItems?: EmployeeMonitorItem[];
  repositoryMemberMonitorItems?: RepositoryMemberMonitorItem[];
  sessionConversationTaskItems?: SessionConversationTaskItem[];
  executionEnvironmentDispatchHistoryDays?: import("../../constants/executionEnvironmentDispatch").ExecutionEnvironmentDispatchHistoryDays;
  onExecutionEnvironmentDispatchHistoryDaysChange?: (
    days: import("../../constants/executionEnvironmentDispatch").ExecutionEnvironmentDispatchHistoryDays,
  ) => void | Promise<void>;
  executionEnvironmentDispatchHistoryDaysSaving?: boolean;
  teamMonitorItems?: TeamMonitorItem[];
  monitorActiveTarget?: MonitorDrawerTarget | null;
  onOpenTeamMonitorDetail?: (workflowId: string) => void;
  onOpenEmployeeConfig?: () => void;
  onOpenWorkflowConfig?: () => void;
  onStopEmployeeMonitor?: (employeeId: string) => void;
  onStopTeamMonitor?: (workflowId: string) => void;
  /** 隐藏员工监控区块；`wise_trellis` 时头部仍显示「成员」配置按钮。 */
  hideEmployeeUi?: boolean;
  onCancelSessionFromMonitor?: (sessionId: string) => void;
  onOpenTaskDetailFromMonitor?: (taskId: string) => void;
  onOpenOmcBatchInvocationDetail?: (input: {
    sessionId: string;
    repositoryPath: string;
    invocationKey: string;
  }) => void;
  onCancelOmcDirectBatchInvocation?: (invocationKey: string) => void;
  onStopSessionConversationTask?: (item: SessionConversationTaskItem) => void;
  onReloadFullDiskTranscript?: (sessionKey: string) => void | Promise<void>;
  onLoadMoreTranscriptFromDisk?: (sessionId: string) => void | Promise<void>;
  onCompactSessionHistory?: (sessionId: string) => void | Promise<void>;
  projectId?: string | null;
  historyDrawerSessionId?: string | null;
  onHistoryDrawerSessionIdChange?: (sessionId: string | null) => void;
  onRestoreHistorySessionAsMain?: (sessionId: string) => void | Promise<void>;
  onCreateTerminalEmployeeSession?: (employeeId: string) => string | null | Promise<string | null>;
  onResumeSession?: import("../ProgressMonitorPanel/MonitorDrawerSessionComposer").MonitorDrawerResumeSessionFn;
  repositoryMainBindings?: Record<string, string>;
  repositories?: Repository[];
  /** 右栏快捷操作：关联当前工作区 / 仓库 */
  activeProjectName?: string | null;
  activeRepositoryName?: string | null;
  activeRepositoryId?: number | null;
  /** 右栏 Git / 文件树面板（由左栏根据默认配置组装上报）。 */
  repositoryRepoPanel?: ReactNode | null;
}

/**
 * Chat 模式 Inspector：在 chat / inspect 模式下渲染 GitPanel + ProgressMonitorPanel。
 * Claude Code 工具（MCP/技能/Hooks/子代理）已移至会话顶栏图标弹层。
 *
 * 历史名为 `RightPanel`，P1 时按宪法 §4 改名为 ChatInspector。`RightPanel.tsx`
 * 仅保留 re-export 以支持过渡期 import；新代码请直接 import 这里。
 */
export function ChatInspector({
  dark,
  collapsed,
  siderWidth = MAIN_LAYOUT_RIGHT_SIDER_WIDTH_PX,
  monitorStats,
  monitorPanelSessions,
  monitorTranscriptSourceSessions,
  employeeMonitorItems = [],
  repositoryMemberMonitorItems = [],
  sessionConversationTaskItems = [],
  executionEnvironmentDispatchHistoryDays,
  onExecutionEnvironmentDispatchHistoryDaysChange,
  executionEnvironmentDispatchHistoryDaysSaving = false,
  teamMonitorItems = [],
  monitorActiveTarget,
  onOpenTeamMonitorDetail,
  onOpenEmployeeConfig,
  onOpenWorkflowConfig,
  onStopEmployeeMonitor,
  onStopTeamMonitor,
  hideEmployeeUi = false,
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
  onCreateTerminalEmployeeSession,
  onResumeSession,
  repositoryMainBindings,
  repositories,
  activeRepositoryId = null,
  repositoryRepoPanel = null,
}: ChatInspectorProps) {
  const sessionsForMonitor = monitorPanelSessions ?? [];
  const transcriptSessions = monitorTranscriptSourceSessions ?? sessionsForMonitor;
  const chromePanelHoverHandlers = useChromePanelHoverHandlers("right");

  return (
    <Sider
      width={siderWidth}
      collapsedWidth={0}
      collapsed={collapsed}
      className="app-right-panel app-chat-inspector"
      theme={dark ? "dark" : "light"}
      onMouseEnter={chromePanelHoverHandlers.onMouseEnter}
      onMouseLeave={chromePanelHoverHandlers.onMouseLeave}
    >
      <div className="app-right-panel-inner app-chat-inspector-inner">
        {repositoryRepoPanel ? (
          <div className="app-chat-inspector-card app-chat-inspector-card--repo-panel" aria-label="仓库面板">
            {repositoryRepoPanel}
          </div>
        ) : null}
        <WorkspaceInspectorPanelsSection
          projectId={projectId ?? null}
          repositoryId={activeRepositoryId}
        />
        <div className="app-chat-inspector-card app-chat-inspector-card--secondary">
          {monitorStats ? (
            <div className="app-chat-inspector-section app-chat-inspector-section--team" aria-label="我的团队">
              <ProgressMonitorPanel
                employeeItems={employeeMonitorItems}
                repositoryMemberItems={repositoryMemberMonitorItems}
                sessionConversationTaskItems={sessionConversationTaskItems}
                showSessionConversationTasks
                executionEnvironmentDispatchHistoryDays={executionEnvironmentDispatchHistoryDays}
                onExecutionEnvironmentDispatchHistoryDaysChange={
                  onExecutionEnvironmentDispatchHistoryDaysChange
                }
                executionEnvironmentDispatchHistoryDaysSaving={
                  executionEnvironmentDispatchHistoryDaysSaving
                }
                teamItems={teamMonitorItems}
                sessions={sessionsForMonitor}
                activeTarget={monitorActiveTarget}
                onOpenTeamDetail={(workflowId) => onOpenTeamMonitorDetail?.(workflowId)}
                onOpenEmployeeConfig={onOpenEmployeeConfig}
                onOpenWorkflowConfig={onOpenWorkflowConfig}
                onStopEmployee={(employeeId) => onStopEmployeeMonitor?.(employeeId)}
                onStopTeam={(workflowId) => onStopTeamMonitor?.(workflowId)}
                hideEmployeeUi={hideEmployeeUi}
                onCancelSession={onCancelSessionFromMonitor}
                onOpenTaskDetail={onOpenTaskDetailFromMonitor}
                onOpenOmcBatchInvocationDetail={onOpenOmcBatchInvocationDetail}
                onCancelOmcDirectBatchInvocation={onCancelOmcDirectBatchInvocation}
                onStopSessionConversationTask={onStopSessionConversationTask}
                onReloadFullDiskTranscript={onReloadFullDiskTranscript}
                onCompactSessionHistory={onCompactSessionHistory}
                transcriptSourceSessions={transcriptSessions}
                projectId={projectId}
                historyDrawerSessionId={historyDrawerSessionId}
                onHistoryDrawerSessionIdChange={onHistoryDrawerSessionIdChange}
                onRestoreHistorySessionAsMain={onRestoreHistorySessionAsMain}
                onCreateTerminalEmployeeSession={onCreateTerminalEmployeeSession}
                onResumeSession={onResumeSession}
                repositoryMainBindings={repositoryMainBindings}
                repositories={repositories}
              />
            </div>
          ) : null}
        </div>
      </div>
    </Sider>
  );
}
