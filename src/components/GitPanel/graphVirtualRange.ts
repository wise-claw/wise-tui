export const GIT_GRAPH_VIRTUAL_THRESHOLD = 50;
export const GIT_GRAPH_VIRTUAL_OVERSCAN_ROWS = 8;

export interface GraphVirtualRange {
  start: number;
  end: number;
}

export function computeGraphVirtualRange(
  scrollTop: number,
  viewportHeight: number,
  totalRows: number,
  rowHeight: number,
  overscanRows = GIT_GRAPH_VIRTUAL_OVERSCAN_ROWS,
): GraphVirtualRange {
  if (totalRows <= 0) {
    return { start: 0, end: 0 };
  }
  const height = Math.max(viewportHeight, rowHeight);
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows);
  const visibleRows = Math.ceil(height / rowHeight) + overscanRows * 2;
  const end = Math.min(totalRows, start + visibleRows);
  return { start, end };
}

export function shouldVirtualizeGraphRows(totalRows: number): boolean {
  return totalRows > GIT_GRAPH_VIRTUAL_THRESHOLD;
}

export function isGraphEdgeVisible(
  edge: { fromRow: number; toRow: number },
  range: GraphVirtualRange,
  paddingRows = 10,
): boolean {
  const lo = range.start - paddingRows;
  const hi = range.end + paddingRows;
  const minRow = Math.min(edge.fromRow, edge.toRow);
  const maxRow = Math.max(edge.fromRow, edge.toRow);
  return maxRow >= lo && minRow <= hi;
}
