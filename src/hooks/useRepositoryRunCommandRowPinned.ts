import { useSyncExternalStore } from "react";
import type { RepositoryRunCommandRowPinnedMap } from "../services/repositoryRunCommandRowActionPreference";
import { isRepositoryRunCommandRowPinned } from "../services/repositoryRunCommandRowActionPreference";
import {
  getRepositoryRunCommandRowPinnedMapSnapshot,
  subscribeRepositoryRunCommandRowPinnedMap,
} from "../stores/repositoryRunCommandRowPinnedStore";

/** 各仓库是否显示行内运行 / 停止按钮（运行菜单内按仓库配置）。 */
export function useRepositoryRunCommandRowPinnedMap(): RepositoryRunCommandRowPinnedMap {
  return useSyncExternalStore(
    subscribeRepositoryRunCommandRowPinnedMap,
    getRepositoryRunCommandRowPinnedMapSnapshot,
    getRepositoryRunCommandRowPinnedMapSnapshot,
  );
}

export function useRepositoryRunCommandRowPinned(repositoryId: number): boolean {
  const map = useRepositoryRunCommandRowPinnedMap();
  return isRepositoryRunCommandRowPinned(map, repositoryId);
}
