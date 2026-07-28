import { useCallback, useEffect, useState } from "react";
import { WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT_DEFAULT } from "../constants/workspaceSidebarLayout";
import {
  loadWorkspaceSidebarRowPreviewLimitFromStore,
  WISE_WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT_CHANGED,
} from "../services/wiseDefaultConfigStore";

/** 工作区展开子树默认展示行数（会话 + 运行项合计）。 */
export function useWorkspaceSidebarRowPreviewLimit(): number {
  const [limit, setLimit] = useState(WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT_DEFAULT);

  const apply = useCallback((next: number) => {
    setLimit(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadWorkspaceSidebarRowPreviewLimitFromStore().then((loaded) => {
      if (!cancelled) apply(loaded);
    });
    const onChanged = (event: Event) => {
      const next = (event as CustomEvent<{ workspaceSidebarRowPreviewLimit?: number }>).detail
        ?.workspaceSidebarRowPreviewLimit;
      if (typeof next === "number" && Number.isFinite(next)) {
        apply(next);
      }
    };
    window.addEventListener(WISE_WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT_CHANGED, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT_CHANGED, onChanged);
    };
  }, [apply]);

  return limit;
}
