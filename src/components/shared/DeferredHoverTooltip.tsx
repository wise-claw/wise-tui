import { cloneElement, isValidElement, type ReactElement } from "react";
import { Tooltip, type TooltipProps } from "antd";

/** 侧栏/列表密集区：纯字符串提示用原生 title，避免 Ant Tooltip 在 hover 时挂 portal + align。 */
const DEFERRED_HOVER_TOOLTIP_PROPS = {
  mouseEnterDelay: 0.52,
  mouseLeaveDelay: 0.05,
  destroyTooltipOnHide: true,
} as const satisfies Partial<TooltipProps>;

function canUseNativeTitle(title: TooltipProps["title"]): title is string {
  return typeof title === "string" && title.trim().length > 0;
}

export function DeferredHoverTooltip({ children, title, ...props }: TooltipProps) {
  if (canUseNativeTitle(title) && isValidElement(children)) {
    const child = children as ReactElement<{ title?: string }>;
    if (child.props.title === title) return child;
    return cloneElement(child, { title });
  }
  return (
    <Tooltip {...DEFERRED_HOVER_TOOLTIP_PROPS} {...props} title={title}>
      {children}
    </Tooltip>
  );
}
