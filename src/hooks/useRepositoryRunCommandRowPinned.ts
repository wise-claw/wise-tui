import { useCallback, useEffect, useState } from "react";
import {
  loadRepositoryRunCommandRowPinnedMap,
  type RepositoryRunCommandRowPinnedMap,
  WISE_REPOSITORY_RUN_COMMAND_ROW_PINNED_CHANGED,
} from "../services/repositoryRunCommandRowActionPreference";

/** 各仓库是否显示行内运行 / 停止按钮（运行菜单内按仓库配置）。 */
export function useRepositoryRunCommandRowPinnedMap(): RepositoryRunCommandRowPinnedMap {
  const [map, setMap] = useState<RepositoryRunCommandRowPinnedMap>({});

  const apply = useCallback((next: RepositoryRunCommandRowPinnedMap) => {
    setMap(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadRepositoryRunCommandRowPinnedMap().then((loaded) => {
      if (!cancelled) apply(loaded);
    });
    const onChanged = (event: Event) => {
      const next = (event as CustomEvent<{ map?: RepositoryRunCommandRowPinnedMap }>).detail?.map;
      if (next && typeof next === "object") apply(next);
    };
    window.addEventListener(WISE_REPOSITORY_RUN_COMMAND_ROW_PINNED_CHANGED, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_REPOSITORY_RUN_COMMAND_ROW_PINNED_CHANGED, onChanged);
    };
  }, [apply]);

  return map;
}

export function useRepositoryRunCommandRowPinned(repositoryId: number): boolean {
  const map = useRepositoryRunCommandRowPinnedMap();
  return map[repositoryId] === true;
}
