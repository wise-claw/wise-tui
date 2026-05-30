import { useMemo, useState } from "react";
import { Button, Popover } from "antd";
import { ContextDetailPopover } from "./ContextDetailPopover";
import type { ContextBreakdownSnapshot } from "../../services/claudeContextBreakdown";

const RING_SIZE = 14;
const STROKE_WIDTH = 3;

export interface ContextCompactProgressRingProps {
  percent: number;
  toneClassName: string;
  /** 与底栏状态行 `ctx:…` 片段一致，用于详情面板摘要 */
  ctxStatusLine?: string;
  className?: string;
  "data-ui-anchor"?: string;
  breakdown?: ContextBreakdownSnapshot | null;
  breakdownLoading?: boolean;
  onBreakdownOpen?: () => void;
}

/** 输入框底栏：上下文占用圆环（点击查看详情） */
export function ContextCompactProgressRing({
  percent,
  toneClassName,
  ctxStatusLine,
  className,
  "data-ui-anchor": dataUiAnchor,
  breakdown,
  breakdownLoading = false,
  onBreakdownOpen,
}: ContextCompactProgressRingProps) {
  const [open, setOpen] = useState(false);
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

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      onBreakdownOpen?.();
    }
    setOpen(nextOpen);
  };

  return (
    <Popover
      trigger="click"
      placement="topLeft"
      open={open}
      destroyOnHidden
      overlayClassName="app-claude-context-detail-popover"
      onOpenChange={handleOpenChange}
      content={
        <ContextDetailPopover
          breakdown={breakdown ?? null}
          loading={breakdownLoading}
        />
      }
    >
      <Button
        type="text"
        size="small"
        className={[
          "app-claude-context-compact-ring",
          toneClassName,
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        data-ui-anchor={dataUiAnchor}
        aria-label={`上下文约 ${pct}%，点击查看详情`}
        aria-haspopup="dialog"
        aria-expanded={open}
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
        {ctxStatusLine ? (
          <span className="app-claude-context-compact-ring__sr-only">{ctxStatusLine}</span>
        ) : null}
      </Button>
    </Popover>
  );
}
