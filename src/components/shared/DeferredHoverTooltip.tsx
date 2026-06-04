import { Tooltip, type TooltipProps } from "antd";

/** 侧栏/列表密集区：拉长进入延迟并销毁浮层，避免快速划过时 Tooltip 抢主线程。 */
const DEFERRED_HOVER_TOOLTIP_PROPS = {
  mouseEnterDelay: 0.52,
  mouseLeaveDelay: 0.05,
} as const satisfies Partial<TooltipProps>;

export function DeferredHoverTooltip({ children, ...props }: TooltipProps) {
  return (
    <Tooltip {...DEFERRED_HOVER_TOOLTIP_PROPS} {...props}>
      {children}
    </Tooltip>
  );
}
