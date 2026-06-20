import { useMemo, useSyncExternalStore } from "react";
import {
  getGitRepositoryExplorerStatusGeneration,
  getGitRepositoryExplorerStatusSnapshot,
  subscribeGitRepositoryExplorerStatus,
} from "../stores/gitRepositoryExplorerStatusStore";

export function useGitRepositoryExplorerStatus(repositoryPath: string) {
  const trimmedPath = repositoryPath.trim();
  const generation = useSyncExternalStore(
    (listener) => subscribeGitRepositoryExplorerStatus(trimmedPath, listener),
    () => getGitRepositoryExplorerStatusGeneration(trimmedPath),
    () => 0,
  );
  const index = getGitRepositoryExplorerStatusSnapshot(trimmedPath);

  return useMemo(
    () => ({
      generation,
      getFileStatus: (path: string) =>
        trimmedPath ? (index.fileStatusByPath.get(path) ?? null) : null,
      getDirStatus: (path: string) =>
        trimmedPath ? (index.dirStatusByPath.get(path) ?? null) : null,
      dirHasChanges: (path: string) =>
        trimmedPath ? index.dirsWithChanges.has(path) : false,
    }),
    [generation, index, trimmedPath],
  );
}
