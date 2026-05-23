import { Tooltip } from "antd";
import { useCallback, useState } from "react";
import type { ClaudeSession } from "../../types";
import { SessionDataLinkDrawer } from "./SessionDataLinkDrawer";
import "./SessionDataLinkTopbarTrigger.css";

/** 全链路分析：三节点拓扑（用户 → Claude Code → 模型/FCC）。 */
export function IconSessionDataLink() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="6" cy="7" r="2.25" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="18" cy="7" r="2.25" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="12" cy="17" r="2.25" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M8 8.2 10.5 14.8M16 8.2 13.5 14.8M8.2 7h7.6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface Props {
  /** 当前项目/仓库主会话（与侧栏「主会话」绑定一致） */
  mainSession: ClaudeSession | null;
}

export function SessionDataLinkTopbarTrigger({ mainSession }: Props) {
  const [open, setOpen] = useState(false);
  const disabled = !mainSession;

  const handleClick = useCallback(() => {
    if (!mainSession) return;
    setOpen(true);
  }, [mainSession]);

  const tooltipTitle = disabled
    ? "当前项目/仓库暂无主会话"
    : `全链路分析 · 主会话：${mainSession.repositoryName.trim() || "未命名"}`;

  return (
    <>
      <Tooltip title={tooltipTitle} mouseEnterDelay={0.35}>
        <button
          type="button"
          className={
            "app-topbar-btn app-session-data-link-topbar-btn" + (open ? " active" : "") + (disabled ? " disabled" : "")
          }
          aria-label="全链路分析"
          aria-expanded={open}
          disabled={disabled}
          onClick={handleClick}
        >
          <IconSessionDataLink />
        </button>
      </Tooltip>
      <SessionDataLinkDrawer open={open} onClose={() => setOpen(false)} session={mainSession} />
    </>
  );
}
