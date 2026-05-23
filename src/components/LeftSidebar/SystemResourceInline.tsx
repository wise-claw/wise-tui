import { Button, Drawer, Empty, Popover, Space, Tag } from "antd";
import type { ClaudeHostProcess, ClaudeSession, ClaudeSessionInfo } from "../../types";
import type { ClaudeProcessWorkspaceLabelCacheHandle } from "../../hooks/useClaudeProcessWorkspaceLabelCache";
import { formatBytes } from "./systemSessions";
import {
  HostProcessSessionDetails,
  RegistryOrphanSessionDetails,
} from "./SystemResourceSessionDetails";
import { ClaudeSessionMessagesColumn } from "../ClaudeSessions/ClaudeSessionMessagesColumn";
import {
  historySessionStatusLabel,
  historySessionStatusTagColor,
} from "../ProgressMonitorPanel";
import { ClaudeProcessPopoverContent } from "./ClaudeProcessPopoverContent";
import type { ProjectItem, Repository } from "../../types";
interface SystemSummary {
  appMemoryBytes: number;
  claudeMemoryBytes: number;
}

interface SystemResourceInlineProps {
  systemSummary: SystemSummary;
  systemSummaryError: boolean;
  popoverOpen: boolean;
  onPopoverOpenChange: (open: boolean) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  matchedSessions: ClaudeSession[];
  allSessions: ClaudeSession[];
  projects: ReadonlyArray<ProjectItem>;
  repositories: Repository[];
  repositoryMainSessionBindings: Record<string, string>;
  claudeProcesses: ClaudeHostProcess[];
  claudeProcessLabelCache?: ClaudeProcessWorkspaceLabelCacheHandle;
  /** 与 `claude:` 内存同源：`ps` 扫描到的 Claude 相关进程数 */
  claudeProcessCount: number;
  onSelectSession: (sessionId: string) => void;
  drawerTitle: string;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  drawerWidth: number;
  liveDrawerSession?: ClaudeSession;
  drawerRegistryOrphanSid: string | null;
  drawerRegistryOrphanInfo?: ClaudeSessionInfo;
  drawerHostProcess?: ClaudeHostProcess;
  canStopLiveDrawerSession: boolean;
  onCancelLiveDrawerSession?: (sessionId: string) => void;
  onCancelRegistryOrphanSession: (sid: string) => void;
  onEndSession?: (sessionId: string) => void;
  onBatchEndSessions?: (sessionIds: string[]) => void | Promise<void>;
  onOpenTaskDetailFromMonitor?: (taskId: string) => void;
}

export function SystemResourceInline({
  systemSummary,
  systemSummaryError,
  popoverOpen,
  onPopoverOpenChange,
  searchValue,
  onSearchChange,
  matchedSessions,
  allSessions,
  projects,
  repositories,
  repositoryMainSessionBindings,
  claudeProcesses,
  claudeProcessLabelCache,
  claudeProcessCount,
  onSelectSession,
  drawerTitle,
  drawerOpen,
  onCloseDrawer,
  drawerWidth,
  liveDrawerSession,
  drawerRegistryOrphanSid,
  drawerRegistryOrphanInfo,
  drawerHostProcess,
  canStopLiveDrawerSession,
  onCancelLiveDrawerSession,
  onCancelRegistryOrphanSession,
  onEndSession,
  onBatchEndSessions,
  onOpenTaskDetailFromMonitor,
}: SystemResourceInlineProps) {
  return (
    <>
      <div className="app-left-sidebar-system-inline" title="系统资源状态">
        {systemSummaryError
          ? "内存:--  claude:--  数量:--"
          : (
            <>
              <span>内存:{formatBytes(systemSummary.appMemoryBytes)}</span>
              <span>  claude:{formatBytes(systemSummary.claudeMemoryBytes)}</span>
              <Popover
                trigger="click"
                placement="topLeft"
                open={popoverOpen}
                onOpenChange={onPopoverOpenChange}
                overlayClassName="app-monitor-panel__history-popover"
                content={
                  <ClaudeProcessPopoverContent
                    searchValue={searchValue}
                    onSearchChange={onSearchChange}
                    matchedSessions={matchedSessions}
                    allSessions={allSessions}
                    projects={projects}
                    repositories={repositories}
                    repositoryMainSessionBindings={repositoryMainSessionBindings}
                    claudeProcesses={claudeProcesses}
                    claudeProcessLabelCache={claudeProcessLabelCache}
                    emptyDescription={
                      searchValue.trim()
                        ? "未找到匹配进程"
                        : claudeProcessCount > 0
                          ? "暂无匹配的 Claude 进程"
                          : "暂无运行中的 Claude 进程"
                    }
                    onSelectSession={onSelectSession}
                    onEndSession={onEndSession}
                    onBatchEndSessions={onBatchEndSessions}
                  />
                }
              >
                <span
                  className="app-left-sidebar-system-inline__count-trigger"
                  role="button"
                  tabIndex={0}
                  aria-label="查看 Claude Code 进程与会话列表"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onPopoverOpenChange(true);
                    }
                  }}
                >
                  {"  数量:"}
                  {claudeProcessCount}
                </span>
              </Popover>
            </>
          )}
      </div>

      <Drawer
        title={drawerTitle}
        open={drawerOpen}
        onClose={onCloseDrawer}
        placement="right"
        destroyOnHidden
        size={drawerWidth}
        classNames={{ body: "app-monitor-panel__history-session-drawer-body" }}
        extra={
          liveDrawerSession ? (
            <Space size="small" wrap align="center">
              <Tag color={historySessionStatusTagColor(liveDrawerSession.status)}>
                {historySessionStatusLabel(liveDrawerSession.status)}
              </Tag>
              {canStopLiveDrawerSession && onCancelLiveDrawerSession ? (
                <Button
                  size="small"
                  danger
                  onClick={() => onCancelLiveDrawerSession(liveDrawerSession.id)}
                >
                  停止
                </Button>
              ) : null}
            </Space>
          ) : drawerRegistryOrphanSid ? (
            <Space size="small" wrap align="center">
              <Tag color="processing">运行中</Tag>
              <Button
                size="small"
                danger
                onClick={() => onCancelRegistryOrphanSession(drawerRegistryOrphanSid)}
              >
                停止
              </Button>
            </Space>
          ) : drawerHostProcess?.sessionId ? (
            <Space size="small" wrap align="center">
              <Tag color="processing">系统进程</Tag>
              <Button
                size="small"
                danger
                onClick={() => onCancelRegistryOrphanSession(drawerHostProcess.sessionId!)}
              >
                停止
              </Button>
            </Space>
          ) : drawerHostProcess ? (
            <Tag color="default">系统进程</Tag>
          ) : null
        }
      >
        {liveDrawerSession ? (
          <div className="app-monitor-panel__history-session-drawer-scroll">
            <ClaudeSessionMessagesColumn
              session={liveDrawerSession}
              onOpenTaskDetail={onOpenTaskDetailFromMonitor}
              showAllMessages
            />
          </div>
        ) : drawerRegistryOrphanSid ? (
          <RegistryOrphanSessionDetails
            sid={drawerRegistryOrphanSid}
            info={drawerRegistryOrphanInfo}
          />
        ) : drawerHostProcess ? (
          <HostProcessSessionDetails proc={drawerHostProcess} />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到该会话" />
        )}
      </Drawer>
    </>
  );
}
