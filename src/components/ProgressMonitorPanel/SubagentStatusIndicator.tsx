import { Tooltip } from "antd";
import { memo } from "react";
import type { RepositoryMemberMonitorSubagentItem, SessionConversationTaskItem } from "../../types";
import { sessionConversationTaskStatusLabel } from "../../utils/sessionConversationTasks";

export type SubagentStatusIndicatorStatus =
  | SessionConversationTaskItem["status"]
  | RepositoryMemberMonitorSubagentItem["status"]
  | "idle";

function statusLabel(status: SubagentStatusIndicatorStatus): string {
  if (status === "idle") return "空闲";
  if (status === "running") return "运行中";
  if (status === "stale") return "疑似断连";
  if (status === "reclaimed") return "已回收";
  if (status === "cancelled") return "已中断";
  if (status === "failed") return "失败";
  if (status === "completed") return "已完成";
  return sessionConversationTaskStatusLabel(status);
}

function RunningIcon() {
  return (
    <svg className="app-monitor-panel__subagent-status-svg app-monitor-panel__subagent-status-svg--spin" viewBox="0 0 16 16" aria-hidden>
      <circle className="app-monitor-panel__subagent-status-track" cx="8" cy="8" r="6.25" fill="none" />
      <circle className="app-monitor-panel__subagent-status-arc app-monitor-panel__subagent-status-arc--running" cx="8" cy="8" r="6.25" fill="none" />
    </svg>
  );
}

function CompletedIcon() {
  return (
    <svg className="app-monitor-panel__subagent-status-svg" viewBox="0 0 16 16" aria-hidden>
      <circle className="app-monitor-panel__subagent-status-ring app-monitor-panel__subagent-status-ring--completed" cx="8" cy="8" r="6.25" fill="none" />
      <path
        className="app-monitor-panel__subagent-status-check"
        d="M5.1 8.2 6.9 10 10.9 6"
        fill="none"
      />
    </svg>
  );
}

function FailedIcon() {
  return (
    <svg className="app-monitor-panel__subagent-status-svg" viewBox="0 0 16 16" aria-hidden>
      <circle className="app-monitor-panel__subagent-status-ring app-monitor-panel__subagent-status-ring--failed" cx="8" cy="8" r="6.25" fill="none" />
      <path
        className="app-monitor-panel__subagent-status-cross"
        d="M6 6 10 10 M10 6 6 10"
        fill="none"
      />
    </svg>
  );
}

function StaleIcon() {
  return (
    <svg className="app-monitor-panel__subagent-status-svg app-monitor-panel__subagent-status-svg--pulse" viewBox="0 0 16 16" aria-hidden>
      <circle className="app-monitor-panel__subagent-status-ring app-monitor-panel__subagent-status-ring--stale" cx="8" cy="8" r="6.25" fill="none" />
      <circle className="app-monitor-panel__subagent-status-dot app-monitor-panel__subagent-status-dot--stale" cx="8" cy="8" r="1.6" />
    </svg>
  );
}

function IdleIcon() {
  return (
    <svg className="app-monitor-panel__subagent-status-svg" viewBox="0 0 16 16" aria-hidden>
      <circle className="app-monitor-panel__subagent-status-ring app-monitor-panel__subagent-status-ring--idle" cx="8" cy="8" r="6.25" fill="none" />
      <path className="app-monitor-panel__subagent-status-pause" d="M6.4 5.8v4.4M9.6 5.8v4.4" fill="none" />
    </svg>
  );
}

function StatusIcon({ status }: { status: SubagentStatusIndicatorStatus }) {
  if (status === "running") return <RunningIcon />;
  if (status === "completed") return <CompletedIcon />;
  if (status === "failed") return <FailedIcon />;
  if (status === "stale") return <StaleIcon />;
  if (status === "idle") return <IdleIcon />;
  return <IdleIcon />;
}

export const SubagentStatusIndicator = memo(function SubagentStatusIndicator({
  status,
  label,
  className,
}: {
  status: SubagentStatusIndicatorStatus;
  label?: string;
  className?: string;
}) {
  const text = label?.trim() || statusLabel(status);
  const rootClass = [
    "app-monitor-panel__subagent-status",
    `app-monitor-panel__subagent-status--${status}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Tooltip title={text} mouseEnterDelay={0.35}>
      <span className={rootClass} role="status" aria-label={text}>
        <StatusIcon status={status} />
      </span>
    </Tooltip>
  );
});
