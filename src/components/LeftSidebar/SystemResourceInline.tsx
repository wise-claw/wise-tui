import { Button, Drawer, Empty, Popover, Space, Tag, Typography } from "antd";
import type { ClaudeSession, ClaudeSessionInfo } from "../../types";
import { ClaudeSessionMessagesColumn } from "../ClaudeSessions/ClaudeSessionMessagesColumn";
import {
  HistorySessionPopoverContent,
  historySessionStatusLabel,
  historySessionStatusTagColor,
} from "../ProgressMonitorPanel";
import { formatBytes } from "./systemSessions";

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
  runningSessionCount: number;
  onSelectSession: (sessionId: string) => void;
  drawerTitle: string;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  drawerWidth: number;
  liveDrawerSession?: ClaudeSession;
  drawerRegistryOrphanSid: string | null;
  drawerRegistryOrphanInfo?: ClaudeSessionInfo;
  canStopLiveDrawerSession: boolean;
  onCancelLiveDrawerSession?: (sessionId: string) => void;
  onCancelRegistryOrphanSession: (sid: string) => void;
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
  runningSessionCount,
  onSelectSession,
  drawerTitle,
  drawerOpen,
  onCloseDrawer,
  drawerWidth,
  liveDrawerSession,
  drawerRegistryOrphanSid,
  drawerRegistryOrphanInfo,
  canStopLiveDrawerSession,
  onCancelLiveDrawerSession,
  onCancelRegistryOrphanSession,
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
                  <HistorySessionPopoverContent
                    searchValue={searchValue}
                    onSearchChange={onSearchChange}
                    rows={matchedSessions.map((session) => ({ session }))}
                    emptyDescription={
                      searchValue.trim() ? "未找到匹配会话" : "暂无运行中的会话"
                    }
                    onSelectSession={onSelectSession}
                    searchPlaceholder="搜索会话..."
                  />
                }
              >
                <span
                  className="app-left-sidebar-system-inline__count-trigger"
                  role="button"
                  tabIndex={0}
                  aria-label="查看正在运行中的 Claude Code 会话列表"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onPopoverOpenChange(true);
                    }
                  }}
                >
                  {"  数量:"}
                  {runningSessionCount}
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
        destroyOnClose
        width={drawerWidth}
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
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到该会话" />
        )}
      </Drawer>
    </>
  );
}

function RegistryOrphanSessionDetails({
  sid,
  info,
}: {
  sid: string;
  info?: ClaudeSessionInfo;
}) {
  return (
    <div className="app-monitor-panel__history-session-drawer-scroll">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        该进程在系统注册表中为运行状态，但未与 Wise 侧栏中的会话标签绑定；可直接终止进程，或在终端侧确认是否为预期中的 Claude Code。
      </Typography.Paragraph>
      {info ? (
        <>
          <Typography.Paragraph>
            <Typography.Text strong>模型</Typography.Text> {info.model.trim() || "—"}
          </Typography.Paragraph>
          <Typography.Paragraph copyable={{ text: info.project_path }}>
            <Typography.Text strong>项目路径</Typography.Text>{" "}
            {info.project_path.trim() || "—"}
          </Typography.Paragraph>
        </>
      ) : null}
      <Typography.Paragraph copyable={{ text: sid }}>
        <Typography.Text strong>Claude 会话 ID</Typography.Text> {sid}
      </Typography.Paragraph>
      {!info ? (
        <Typography.Paragraph type="secondary">
          注册表中暂无该条目的最新信息（可能已结束或已刷新）。
        </Typography.Paragraph>
      ) : null}
    </div>
  );
}
