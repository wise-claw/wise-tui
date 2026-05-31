import { Tooltip } from "antd";
import { memo } from "react";
import type { ClaudeSession } from "../../types";
import { buildClaudeSessionHoverTitle } from "../../utils/claudeSessionIdTooltip";

export interface ClaudeChatSessionOwnerBarProps {
  session: ClaudeSession;
  type: "main" | "employee" | "team";
  typeLabel: string;
  name: string;
  effectiveReturnMainSessionId: string | null;
  onCancel: () => void;
  onReturnMainSession: () => void;
}

export const ClaudeChatSessionOwnerBar = memo(function ClaudeChatSessionOwnerBar({
  session,
  type,
  typeLabel,
  name,
  effectiveReturnMainSessionId,
  onCancel,
  onReturnMainSession,
}: ClaudeChatSessionOwnerBarProps) {
  const panel = (
    <div className="app-session-owner-panel">
      <span className={`app-session-owner-panel__tag app-session-owner-panel__tag--${type}`}>
        {typeLabel}
      </span>
      {name.trim() ? <span className="app-session-owner-panel__text">{name}</span> : null}
      {session.status === "running" || session.status === "connecting" ? (
        <Tooltip title="结束当前 Claude Code 运行（与输入区结束按钮相同）" placement="bottom" mouseEnterDelay={0.35}>
          <button
            type="button"
            className="app-session-owner-panel__end-btn"
            aria-label="结束当前运行"
            onClick={() => onCancel()}
          >
            结束
          </button>
        </Tooltip>
      ) : null}
      {effectiveReturnMainSessionId ? (
        <Tooltip title="返回主会话" placement="bottom">
          <button
            type="button"
            className="app-session-owner-panel__return-btn"
            aria-label="返回主会话"
            onClick={onReturnMainSession}
          >
            <svg viewBox="0 0 16 16" aria-hidden>
              <path
                d="M7 4L4.5 6.5L7 9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M5 6.5H9.2C11.3 6.5 13 8.2 13 10.3C13 12.4 11.3 14 9.2 14H5.8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </Tooltip>
      ) : null}
    </div>
  );

  if (type === "main") {
    return panel;
  }

  return (
    <Tooltip title={buildClaudeSessionHoverTitle(session)} placement="top" mouseEnterDelay={0.35}>
      {panel}
    </Tooltip>
  );
});
