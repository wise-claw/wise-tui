import { useCallback, useEffect, useState } from "react";
import { REQUIREMENTS_PANEL_VISIBLE_ROWS_DEFAULT } from "../constants/requirementsPanelLayout";
import {
  loadRequirementsPanelVisibleRowsFromStore,
  WISE_REQUIREMENTS_PANEL_VISIBLE_ROWS_CHANGED,
} from "../services/wiseDefaultConfigStore";

/** 左栏需求列表内容区可见行数（超出滚动）。 */
export function useRequirementsPanelVisibleRows(): number {
  const [visibleRows, setVisibleRows] = useState(REQUIREMENTS_PANEL_VISIBLE_ROWS_DEFAULT);

  const apply = useCallback((next: number) => {
    setVisibleRows(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadRequirementsPanelVisibleRowsFromStore().then((loaded) => {
      if (!cancelled) apply(loaded);
    });
    const onChanged = (event: Event) => {
      const next = (event as CustomEvent<{ requirementsPanelVisibleRows?: number }>).detail
        ?.requirementsPanelVisibleRows;
      if (typeof next === "number" && Number.isFinite(next)) {
        apply(next);
      }
    };
    window.addEventListener(WISE_REQUIREMENTS_PANEL_VISIBLE_ROWS_CHANGED, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_REQUIREMENTS_PANEL_VISIBLE_ROWS_CHANGED, onChanged);
    };
  }, [apply]);

  return visibleRows;
}
