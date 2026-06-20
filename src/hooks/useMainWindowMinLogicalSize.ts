import { useEffect } from "react";
import { syncMainWindowMinLogicalSize } from "../services/mainWindowLayout";
import type { PaneCount } from "../constants/mainLayoutWidths";

export function useMainWindowMinLogicalSize(options: {
  paneCount: PaneCount;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  leftWidthPx: number;
  rightWidthPx: number;
}): void {
  const { paneCount, leftCollapsed, rightCollapsed, leftWidthPx, rightWidthPx } = options;

  useEffect(() => {
    void syncMainWindowMinLogicalSize({
      paneCount,
      leftCollapsed,
      rightCollapsed,
      leftWidthPx,
      rightWidthPx,
    });
  }, [leftCollapsed, leftWidthPx, paneCount, rightCollapsed, rightWidthPx]);
}
