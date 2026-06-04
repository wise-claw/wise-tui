import { Popover, type PopoverProps } from "antd";
import type { ReactNode } from "react";

type MonitorLazyClickPopoverProps = Omit<PopoverProps, "open" | "onOpenChange" | "children" | "trigger"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  renderTrigger: (handlers: { requestOpen: () => void }) => ReactNode;
};

/**
 * 仅在 open 时挂载 Ant Popover/Trigger，避免左栏窄宽下关闭态 ResizeObserver + passive effect 死循环。
 */
export function MonitorLazyClickPopover({
  open,
  onOpenChange,
  renderTrigger,
  destroyOnHidden = true,
  ...popoverProps
}: MonitorLazyClickPopoverProps) {
  if (!open) {
    return <>{renderTrigger({ requestOpen: () => onOpenChange(true) })}</>;
  }

  return (
    <Popover
      {...popoverProps}
      open
      trigger="click"
      destroyOnHidden={destroyOnHidden}
      onOpenChange={onOpenChange}
    >
      {renderTrigger({ requestOpen: () => onOpenChange(true) })}
    </Popover>
  );
}
