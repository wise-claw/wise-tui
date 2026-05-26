import type { MouseEvent } from "react";
import { Button, Tooltip } from "antd";

export function HistorySessionRestoreIcon() {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden>
      <path
        d="M8 2.5v2M8 11.5v2M4.5 8H2.5M11.5 8H13.5M5.2 5.2 3.8 3.8M10.8 5.2l1.4-1.4M5.2 10.8l-1.4 1.4M10.8 10.8l1.4 1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
      />
      <path
        d="M8 5.25a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 0 1 0-5.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.15"
      />
      <path
        d="M6.1 8 7.25 9.15 10.2 6.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface HistorySessionRestoreButtonProps {
  disabled?: boolean;
  className?: string;
  onClick: (event: MouseEvent<HTMLElement>) => void;
}

/** 历史会话列表/抽屉：恢复为主会话（替换当前仓库主会话绑定） */
export function HistorySessionRestoreButton({
  disabled = false,
  className,
  onClick,
}: HistorySessionRestoreButtonProps) {
  return (
    <Tooltip title="恢复为主会话" mouseEnterDelay={0.35}>
      <Button
        type="text"
        size="small"
        className={className}
        disabled={disabled}
        aria-label="恢复为主会话"
        icon={<HistorySessionRestoreIcon />}
        onClick={onClick}
      />
    </Tooltip>
  );
}
