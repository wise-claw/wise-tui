import type { Repository } from "../types";
import { parseWorkspaceRepositoryOrderFromSetting } from "./workspaceRepositoryOrder";

export const WORKSPACE_HIDDEN_REPOSITORY_IDS_STORAGE_KEY =
  "wise.sidebar.workspaceHiddenRepositoryIds.v1";

export function parseHiddenRepositoryIdsFromSetting(
  raw: string | null | undefined,
): number[] {
  return parseWorkspaceRepositoryOrderFromSetting(raw);
}

/** 只保留仍存在的仓库 id，去重；顺序与写入时一致。 */
export function normalizeHiddenRepositoryIds(
  hiddenIds: readonly number[],
  repositoryIds: readonly number[],
): number[] {
  const valid = new Set(repositoryIds);
  const next: number[] = [];
  const used = new Set<number>();
  for (const id of hiddenIds) {
    if (!valid.has(id) || used.has(id)) continue;
    next.push(id);
    used.add(id);
  }
  return next;
}

export function toggleHiddenRepositoryId(
  hiddenIds: readonly number[],
  repositoryId: number,
  hidden: boolean,
): number[] {
  if (!Number.isInteger(repositoryId) || repositoryId <= 0) {
    return hiddenIds.filter((id) => Number.isInteger(id) && id > 0);
  }
  const used = new Set<number>();
  const next: number[] = [];
  for (const id of hiddenIds) {
    if (!Number.isInteger(id) || id <= 0 || used.has(id) || (!hidden && id === repositoryId)) {
      continue;
    }
    next.push(id);
    used.add(id);
  }
  if (hidden && !used.has(repositoryId)) {
    next.push(repositoryId);
  }
  return next;
}

export function filterVisibleWorkspaceRepositories<T extends Pick<Repository, "id">>(
  repositories: readonly T[],
  hiddenIds: readonly number[],
): T[] {
  if (hiddenIds.length === 0) return [...repositories];
  const hidden = new Set(hiddenIds);
  return repositories.filter((repo) => !hidden.has(repo.id));
}
