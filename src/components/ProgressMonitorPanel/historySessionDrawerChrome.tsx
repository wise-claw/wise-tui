import { Typography } from "antd";
import type { ClaudeSession } from "../../types";

export function getSessionPreview(session: ClaudeSession): string {
  const fallback = session.diskPreview?.trim() || "新会话";
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const msg = session.messages[i];
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    const text = msg.content.trim();
    if (text) {
      return text.length > 42 ? `${text.slice(0, 42)}...` : text;
    }
  }
  return fallback.length > 42 ? `${fallback.slice(0, 42)}...` : fallback;
}

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

/** 历史会话抽屉标题：展示仓库/标签名 + 可复制的 Claude Code 会话 id（无落盘 id 时退回 Wise 标签 id） */
export function HistorySessionDrawerTitle({ session }: { session: ClaudeSession | undefined }) {
  if (!session) {
    return <span>会话消息</span>;
  }
  const name = session.repositoryName?.trim();
  const primary = name && name.length > 0 ? name : getSessionPreview(session);
  const claudeId = session.claudeSessionId?.trim();
  const copyText = claudeId && claudeId.length > 0 ? claudeId : session.id;
  return (
    <div className="app-monitor-panel__history-drawer-title">
      <div className="app-monitor-panel__history-drawer-title__primary">{primary}</div>
      <Typography.Text
        type="secondary"
        className="app-monitor-panel__history-drawer-title__session-id"
        copyable={{ text: copyText, tooltips: ["复制 Claude Code 会话 ID", "已复制"] }}
      >
        Claude Code 会话：{copyText}
      </Typography.Text>
    </div>
  );
}
