import { Layout } from "antd";
import { useCallback, useState } from "react";
import type {
  ClaudeSession,
  EmployeeMonitorItem,
  MonitorDrawerTarget,
  MonitorStats,
  RepositoryMemberMonitorItem,
  TeamMonitorItem,
} from "../types";
import { MAIN_LAYOUT_RIGHT_SIDER_WIDTH_PX } from "../constants/mainLayoutWidths";
import { ClaudeCodeToolsPanel } from "./ClaudeCodeToolsPanel";
import { GitPanel, type GitPanelOpenFileOptions } from "./GitPanel";
import { ProgressMonitorPanel } from "./ProgressMonitorPanel";

const { Sider } = Layout;

const RIGHT_CLAUDE_TOOLS_COLLAPSED_KEY = "wise.rightPanel.claudeToolsCollapsed";

function readClaudeToolsCollapsedFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(RIGHT_CLAUDE_TOOLS_COLLAPSED_KEY) === "1";
}

interface Props {
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
  teamMonitorItems?: TeamMonitorItem[];
  monitorActiveTarget?: MonitorDrawerTarget | null;
  onOpenTeamMonitorDetail?: (workflowId: string) => void;
  onOpenEmployeeConfig?: () => void;
  onOpenWorkflowConfig?: () => void;
  onStopEmployeeMonitor?: (employeeId: string) => void;
  onStopTeamMonitor?: (workflowId: string) => void;
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
  onReloadFullDiskTranscript?: (sessionKey: string) => void | Promise<void>;
}

export function RightPanel({
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
  teamMonitorItems = [],
  monitorActiveTarget,
  onOpenTeamMonitorDetail,
  onOpenEmployeeConfig,
  onOpenWorkflowConfig,
  onStopEmployeeMonitor,
  onStopTeamMonitor,
  monitorClaudeConcurrency,
  onCancelSessionFromMonitor,
  onOpenTaskDetailFromMonitor,
  onOpenOmcBatchInvocationDetail,
  onCancelOmcDirectBatchInvocation,
  onReloadFullDiskTranscript,
}: Props) {
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
      className="app-right-panel"
      theme={dark ? "dark" : "light"}
    >
      <div className="app-right-panel-inner">
        <div className="app-right-panel-upper">
          <div className="app-right-panel-git">
            <GitPanel repositoryPath={repositoryPath} repositoryName={repositoryName} onOpenFile={onOpenFile} />
          </div>
          {monitorStats ? (
            <div className="app-right-panel-team">
              <ProgressMonitorPanel
                employeeItems={employeeMonitorItems}
                repositoryMemberItems={repositoryMemberMonitorItems}
                teamItems={teamMonitorItems}
                sessions={sessionsForMonitor}
                activeTarget={monitorActiveTarget}
                onOpenTeamDetail={(workflowId) => onOpenTeamMonitorDetail?.(workflowId)}
                onOpenEmployeeConfig={onOpenEmployeeConfig}
                onOpenWorkflowConfig={onOpenWorkflowConfig}
                onStopEmployee={(employeeId) => onStopEmployeeMonitor?.(employeeId)}
                onStopTeam={(workflowId) => onStopTeamMonitor?.(workflowId)}
                claudeConcurrency={monitorClaudeConcurrency ?? null}
                onCancelSession={onCancelSessionFromMonitor}
                onOpenTaskDetail={onOpenTaskDetailFromMonitor}
                onOpenOmcBatchInvocationDetail={onOpenOmcBatchInvocationDetail}
                onCancelOmcDirectBatchInvocation={onCancelOmcDirectBatchInvocation}
                onReloadFullDiskTranscript={onReloadFullDiskTranscript}
                transcriptSourceSessions={transcriptSessions}
              />
            </div>
          ) : null}
        </div>
        <div
          className={
            "app-right-panel-bottom" +
            (claudeToolsSectionCollapsed ? " app-right-panel-bottom--claude-collapsed" : "")
          }
        >
          <ClaudeCodeToolsPanel
            repositoryPath={repositoryPath}
            sectionCollapsed={claudeToolsSectionCollapsed}
            onSectionCollapsedChange={handleClaudeToolsSectionCollapsedChange}
          />
        </div>
      </div>
    </Sider>
  );
}
