import { BellOutlined } from "@ant-design/icons";
import { memo } from "react";
import type { ClaudeSession } from "../../types";
import type { WiseInboundMessageRow } from "../../services/wiseMascot";
import { formatNotificationInboxDisplayLine } from "../../utils/claudeTurnNotificationBody";

export interface ClaudeChatNotificationDockProps {
  session: ClaudeSession;
  sessions: ClaudeSession[];
  rows: WiseInboundMessageRow[];
  unreadCount: number;
  collapsed: boolean;
  loading: boolean;
  badgePulse: boolean;
  titleCountPulse: boolean;
  bubbleEnterIds: ReadonlySet<string>;
  onCollapse: () => void;
  onExpand: () => void;
  onRefresh: () => void;
  onMarkAllRead: () => void;
  onMarkRead: (row: WiseInboundMessageRow) => void;
  onJump: (row: WiseInboundMessageRow) => void;
}

export const ClaudeChatNotificationDock = memo(function ClaudeChatNotificationDock({
  session,
  sessions,
  rows,
  unreadCount,
  collapsed,
  loading,
  badgePulse,
  titleCountPulse,
  bubbleEnterIds,
  onCollapse,
  onExpand,
  onRefresh,
  onMarkAllRead,
  onMarkRead,
  onJump,
}: ClaudeChatNotificationDockProps) {
  if (rows.length === 0) {
    return null;
  }

  if (collapsed) {
    return (
      <div className="app-session-notification-dock">
        <button
          type="button"
          className="app-session-notification-dock__collapsed-trigger"
          aria-expanded={false}
          aria-label="展开消息通知"
          onClick={onExpand}
        >
          <BellOutlined aria-hidden />
          <span
            className={`app-session-notification-dock__collapsed-badge${badgePulse ? " app-session-notification-dock__collapsed-badge--pulse" : ""}`}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="app-session-notification-dock">
      <div className="app-session-notification-panel" role="region" aria-label="消息通知">
        <div className="app-session-notification-panel__head">
          <span className="app-session-notification-panel__title-wrap">
            <span className="app-session-notification-panel__title">消息通知</span>
            <span
              className={`app-session-notification-panel__count${titleCountPulse ? " app-session-notification-panel__count--pulse" : ""}`}
              aria-label={`${unreadCount} 条未读`}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          </span>
          <div className="app-session-notification-panel__head-actions">
            <button
              type="button"
              className="app-session-notification-panel__collapse-btn"
              aria-label="收起消息通知面板"
              onClick={onCollapse}
            >
              收起
            </button>
            <button
              type="button"
              className="app-session-notification-panel__refresh-btn"
              onClick={onRefresh}
              disabled={loading}
            >
              {loading ? "刷新中..." : "刷新"}
            </button>
            <div className="app-session-notification-panel__head-trailing">
              <button
                type="button"
                className="app-session-notification-panel__mark-all-read-btn"
                disabled={loading}
                onClick={onMarkAllRead}
              >
                全部已读
              </button>
            </div>
          </div>
        </div>
        <div className="app-session-notification-panel__body">
          <div className="app-session-notification-panel__list">
            {rows.map((row) => {
              const notificationBodyDisplay = formatNotificationInboxDisplayLine({
                body: row.body,
                conversationId: row.conversationId,
                sessions,
                repositoryDisplayNameForInbound: session.repositoryName ?? "",
              });
              const titleLines = `${notificationBodyDisplay}\n原文：${row.body}\n${row.conversationId}${row.createdAt ? ` · ${row.createdAt}` : ""}`;
              return (
                <div
                  key={row.id}
                  className={`app-session-notification-panel__item ${row.readAt ? "app-session-notification-panel__item--read" : ""}${bubbleEnterIds.has(row.id) ? " app-session-notification-panel__item--bubble-enter" : ""}`}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    className="app-session-notification-panel__item-hit"
                    title={titleLines}
                    onClick={() => onJump(row)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onJump(row);
                      }
                    }}
                  >
                    <span className="app-session-notification-panel__dot" aria-hidden />
                    <div className="app-session-notification-panel__item-main">
                      <div className="app-session-notification-panel__item-body">{notificationBodyDisplay}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="app-session-notification-panel__item-read-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      onMarkRead(row);
                    }}
                  >
                    已读
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});
