import type { TooltipProps } from "antd";
import { HoverHint } from "./HoverHint";

/** @deprecated 使用 HoverHint；保留别名以兼容现有 import。 */
export function DeferredHoverTooltip(props: TooltipProps) {
  return <HoverHint {...props} />;
}
