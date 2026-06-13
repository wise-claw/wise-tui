import type { Repository } from "../../types";
import { resolveRepositorySddStackBadgeMeta } from "../../utils/repositorySddStackBadge";
import { DeferredHoverTooltip } from "../shared/DeferredHoverTooltip";
import { TrellisIcon } from "./SidebarIcons";

export function RepositorySddStackBadge({
  repository,
  trellisReady = false,
}: {
  repository: Pick<Repository, "sddMode">;
  trellisReady?: boolean;
}) {
  const meta = resolveRepositorySddStackBadgeMeta(repository.sddMode, trellisReady);
  if (!meta) return null;

  return (
    <DeferredHoverTooltip title={meta.title}>
      <span
        className={`app-repository-sdd-icon app-repository-sdd-icon--${meta.variant}`}
        title={meta.title}
        aria-label={meta.title}
        role="img"
      >
        <TrellisIcon />
      </span>
    </DeferredHoverTooltip>
  );
}
