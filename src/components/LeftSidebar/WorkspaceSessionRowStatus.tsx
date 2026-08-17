import { memo, useEffect, useRef, useState } from "react";
import { useElementInfiniteSpin } from "../../hooks/useElementInfiniteSpin";

export type WorkspaceSessionRowLiveStatus =
  | "idle"
  | "connecting"
  | "running"
  | "completed"
  | "cancelled"
  | "error"
  | "in_progress"
  | "failed";

export type WorkspaceSessionRowVisualStatus = "running" | "completed" | "error" | "idle";

export function isWorkspaceSessionLiveRunning(status: WorkspaceSessionRowLiveStatus): boolean {
  return status === "running" || status === "connecting" || status === "in_progress";
}

export function isWorkspaceSessionLiveCompleted(status: WorkspaceSessionRowLiveStatus): boolean {
  return status === "completed";
}

export function isWorkspaceSessionLiveError(status: WorkspaceSessionRowLiveStatus): boolean {
  return status === "error" || status === "cancelled" || status === "failed";
}

/** Resolve sticky/live visual without latched idle-completion (pure). */
export function resolveWorkspaceSessionStickyVisual(
  liveStatus: WorkspaceSessionRowLiveStatus,
): WorkspaceSessionRowVisualStatus | null {
  if (isWorkspaceSessionLiveRunning(liveStatus)) return "running";
  if (isWorkspaceSessionLiveCompleted(liveStatus)) return "completed";
  if (isWorkspaceSessionLiveError(liveStatus)) return "error";
  return null;
}

/**
 * Map live session/run status to a sidebar visual.
 * Streaming-resident turns land on idle: keep "completed" until the next run starts.
 */
export function useWorkspaceSessionRowVisualStatus(
  liveStatus: WorkspaceSessionRowLiveStatus,
): WorkspaceSessionRowVisualStatus | null {
  const [latchedCompleted, setLatchedCompleted] = useState(false);
  const prevRunningRef = useRef(isWorkspaceSessionLiveRunning(liveStatus));

  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    const nowRunning = isWorkspaceSessionLiveRunning(liveStatus);
    prevRunningRef.current = nowRunning;

    if (nowRunning) {
      setLatchedCompleted(false);
      return;
    }

    if (!wasRunning) {
      return;
    }

    // Turn ended as idle (or equivalent): latch completed until next execution.
    if (!isWorkspaceSessionLiveError(liveStatus)) {
      setLatchedCompleted(true);
    }
  }, [liveStatus]);

  const sticky = resolveWorkspaceSessionStickyVisual(liveStatus);
  if (sticky) return sticky;
  if (latchedCompleted) return "completed";
  return null;
}

function RunningIcon() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  useElementInfiniteSpin(svgRef, 750);
  return (
    <svg
      ref={svgRef}
      className="app-workspace-session-status__svg app-workspace-session-status__svg--spin"
      viewBox="0 0 16 16"
      aria-hidden
    >
      <circle className="app-workspace-session-status__track" cx="8" cy="8" r="5.75" fill="none" />
      <circle className="app-workspace-session-status__arc" cx="8" cy="8" r="5.75" fill="none" />
    </svg>
  );
}

function CompletedIcon() {
  return (
    <svg className="app-workspace-session-status__svg" viewBox="0 0 16 16" aria-hidden>
      <circle className="app-workspace-session-status__ripple" cx="8" cy="8" r="5.5" fill="none" />
      <circle className="app-workspace-session-status__fill app-workspace-session-status__fill--completed" cx="8" cy="8" r="5.5" />
      <path
        className="app-workspace-session-status__check"
        d="M5.15 8.15 7.05 10.05 10.95 5.9"
        fill="none"
      />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg className="app-workspace-session-status__svg" viewBox="0 0 16 16" aria-hidden>
      <circle className="app-workspace-session-status__fill app-workspace-session-status__fill--error" cx="8" cy="8" r="5.5" />
      <path
        className="app-workspace-session-status__cross"
        d="M5.9 5.9 10.1 10.1 M10.1 5.9 5.9 10.1"
        fill="none"
      />
    </svg>
  );
}

/** 未运行过的会话：中性占位，既补齐状态列对齐，也避免读成「已成功」。 */
function IdleIcon() {
  return (
    <svg className="app-workspace-session-status__svg" viewBox="0 0 16 16" aria-hidden>
      <circle className="app-workspace-session-status__dot--idle" cx="8" cy="8" r="2.5" />
    </svg>
  );
}

function statusLabel(status: WorkspaceSessionRowVisualStatus): string {
  if (status === "running") return "运行中";
  if (status === "completed") return "已完成";
  if (status === "idle") return "未运行";
  return "已失败";
}

export const WorkspaceSessionRowStatus = memo(function WorkspaceSessionRowStatus({
  status,
}: {
  status: WorkspaceSessionRowVisualStatus;
}) {
  return (
    <span
      className={`app-workspace-session-status app-workspace-session-status--${status}`}
      role="status"
      aria-label={statusLabel(status)}
      title={statusLabel(status)}
    >
      {status === "running" ? <RunningIcon /> : null}
      {status === "completed" ? <CompletedIcon /> : null}
      {status === "error" ? <ErrorIcon /> : null}
      {status === "idle" ? <IdleIcon /> : null}
    </span>
  );
});

/** Per-row slot: resolves live status → visual (incl. latched idle completion) and renders leftmost indicator. */
export const WorkspaceSessionRowStatusSlot = memo(function WorkspaceSessionRowStatusSlot({
  liveStatus,
}: {
  liveStatus: WorkspaceSessionRowLiveStatus;
}) {
  const visual = useWorkspaceSessionRowVisualStatus(liveStatus);
  return <WorkspaceSessionRowStatus status={visual ?? "idle"} />;
});
