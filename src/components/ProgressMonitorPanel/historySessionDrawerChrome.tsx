import { Typography } from "antd";
import type { ClaudeSession } from "../../types";
import { getSessionPreview } from "../ClaudeSessions/claudeChatHelpers";
import {
  buildMonitorSessionDrawerContextModel,
  buildMonitorSessionDrawerHeadline,
  formatMonitorSessionDateTime,
} from "./monitorSessionDisplay";

export { getSessionPreview };

export function historySessionStatusLabel(status: ClaudeSession["status"]): string {
  if (status === "running") return "运行中";
  if (status === "connecting") return "连接中";
  if (status === "completed") return "已完成";
  if (status === "cancelled") return "已取消";
  if (status === "error") return "异常";
  return "空闲";
}

export function historySessionStatusTagColor(
  status: ClaudeSession["status"],
): "default" | "processing" | "success" | "error" {
  if (status === "running" || status === "connecting") return "processing";
  if (status === "completed") return "success";
  if (status === "error") return "error";
  return "default";
}

/** 抽屉顶栏：仅一行主标题 */
export function HistorySessionDrawerTitle({
  session,
  terminalName,
}: {
  session: ClaudeSession | undefined;
  terminalName?: string;
}) {
  if (!session) {
    return <span className="app-monitor-panel__history-drawer-headline">会话记录</span>;
  }
  return (
    <span className="app-monitor-panel__history-drawer-headline">
      {buildMonitorSessionDrawerHeadline(session, { terminalName })}
    </span>
  );
}

/** 正文上方元信息条：仓库、时间、会话 ID（不挤在标题里） */
export function HistorySessionDrawerContextBar({
  session,
  updatedAtMs,
}: {
  session: ClaudeSession;
  /** 覆盖默认的会话更新时间（如执行环境派发时间） */
  updatedAtMs?: number;
}) {
  const ctx = buildMonitorSessionDrawerContextModel(session);
  const updatedAtText =
    updatedAtMs != null && Number.isFinite(updatedAtMs) && updatedAtMs > 0
      ? formatMonitorSessionDateTime(updatedAtMs)
      : ctx.updatedAtText;
  return (
    <div className="app-monitor-panel__history-drawer-context" aria-label="会话元信息">
      <span className="app-monitor-panel__history-drawer-context__chip" title={session.repositoryName}>
        {ctx.repoShort}
      </span>
      <span className="app-monitor-panel__history-drawer-context__sep" aria-hidden>
        ·
      </span>
      <span className="app-monitor-panel__history-drawer-context__chip">{updatedAtText}</span>
      <span className="app-monitor-panel__history-drawer-context__sep" aria-hidden>
        ·
      </span>
      <Typography.Text
        type="secondary"
        className="app-monitor-panel__history-drawer-context__session-id"
        copyable={{ text: ctx.sessionIdCopy, tooltips: ["复制会话 ID", "已复制"] }}
      >
        会话 ID {ctx.sessionIdDisplay}
      </Typography.Text>
    </div>
  );
}
