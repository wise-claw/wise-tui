export const DEFAULT_TWO_PANE_SPLIT_RATIO = 0.5;

/** 将双屏分栏比例限制在「每侧至少 minPaneWidthPx」的可行范围内。 */
export function clampTwoPaneSplitRatio(
  ratio: number,
  containerWidthPx: number,
  minPaneWidthPx: number,
): number {
  if (!Number.isFinite(containerWidthPx) || containerWidthPx <= 0) {
    return DEFAULT_TWO_PANE_SPLIT_RATIO;
  }
  if (containerWidthPx <= minPaneWidthPx * 2) {
    return DEFAULT_TWO_PANE_SPLIT_RATIO;
  }
  const minRatio = minPaneWidthPx / containerWidthPx;
  const maxRatio = 1 - minRatio;
  if (!Number.isFinite(ratio)) {
    return DEFAULT_TWO_PANE_SPLIT_RATIO;
  }
  return Math.min(maxRatio, Math.max(minRatio, ratio));
}

export function formatTwoPaneSplitGridTemplateColumns(ratio: number): string {
  const left = Number.isFinite(ratio)
    ? Math.min(1, Math.max(0, ratio))
    : DEFAULT_TWO_PANE_SPLIT_RATIO;
  const right = 1 - left;
  return `${left}fr ${right}fr`;
}

/** 由比例与容器宽度得到左栏像素宽度（与分隔条、grid 列对齐）。 */
export function resolveTwoPaneLeftWidthPx(
  ratio: number,
  containerWidthPx: number,
  minPaneWidthPx: number,
): number {
  const clamped = clampTwoPaneSplitRatio(ratio, containerWidthPx, minPaneWidthPx);
  return Math.round(containerWidthPx * clamped);
}

export function formatTwoPaneSplitGridTemplateColumnsPx(
  leftWidthPx: number,
): string {
  return `${Math.max(0, leftWidthPx)}px minmax(0, 1fr)`;
}
