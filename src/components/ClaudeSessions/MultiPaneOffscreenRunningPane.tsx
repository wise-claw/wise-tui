import { Button, Spin } from "antd";
import { memo } from "react";
import type { ClaudeSession, PermissionRequest } from "../../types";

interface MultiPaneOffscreenRunningPaneProps {
  session: ClaudeSession;
  permissionRequest: PermissionRequest | null;
  onCancel: (opts?: { retractLastUserTurn?: boolean }) => void;
  onRespondToPermission: (response: "allow_once" | "allow_always" | "deny") => void;
}

/** 多屏离屏且仍在运行的伴生窗格：精简壳层，避免挂载完整 ClaudeChat / Composer。 */
export const MultiPaneOffscreenRunningPane = memo(function MultiPaneOffscreenRunningPane({
  session,
  permissionRequest,
  onCancel,
  onRespondToPermission,
}: MultiPaneOffscreenRunningPaneProps) {
  const title = session.repositoryName?.trim() || "执行会话";
  const statusLabel = session.status === "connecting" ? "连接中" : "执行中";

  return (
    <div className="app-claude-sessions__pane-offscreen-running">
      <div className="app-claude-sessions__pane-offscreen-running__head">
        <Spin size="small" />
        <span className="app-claude-sessions__pane-offscreen-running__title">{title}</span>
        <span className="app-claude-sessions__pane-offscreen-running__status">{statusLabel}</span>
      </div>
      <p className="app-claude-sessions__pane-offscreen-running__hint">
        窗格在视口外，已暂停完整聊天渲染以节省内存。滚回可见区域后将自动恢复。
      </p>
      {permissionRequest ? (
        <div className="app-claude-sessions__pane-offscreen-running__control">
          <span className="app-claude-sessions__pane-offscreen-running__control-label">待处理权限</span>
          <div className="app-claude-sessions__pane-offscreen-running__control-actions">
            <Button size="small" type="primary" onClick={() => onRespondToPermission("allow_once")}>
              允许一次
            </Button>
            <Button size="small" onClick={() => onRespondToPermission("allow_always")}>
              始终允许
            </Button>
            <Button size="small" danger onClick={() => onRespondToPermission("deny")}>
              拒绝
            </Button>
          </div>
        </div>
      ) : null}
      <div className="app-claude-sessions__pane-offscreen-running__actions">
        <Button size="small" danger onClick={() => onCancel()}>
          停止
        </Button>
      </div>
    </div>
  );
});
