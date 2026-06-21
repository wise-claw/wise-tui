import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  getRepositoryEditorDirtyDirsSnapshot,
  getRepositoryEditorDirtyPathsGeneration,
  getRepositoryEditorDirtyPathsSnapshot,
  subscribeRepositoryEditorDirtyPaths,
} from "../stores/repositoryEditorDirtyPathsStore";

export function useRepositoryEditorDirtyPaths(repositoryPath: string) {
  const trimmedPath = repositoryPath.trim();
  // subscribe/getSnapshot 须为稳定引用（useCallback）：否则每次 commit 重订阅，
  // store 在单 consumer 时删除 entry 后重建空 entry，generation 振荡导致未保存
  // 标记不显示（与 useGitRepositoryExplorerStatus 同因）。
  const subscribe = useCallback(
    (listener: () => void) => subscribeRepositoryEditorDirtyPaths(trimmedPath, listener),
    [trimmedPath],
  );
  const getSnapshot = useCallback(
    () => getRepositoryEditorDirtyPathsGeneration(trimmedPath),
    [trimmedPath],
  );
  const generation = useSyncExternalStore(subscribe, getSnapshot, () => 0);
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
