import { useCallback, useSyncExternalStore } from "react";
import {
  getGitRepositoryStatsGeneration,
  getGitRepositoryStatsSnapshot,
  subscribeGitRepositoryStats,
  type GitRepositoryStats,
} from "../stores/gitRepositoryStatsStore";

const EMPTY_STATS: GitRepositoryStats = { additions: 0, deletions: 0, ahead: 0, behind: 0 };

export function useGitRepositoryStats(repositoryPath: string | null | undefined): GitRepositoryStats {
  const path = repositoryPath?.trim() ?? "";

  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeGitRepositoryStats(path, onStoreChange),
    [path],
  );
  const getSnapshot = useCallback(() => getGitRepositoryStatsGeneration(path), [path]);
  const generation = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  void generation;
  if (!path) return EMPTY_STATS;
  return getGitRepositoryStatsSnapshot(path);
}
