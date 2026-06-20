import { useMemo, useSyncExternalStore } from "react";
import {
  getRepositoryEditorDirtyDirsSnapshot,
  getRepositoryEditorDirtyPathsGeneration,
  getRepositoryEditorDirtyPathsSnapshot,
  subscribeRepositoryEditorDirtyPaths,
} from "../stores/repositoryEditorDirtyPathsStore";

export function useRepositoryEditorDirtyPaths(repositoryPath: string) {
  const trimmedPath = repositoryPath.trim();
  const generation = useSyncExternalStore(
    (listener) => subscribeRepositoryEditorDirtyPaths(trimmedPath, listener),
    () => getRepositoryEditorDirtyPathsGeneration(trimmedPath),
    () => 0,
  );
  const paths = getRepositoryEditorDirtyPathsSnapshot(trimmedPath);
  const dirs = getRepositoryEditorDirtyDirsSnapshot(trimmedPath);

  return useMemo(
    () => ({
      generation,
      isDirty: (path: string) => (trimmedPath ? paths.has(path) : false),
      dirHasDirty: (path: string) => (trimmedPath ? dirs.has(path) : false),
    }),
    [dirs, generation, paths, trimmedPath],
  );
}
