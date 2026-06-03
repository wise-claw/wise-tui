import { ReloadOutlined } from "@ant-design/icons";
import { Button, Empty, Space, Spin } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { safeUnlisten } from "../../utils/safeTauriUnlisten";
import type { ClaudeSession } from "../../types";
import {
  wiseMascotShow,
  wiseNotificationListRecent,
  wiseNotificationMarkAllRead,
  type WiseInboundMessageRow,
} from "../../services/wiseMascot";
import { formatNotificationInboxDisplayLine } from "../../utils/claudeTurnNotificationBody";

export type NotificationNavigateTarget = {
  messageId: string;
  conversationId: string;
  /** 完整通知正文，用于进入会话后滚动定位（与侧栏通知一致） */
  body?: string;
};

interface NotificationInboxPanelProps {
  /** Popover 打开且当前为「通知」标签时为 true，用于按需拉取列表 */
  active: boolean;
  /** 点击一条通知时跳转会话；`conversationId` 对齐本地标签 `id` / `claudeSessionId`，`messageId` 用于标已读 */
  onNavigateToConversation?: (target: NotificationNavigateTarget) => void;
  sessions?: ClaudeSession[];
  repositoryDisplayNameForInbound?: string;
}

export function NotificationInboxPanel({
  active,
  onNavigateToConversation,
  sessions = [],
  repositoryDisplayNameForInbound = "",
}: NotificationInboxPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<WiseInboundMessageRow[]>([]);
  const loadSeqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const list = await wiseNotificationListRecent(80);
      if (seq !== loadSeqRef.current) return;
      setRows(list);
    } catch (e) {
      if (seq !== loadSeqRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, load]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    void (async () => {
      const u = await listen("wise-unread-changed", () => {
        if (active) void load();
      });
      if (cancelled) {
        safeUnlisten(u);
        return;
      }
      unlisten = u;
    })();
    return () => {
      cancelled = true;
      safeUnlisten(unlisten);
    };
  }, [active, load]);

  const onMarkAllRead = useCallback(() => {
    void (async () => {
      try {
        await wiseNotificationMarkAllRead();
        await load();
      } catch {
        /* ignore */
      }
    })();
  }, [load]);

  const onShowMascot = useCallback(() => {
    void wiseMascotShow().catch(() => {
      /* ignore */
    });
  }, []);

  return (
    <div className="app-notification-inbox">
      <div className="app-notification-inbox-toolbar">
        <Space size={4} wrap>
          <Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
          <Button type="text" size="small" onClick={onMarkAllRead}>
            全部已读
          </Button>
          <Button type="text" size="small" onClick={onShowMascot}>
            桌面小人
          </Button>
        </Space>
      </div>
      {loading && rows.length === 0 ? (
        <div className="app-status-loading">
          <Spin size="small" />
        </div>
      ) : error ? (
        <div className="app-status-error">{error}</div>
      ) : rows.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无消息" style={{ margin: "16px 0" }} />
      ) : (
        <div className="app-notification-inbox-list">
          {rows.map((r) => {
            const nav = onNavigateToConversation;
            const clickable = typeof nav === "function";
            const bodyDisplay = formatNotificationInboxDisplayLine({
              body: r.body,
              conversationId: r.conversationId,
              sessions,
              repositoryDisplayNameForInbound,
            });
            const titleBody = `${bodyDisplay}\n原文：${r.body}`;
            const rowTitle = clickable
              ? `${titleBody}\n${r.conversationId}\n跳转到该 Claude 会话`
              : `${titleBody}\n${r.conversationId}`;
            return (
              <div
                key={r.id}
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                className={`app-notification-row ${r.readAt ? "app-notification-row--read" : ""}${clickable ? " app-notification-row--clickable" : ""}`}
                title={rowTitle}
                onClick={
                  clickable
                    ? () =>
                        nav({
                          messageId: r.id,
                          conversationId: r.conversationId,
                          body: r.body,
                        })
                    : undefined
                }
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          nav({
                            messageId: r.id,
                            conversationId: r.conversationId,
                            body: r.body,
                          });
                        }
                      }
                    : undefined
                }
              >
                <span
                  className={`app-notification-row-dot ${r.readAt ? "app-notification-row-dot--read" : ""}`}
                  aria-hidden
                />
                <div className="app-notification-row-main">
                  <div className="app-notification-row-meta" title={r.conversationId}>
                    {r.conversationId}
                  </div>
                  <div className="app-notification-row-body">{bodyDisplay}</div>
                  <div className="app-notification-row-time">{r.createdAt}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
