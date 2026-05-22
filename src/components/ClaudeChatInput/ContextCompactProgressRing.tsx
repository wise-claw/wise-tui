import { useMemo } from "react";
import { Popover } from "antd";
import { ContextDetailPopover } from "./ContextDetailPopover";
import type { ContextBreakdownSnapshot } from "../../services/claudeContextBreakdown";

const RING_SIZE = 14;
const STROKE_WIDTH = 1.5;

export interface ContextCompactProgressRingProps {
  percent: number;
  toneClassName: string;
  /** 与底栏状态行 `ctx:…` 片段一致，用于详情面板摘要 */
  ctxStatusLine?: string;
  disabled?: boolean;
  inFlight?: boolean;
  tooltip: string;
  onClick: () => void;
  className?: string;
  "data-ui-anchor"?: string;
  breakdown?: ContextBreakdownSnapshot | null;
  breakdownLoading?: boolean;
  onBreakdownHover?: () => void;
}

/** 输入框底栏：上下文占用圆环（悬停详情，点击 /compact） */
export function ContextCompactProgressRing({
  percent,
  toneClassName,
  ctxStatusLine,
  disabled = false,
  inFlight = false,
  tooltip,
  onClick,
  className,
  "data-ui-anchor": dataUiAnchor,
  breakdown,
  breakdownLoading = false,
  onBreakdownHover,
}: ContextCompactProgressRingProps) {
  const pct = Math.min(100, Math.max(0, Math.round(percent)));
  const { radius, circumference, dashOffset, center } = useMemo(() => {
    const r = (RING_SIZE - STROKE_WIDTH) / 2;
    const c = 2 * Math.PI * r;
    return {
      radius: r,
      circumference: c,
      dashOffset: c * (1 - pct / 100),
      center: RING_SIZE / 2,
    };
  }, [pct]);

  const ringButton = (
    <button
      type="button"
      className={[
        "app-claude-context-compact-ring",
        toneClassName,
        inFlight ? "app-claude-context-compact-ring--in-flight" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-ui-anchor={dataUiAnchor}
      disabled={disabled}
      aria-busy={inFlight}
      aria-label={`上下文约 ${pct}%，点击可手动压缩`}
      title={tooltip}
      onClick={onClick}
    >
      <svg
        className="app-claude-context-compact-ring__svg"
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        aria-hidden
      >
        <circle
          className="app-claude-context-compact-ring__track"
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={STROKE_WIDTH}
        />
        <circle
          className="app-claude-context-compact-ring__progress"
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
    </button>
  );

  return (
    <Popover
      trigger="hover"
      placement="topLeft"
      mouseEnterDelay={0.2}
      destroyOnHidden
      overlayClassName="app-claude-context-detail-popover"
      onOpenChange={(open) => {
        if (open) onBreakdownHover?.();
      }}
      content={
        <ContextDetailPopover
          breakdown={breakdown ?? null}
          loading={breakdownLoading}
          compactHint={tooltip}
        />
      }
    >
      <span
        className={[
          "app-claude-context-compact-ring-wrap",
          disabled ? "app-claude-context-compact-ring-wrap--disabled" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onMouseEnter={() => onBreakdownHover?.()}
      >
        {ringButton}
        {ctxStatusLine ? (
          <span className="app-claude-context-compact-ring__sr-only">{ctxStatusLine}</span>
        ) : null}
      </span>
    </Popover>
  );
}
