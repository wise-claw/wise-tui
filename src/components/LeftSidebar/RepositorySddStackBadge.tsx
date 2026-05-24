import type { Repository } from "../../types";
import { repositorySddStackBadgeMeta } from "../../utils/repositorySddStackBadge";
import { TrellisIcon } from "./SidebarIcons";

export function RepositorySddStackBadge({ repository }: { repository: Pick<Repository, "sddMode"> }) {
  const meta = repositorySddStackBadgeMeta(repository.sddMode);
  if (!meta) return null;

  return (
    <span className="app-repository-sdd-icon" title={meta.title} aria-label={meta.title}>
      <TrellisIcon />
    </span>
  );
}
