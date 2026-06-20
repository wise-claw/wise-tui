import { Drawer, Empty, Spin, Typography } from "antd";
import { useCallback, useState } from "react";
import { HoverHint } from "../shared/HoverHint";
import type { ClaudeSession } from "../../types";
import { useSessionFeedbackLoopWorkspace } from "../../hooks/useSessionFeedbackLoopWorkspace";
import { SessionFeedbackLoopPanel } from "./SessionFeedbackLoopPanel";
import type { FeedbackLoopDispatchKind } from "../../utils/sessionFeedbackLoopDispatch";
import { isFeedbackLoopPhaseActive } from "../../utils/sessionFeedbackLoop";
import "./SessionFeedbackLoopTopbarTrigger.css";

const { Text } = Typography;

/** 反馈神经网：三层节点 + 横向反馈弧。 */
export function IconSessionFeedbackLoop() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <g transform="translate(12 12) scale(0.88) translate(-12 -12)">
        <circle cx="5" cy="6" r="2" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="12" cy="4" r="2" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="19" cy="6" r="2" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="8" cy="14" r="2" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="16" cy="14" r="2" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="12" cy="20" r="2" fill="currentColor" />
        <path
          d="M6.6 7.4 10.2 5.4M13.8 5.4l3.6 2M7.2 12.2l2.2-5.4M16.8 12.2l-2.2-5.4M9.4 15l1.2 3.4M14.6 15l-1.2 3.4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path
          d="M12 20c-4-2.5-6-5.5-6-8.5 0-1.2.4-2.3 1.2-3.2"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeDasharray="2.5 2"
          opacity="0.75"
        />
      </g>
    </svg>
  );
}

export interface SessionFeedbackLoopTopbarTriggerProps {
  mainSession: ClaudeSession | null;
  onDispatchSessionFeedbackLoop?: (input: {
    anchorSessionId: string;
    prompt: string;
    kind: FeedbackLoopDispatchKind;
    cycleIndex?: number;
  }) => void | Promise<void>;
  getClaudeSessions?: () => readonly ClaudeSession[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerHidden?: boolean;
}

export function SessionFeedbackLoopTopbarTrigger({
  mainSession,
  onDispatchSessionFeedbackLoop,
  getClaudeSessions,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  triggerHidden = false,
}: SessionFeedbackLoopTopbarTriggerProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
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

  const workspace = useSessionFeedbackLoopWorkspace({
    session: mainSession,
    drawerOpen: open,
    onDispatchSessionFeedbackLoop,
    getClaudeSessions,
  });

  const handleClick = useCallback(() => {
    if (!mainSession) return;
    setOpen(true);
  }, [mainSession, setOpen]);

  const dispatchPrompt = useCallback(
    async (prompt: string, kind: FeedbackLoopDispatchKind, cycleIndex?: number) => {
      if (!mainSession?.id || !onDispatchSessionFeedbackLoop) return;
      await onDispatchSessionFeedbackLoop({
        anchorSessionId: mainSession.id,
        prompt,
        kind,
        cycleIndex,
      });
    },
    [mainSession?.id, onDispatchSessionFeedbackLoop],
  );

  const loopActive = isFeedbackLoopPhaseActive(workspace.loop.state.phase);
  const tooltipTitle = disabled
    ? "当前项目/仓库暂无主会话"
    : `反馈神经网 · 主会话：${mainSession.repositoryName.trim() || "未命名"}${loopActive ? "（运行中）" : ""}`;

  return (
    <>
      {triggerHidden ? (
        <span className="app-topbar-overflow-anchor" tabIndex={-1} aria-hidden />
      ) : (
        <HoverHint title={tooltipTitle} open={open ? false : undefined}>
          <button
            type="button"
            className={
              "app-topbar-btn app-session-feedback-loop-topbar-btn" +
              (open ? " active" : "") +
              (disabled ? " disabled" : "") +
              (loopActive ? " app-session-feedback-loop-topbar-btn--running" : "")
            }
            aria-label="反馈神经网"
            aria-expanded={open}
            disabled={disabled}
            onClick={handleClick}
          >
            <IconSessionFeedbackLoop />
          </button>
        </HoverHint>
      )}
      <Drawer
        rootClassName="app-session-feedback-loop-drawer-root"
        title={
          mainSession ? (
            <div className="app-session-feedback-loop-drawer__title">
              <span className="title-dot" />
              <span className="title-text">反馈神经网</span>
              <span className="title-divider">·</span>
              <span className="title-session-label">主会话</span>
              <span className="title-session-name">
                ({mainSession.repositoryName.trim() || "未命名"})
              </span>
            </div>
          ) : (
            "反馈神经网"
          )
        }
        placement="right"
        size={640}
        destroyOnClose={false}
        open={open}
        onClose={() => setOpen(false)}
        styles={{ body: { padding: "12px 14px", overflow: "auto" } }}
      >
        {!mainSession ? (
          <Empty description="请先打开一个会话" />
        ) : workspace.linkDataLoading && !workspace.insights ? (
          <div className="app-session-feedback-loop-drawer__loading">
            <Spin size="small" />
            <Text type="secondary">正在加载会话链路数据…</Text>
          </div>
        ) : (
          <SessionFeedbackLoopPanel
            loop={workspace.loop}
            insights={workspace.insights}
            anchorSessionId={mainSession.id}
            featureEnabled={workspace.setting.enabled}
            injectHabitsToSystemPrompt={workspace.setting.injectHabitsToSystemPrompt}
            optimizeConfigArtifacts={workspace.setting.optimizeConfigArtifacts}
            onDispatchSessionFeedbackLoop={onDispatchSessionFeedbackLoop ? dispatchPrompt : undefined}
          />
        )}
      </Drawer>
    </>
  );
}
