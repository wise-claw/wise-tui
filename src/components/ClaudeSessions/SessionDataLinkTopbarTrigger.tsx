import { Tooltip } from "antd";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ClaudeSession } from "../../types";
import {
  getClaudeUsageUiStoreSnapshot,
  subscribeClaudeUsageUiStore,
  type SessionDataLinkOpenView,
} from "../../stores/claudeUsageUiStore";
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

export interface SessionDataLinkTopbarTriggerProps {
  /** 当前项目/仓库主会话（与侧栏「主会话」绑定一致） */
  mainSession: ClaudeSession | null;
  onRequestAiAnalysis?: (prompt: string) => void | Promise<void>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerHidden?: boolean;
}

export function SessionDataLinkTopbarTrigger({
  mainSession,
  onRequestAiAnalysis,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  triggerHidden = false,
}: SessionDataLinkTopbarTriggerProps) {
  const uiSnap = useSyncExternalStore(
    subscribeClaudeUsageUiStore,
    getClaudeUsageUiStoreSnapshot,
    getClaudeUsageUiStoreSnapshot,
  );
  const lastLinkOpenNonce = useRef(uiSnap.sessionDataLinkOpenNonce);

  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [initialViewMode, setInitialViewMode] = useState<SessionDataLinkOpenView>("list");
  const disabled = !mainSession;

  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOnOpenChange) {
        controlledOnOpenChange(next);
      } else {
        setInternalOpen(next);
      }
    },
    [controlledOnOpenChange],
  );

  useEffect(() => {
    if (uiSnap.sessionDataLinkOpenNonce === lastLinkOpenNonce.current) return;
    lastLinkOpenNonce.current = uiSnap.sessionDataLinkOpenNonce;
    if (!mainSession) return;
    setInitialViewMode(uiSnap.sessionDataLinkInitialView);
    setOpen(true);
  }, [uiSnap.sessionDataLinkOpenNonce, uiSnap.sessionDataLinkInitialView, mainSession, setOpen]);

  const handleClick = useCallback(() => {
    if (!mainSession) return;
    setInitialViewMode("list");
    setOpen(true);
  }, [mainSession, setOpen]);

  const tooltipTitle = disabled
    ? "当前项目/仓库暂无主会话"
    : `全链路分析 · 主会话：${mainSession.repositoryName.trim() || "未命名"}`;

  return (
    <>
      {triggerHidden ? (
        <span className="app-topbar-overflow-anchor" tabIndex={-1} aria-hidden />
      ) : (
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
      )}
      <SessionDataLinkDrawer
        open={open}
        onClose={() => setOpen(false)}
        session={mainSession}
        initialViewMode={initialViewMode}
        onRequestAiAnalysis={onRequestAiAnalysis}
      />
    </>
  );
}
