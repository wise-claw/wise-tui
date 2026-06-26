import type { ReactNode } from "react";
import { DeferredHoverTooltip } from "../shared/DeferredHoverTooltip";

export type RepositoryActiveSessionBadgeProps = {
  count: number;
};

export function RepositoryActiveSessionBadge({
  count,
}: RepositoryActiveSessionBadgeProps): ReactNode {
  if (count <= 0) return null;

  return (
    <DeferredHoverTooltip title={`${count} 个活跃会话`}>
      <span
        className="app-repository-active-session-badge"
        aria-label={`${count} 个活跃会话`}
      >
        {count > 99 ? "99+" : count}
      </span>
    </DeferredHoverTooltip>
  );
}
