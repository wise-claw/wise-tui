import { Popover } from "antd";
import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ClaudeSession } from "../../types";
import { wiseNotificationUnreadTotal } from "../../services/wiseMascot";
import { NotificationInboxPanel } from "./NotificationInboxPanel";
import "./index.css";

function useWiseUnreadBadge(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    void wiseNotificationUnreadTotal()
      .then((t) => setN(Number(t) || 0))
      .catch(() => setN(0));
    void (async () => {
      unlisten = await listen<{ total?: number }>("wise-unread-changed", (e) => {
        setN(Number(e.payload.total ?? 0));
      });
    })();
    return () => {
      void unlisten?.();
    };
  }, []);
  return n;
}

export type { NotificationNavigateTarget } from "./NotificationInboxPanel";

interface StatusPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigateToConversation?: (target: {
    messageId: string;
    conversationId: string;
    body?: string;
  }) => void;
  /** 用于通知列表解析「张三」及入库正文相对当前仓的裁剪；缺省则 actor 多为「通知」。 */
  sessions?: ClaudeSession[];
  /** 通常取当前激活会话的 `repositoryName`，与侧栏通知列表一致 */
  repositoryDisplayNameForInbound?: string;
  children: React.ReactNode;
}

/** 主窗口顶栏：消息通知（本地入库 + 未读角标），不含 MCP / 插件等配置。 */
export function StatusPopover({
  open,
  onOpenChange,
  onNavigateToConversation,
  sessions,
  repositoryDisplayNameForInbound,
  children,
}: StatusPopoverProps) {
  const unread = useWiseUnreadBadge();

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      placement="bottomRight"
      trigger="click"
      styles={{ container: { padding: 0 } }}
      overlayClassName="app-status-popover"
      content={
        <div className="app-status-popover-content app-status-popover-content--inbox-only">
          <div className="app-status-popover-body app-status-popover-body--inbox">
            <NotificationInboxPanel
              active={open}
              onNavigateToConversation={onNavigateToConversation}
              sessions={sessions}
              repositoryDisplayNameForInbound={repositoryDisplayNameForInbound}
            />
          </div>
        </div>
      }
    >
      <span className="app-status-popover-trigger app-notification-bell-wrap">
        {children}
        {unread > 0 ? (
          <span className="app-notification-bell-count" aria-label={`未读消息 ${unread} 条`}>
            {unread > 99 ? "99+" : String(unread)}
          </span>
        ) : null}
      </span>
    </Popover>
  );
}
