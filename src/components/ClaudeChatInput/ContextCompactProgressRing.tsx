import { useMemo } from "react";
import { Tooltip } from "antd";

const RING_SIZE = 14;
const STROKE_WIDTH = 1.5;

export interface ContextCompactProgressRingProps {
  percent: number;
  toneClassName: string;
  /** 与底栏状态行 `ctx:…` 片段一致，用于 Tooltip 首行 */
  ctxStatusLine?: string;
  disabled?: boolean;
  inFlight?: boolean;
  tooltip: string;
  onClick: () => void;
  className?: string;
  "data-ui-anchor"?: string;
}

/** 输入框底栏：上下文占用圆环（点击执行 /compact） */
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

  const tipTitle = (
    <span className="app-claude-context-compact-ring__tip">
      <span className={`app-claude-context-compact-ring__tip-ctx ${toneClassName}`}>
        {ctxStatusLine ?? `ctx:${pct}%`}
      </span>
      <span className="app-claude-context-compact-ring__tip-body">{tooltip}</span>
    </span>
  );

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
      aria-label={`压缩上下文，当前约 ${pct}%`}
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
    <Tooltip title={tipTitle} mouseEnterDelay={0.3} placement="top">
      <span
        className={[
          "app-claude-context-compact-ring-wrap",
          disabled ? "app-claude-context-compact-ring-wrap--disabled" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {ringButton}
      </span>
    </Tooltip>
  );
}
