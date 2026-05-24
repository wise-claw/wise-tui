import { Layout } from "antd";
import { useCallback, useState } from "react";
import type {
  ClaudeSession,
  EmployeeMonitorItem,
  MonitorDrawerTarget,
  MonitorStats,
  RepositoryMemberMonitorItem,
  SessionConversationTaskItem,
  TeamMonitorItem,
} from "../../types";
import { MAIN_LAYOUT_RIGHT_SIDER_WIDTH_PX } from "../../constants/mainLayoutWidths";
import { ClaudeCodeToolsPanel } from "../ClaudeCodeToolsPanel";
import { GitPanel, type GitPanelOpenFileOptions } from "../GitPanel";
import { ProgressMonitorPanel } from "../ProgressMonitorPanel";
import "./Inspector.css";

const { Sider } = Layout;

const RIGHT_CLAUDE_TOOLS_COLLAPSED_KEY = "wise.rightPanel.claudeToolsCollapsed";

function readClaudeToolsCollapsedFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(RIGHT_CLAUDE_TOOLS_COLLAPSED_KEY) === "1";
}

export interface ChatInspectorProps {
  dark: boolean;
  collapsed: boolean;
  /** 右栏 `Sider` 宽度（px）；默认 300 */
  siderWidth?: number;
  repositoryPath?: string;
  repositoryName?: string;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  /** 「我的团队」：有数据时显示在 Git 下方 */
  monitorStats?: MonitorStats | null;
  monitorPanelSessions?: ClaudeSession[];
  monitorTranscriptSourceSessions?: ClaudeSession[];
  employeeMonitorItems?: EmployeeMonitorItem[];
  repositoryMemberMonitorItems?: RepositoryMemberMonitorItem[];
  sessionConversationTaskItems?: SessionConversationTaskItem[];
  teamMonitorItems?: TeamMonitorItem[];
  monitorActiveTarget?: MonitorDrawerTarget | null;
  onOpenTeamMonitorDetail?: (workflowId: string) => void;
  onOpenEmployeeConfig?: () => void;
  onOpenWorkflowConfig?: () => void;
  onStopEmployeeMonitor?: (employeeId: string) => void;
  onStopTeamMonitor?: (workflowId: string) => void;
  /** 隐藏员工监控区块；`wise_trellis` 时头部仍显示「成员」配置按钮。 */
  hideEmployeeUi?: boolean;
  monitorClaudeConcurrency?: {
    activeCount: number;
    limit: number;
    onLimitChange: (value: number) => void | Promise<void>;
  };
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
  onCompactSessionHistory?: (sessionId: string) => void | Promise<void>;
  projectId?: string | null;
}

/**
 * Chat 模式 Inspector：在 chat / inspect 模式下渲染 GitPanel + ProgressMonitorPanel
 * + ClaudeCodeToolsPanel。
 *
 * 历史名为 `RightPanel`，P1 时按宪法 §4 改名为 ChatInspector。`RightPanel.tsx`
 * 仅保留 re-export 以支持过渡期 import；新代码请直接 import 这里。
 */
export function ChatInspector({
  dark,
  collapsed,
  siderWidth = MAIN_LAYOUT_RIGHT_SIDER_WIDTH_PX,
  repositoryPath,
  repositoryName,
  onOpenFile,
  monitorStats,
  monitorPanelSessions,
  monitorTranscriptSourceSessions,
  employeeMonitorItems = [],
  repositoryMemberMonitorItems = [],
  sessionConversationTaskItems = [],
  teamMonitorItems = [],
  monitorActiveTarget,
  onOpenTeamMonitorDetail,
  onOpenEmployeeConfig,
  onOpenWorkflowConfig,
  onStopEmployeeMonitor,
  onStopTeamMonitor,
  hideEmployeeUi = false,
  monitorClaudeConcurrency,
  onCancelSessionFromMonitor,
  onOpenTaskDetailFromMonitor,
  onOpenOmcBatchInvocationDetail,
  onCancelOmcDirectBatchInvocation,
  onStopSessionConversationTask,
  onReloadFullDiskTranscript,
  onCompactSessionHistory,
  projectId,
}: ChatInspectorProps) {
  const [claudeToolsSectionCollapsed, setClaudeToolsSectionCollapsed] = useState(readClaudeToolsCollapsedFromStorage);

  const handleClaudeToolsSectionCollapsedChange = useCallback((next: boolean) => {
    setClaudeToolsSectionCollapsed(next);
    try {
      window.localStorage.setItem(RIGHT_CLAUDE_TOOLS_COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  const sessionsForMonitor = monitorPanelSessions ?? [];
  const transcriptSessions = monitorTranscriptSourceSessions ?? sessionsForMonitor;

  return (
    <Sider
      width={siderWidth}
      collapsedWidth={0}
      collapsed={collapsed}
      className="app-right-panel app-chat-inspector"
      theme={dark ? "dark" : "light"}
    >
      <div className="app-right-panel-inner app-chat-inspector-inner">
        <div className="app-chat-inspector-card">
          <div className="app-chat-inspector-section app-chat-inspector-section--git" aria-label="Git">
            <GitPanel repositoryPath={repositoryPath} repositoryName={repositoryName} onOpenFile={onOpenFile} />
          </div>
          {monitorStats ? (
            <div className="app-chat-inspector-section app-chat-inspector-section--team" aria-label="我的团队">
              <ProgressMonitorPanel
                employeeItems={employeeMonitorItems}
                repositoryMemberItems={repositoryMemberMonitorItems}
                sessionConversationTaskItems={sessionConversationTaskItems}
                teamItems={teamMonitorItems}
                sessions={sessionsForMonitor}
                activeTarget={monitorActiveTarget}
                onOpenTeamDetail={(workflowId) => onOpenTeamMonitorDetail?.(workflowId)}
                onOpenEmployeeConfig={onOpenEmployeeConfig}
                onOpenWorkflowConfig={onOpenWorkflowConfig}
                onStopEmployee={(employeeId) => onStopEmployeeMonitor?.(employeeId)}
                onStopTeam={(workflowId) => onStopTeamMonitor?.(workflowId)}
                hideEmployeeUi={hideEmployeeUi}
                claudeConcurrency={monitorClaudeConcurrency ?? null}
                onCancelSession={onCancelSessionFromMonitor}
                onOpenTaskDetail={onOpenTaskDetailFromMonitor}
                onOpenOmcBatchInvocationDetail={onOpenOmcBatchInvocationDetail}
                onCancelOmcDirectBatchInvocation={onCancelOmcDirectBatchInvocation}
                onStopSessionConversationTask={onStopSessionConversationTask}
                onReloadFullDiskTranscript={onReloadFullDiskTranscript}
                onCompactSessionHistory={onCompactSessionHistory}
                transcriptSourceSessions={transcriptSessions}
                projectId={projectId}
              />
            </div>
          ) : null}
          <div
            className={
              "app-chat-inspector-section app-chat-inspector-section--tools" +
              (claudeToolsSectionCollapsed ? " app-chat-inspector-section--tools-collapsed" : "")
            }
            aria-label="Claude Code"
          >
            <ClaudeCodeToolsPanel
              repositoryPath={repositoryPath}
              sectionCollapsed={claudeToolsSectionCollapsed}
              onSectionCollapsedChange={handleClaudeToolsSectionCollapsedChange}
            />
          </div>
        </div>
      </div>
    </Sider>
  );
}
