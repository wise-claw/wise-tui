import { useCallback, useEffect, useState } from "react";
import { WORKSPACE_LIST_VISIBLE_ROWS_DEFAULT } from "../constants/workspaceListLayout";
import {
  loadWorkspaceListVisibleRowsFromStore,
  WISE_WORKSPACE_LIST_VISIBLE_ROWS_CHANGED,
} from "../services/wiseDefaultConfigStore";

/** 左栏工作区树内容区可见行数（与文件树并存时封顶高度）。 */
export function useWorkspaceListVisibleRows(): number {
  const [visibleRows, setVisibleRows] = useState(WORKSPACE_LIST_VISIBLE_ROWS_DEFAULT);

  const apply = useCallback((next: number) => {
    setVisibleRows(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadWorkspaceListVisibleRowsFromStore().then((loaded) => {
      if (!cancelled) apply(loaded);
    });
    const onChanged = (event: Event) => {
      const next = (event as CustomEvent<{ workspaceListVisibleRows?: number }>).detail
        ?.workspaceListVisibleRows;
      if (typeof next === "number" && Number.isFinite(next)) {
        apply(next);
      }
    };
    window.addEventListener(WISE_WORKSPACE_LIST_VISIBLE_ROWS_CHANGED, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_WORKSPACE_LIST_VISIBLE_ROWS_CHANGED, onChanged);
    };
  }, [apply]);

  return visibleRows;
}
