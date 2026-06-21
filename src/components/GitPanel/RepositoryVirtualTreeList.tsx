import { memo, useSyncExternalStore, type RefObject } from "react";
import { useVirtualListVisibleRange } from "../../hooks/useVirtualListVisibleRange";
import { ExplorerInlineCreateRow } from "./ExplorerInlineCreateRow";
import { RepositoryTreeDirRow } from "./RepositoryTreeDirRow";
import { RepositoryTreeFileNode } from "./RepositoryTreeFileNode";
import { repositoryTreeDepthIndentPx, REPOSITORY_TREE_ROW_HEIGHT_PX } from "./repositoryTreeLayout";
import {
  isMainThreadCongested,
  subscribeMainThreadCongestion,
} from "../../stores/mainThreadCongestionStore";
import type { FlatRepositoryTreeRow } from "./repositoryTreeFlatten";
import type { ExplorerInlineCreateState } from "./types";

const OVERSCAN_ROWS = 16;
const OVERSCAN_ROWS_CONGESTED = 6;
const FILE_TREE_BUSY_RANGE_MIN_MS = 24;
const FILE_TREE_CONGESTED_BUSY_RANGE_MIN_MS = 40;

function useFileTreeOverscanRows(): number {
  return useSyncExternalStore(
    subscribeMainThreadCongestion,
    () => (isMainThreadCongested() ? OVERSCAN_ROWS_CONGESTED : OVERSCAN_ROWS),
    () => OVERSCAN_ROWS,
  );
}

function useFileTreeBusyRangeMinMs(): number {
  return useSyncExternalStore(
    subscribeMainThreadCongestion,
    () =>
      isMainThreadCongested() ? FILE_TREE_CONGESTED_BUSY_RANGE_MIN_MS : FILE_TREE_BUSY_RANGE_MIN_MS,
    () => FILE_TREE_BUSY_RANGE_MIN_MS,
  );
}

export interface RepositoryVirtualTreeListProps {
  scrollRootRef: RefObject<HTMLDivElement | null>;
  rows: readonly FlatRepositoryTreeRow[];
  selectedPath: string | null;
  hoverPath: string | null;
  loadingDirKeys: ReadonlySet<string>;
  inlineCreate: ExplorerInlineCreateState | null;
  onInlineValueChange: (value: string) => void;
  onInlineCommit: () => void;
  onInlineCancel: () => void;
  rowHeight?: number;
  gitStatusRevision: number;
  editorDirtyRevision: number;
}

function RepositoryVirtualTreeListInner({
  scrollRootRef,
  rows,
  selectedPath,
  hoverPath,
  loadingDirKeys: _loadingDirKeys,
  inlineCreate: _inlineCreate,
  onInlineValueChange,
  onInlineCommit,
  onInlineCancel,
  rowHeight = REPOSITORY_TREE_ROW_HEIGHT_PX,
  gitStatusRevision,
  editorDirtyRevision,
}: RepositoryVirtualTreeListProps) {
  const overscanRows = useFileTreeOverscanRows();
  const busyRangeMinMs = useFileTreeBusyRangeMinMs();
  const range = useVirtualListVisibleRange({
    scrollRootRef,
    rowCount: rows.length,
    rowHeight,
    overscanRows,
    initialVisibleEnd: 48,
    busyRangeMinMs,
    // 文件树滚动须同步跟随 scrollTop，消除快速滑动的大片空白与卡顿。
    preferSyncRangeUpdates: true,
  });

  const totalHeight = rows.length * rowHeight;
  const slice = rows.slice(range.start, range.end);

  return (
    <div className="repo-tree-virtual-list" aria-rowcount={rows.length}>
      <div className="repo-tree-virtual-list__spacer" style={{ height: totalHeight }}>
        {slice.map((row, index) => {
          const top = (range.start + index) * rowHeight;
          return (
            <div
              key={row.key}
              className="repo-tree-virtual-list__row"
              style={{ top, height: rowHeight }}
            >
              {row.kind === "dir" ? (
                <RepositoryTreeDirRow
                  node={row.node}
                  depth={row.depth}
                  isExpanded={row.isExpanded}
                  selectedPath={selectedPath}
                  hoverPath={hoverPath}
                  gitStatusRevision={gitStatusRevision}
                />
              ) : null}
              {row.kind === "file" ? (
                <RepositoryTreeFileNode
                  node={row.node}
                  depth={row.depth}
                  selectedPath={selectedPath}
                  hoverPath={hoverPath}
                  gitStatusRevision={gitStatusRevision}
                  editorDirtyRevision={editorDirtyRevision}
                />
              ) : null}
              {row.kind === "loading" ? (
                <div
                  className="repo-tree-children-loading repo-tree-virtual-list__hint"
                  style={{ paddingLeft: repositoryTreeDepthIndentPx(row.depth) }}
                  aria-live="polite"
                >
                  加载中…
                </div>
              ) : null}
              {row.kind === "empty-dir" ? (
                <div
                  className="repo-tree-children-loading repo-tree-virtual-list__hint"
                  style={{ paddingLeft: repositoryTreeDepthIndentPx(row.depth) }}
                  aria-live="polite"
                >
                  空文件夹
                </div>
              ) : null}
              {row.kind === "inline-create" ? (
                <ExplorerInlineCreateRow
                  depth={row.depth}
                  kind={row.inline.type}
                  value={row.inline.value}
                  onChange={onInlineValueChange}
                  onCommit={onInlineCommit}
                  onCancel={onInlineCancel}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const RepositoryVirtualTreeList = memo(RepositoryVirtualTreeListInner);
