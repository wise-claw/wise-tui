import { Button, Drawer, Empty, Popover, Space, Tag, Typography } from "antd";
import type { ClaudeHostProcess, ClaudeSession, ClaudeSessionInfo } from "../../types";
import { formatBytes } from "./systemSessions";
import { ClaudeSessionMessagesColumn } from "../ClaudeSessions/ClaudeSessionMessagesColumn";
import {
  HistorySessionPopoverContent,
  historySessionStatusLabel,
  historySessionStatusTagColor,
} from "../ProgressMonitorPanel";
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
                      searchValue.trim()
                        ? "未找到匹配会话"
                        : claudeProcessCount > 0
                          ? "检测到 Claude 进程；点击下方条目查看 PID / 会话 ID"
                          : "暂无运行中的会话"
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

function HostProcessSessionDetails({ proc }: { proc: ClaudeHostProcess }) {
  const sid = proc.sessionId?.trim() ?? "";
  const path = proc.projectPath?.trim() ?? "";
  const sourceLabel =
    proc.sessionSource === "lsof_jsonl"
      ? "打开中的 jsonl（lsof）"
      : proc.sessionSource === "resume_arg"
        ? "命令行 -r"
        : "未能解析";
  return (
    <div className="app-monitor-panel__history-session-drawer-scroll">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        该条目来自本机进程扫描（非 Wise 注册表）。若会话由终端启动，可通过会话 ID 终止；仅 PID 无会话 ID 时请在终端确认。
      </Typography.Paragraph>
      <Typography.Paragraph>
        <Typography.Text strong>PID</Typography.Text> {proc.pid}
        {" · "}
        <Typography.Text strong>内存</Typography.Text> {formatBytes(proc.memoryBytes)}
      </Typography.Paragraph>
      <Typography.Paragraph>
        <Typography.Text strong>会话 ID 来源</Typography.Text> {sourceLabel}
      </Typography.Paragraph>
      {path ? (
        <Typography.Paragraph copyable={{ text: path }}>
          <Typography.Text strong>Workspace Path</Typography.Text> {path}
        </Typography.Paragraph>
      ) : null}
      {sid ? (
        <Typography.Paragraph copyable={{ text: sid }}>
          <Typography.Text strong>Claude 会话 ID</Typography.Text> {sid}
        </Typography.Paragraph>
      ) : (
        <Typography.Paragraph type="secondary">
          未从命令行 `-r` 或 jsonl 路径解析到会话 ID（可能为新会话首包前，或非 Claude Code 主进程）。
        </Typography.Paragraph>
      )}
    </div>
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
            <Typography.Text strong>Workspace Path</Typography.Text>{" "}
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
