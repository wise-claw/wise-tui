import { memo, type RefObject } from "react";
import { useVirtualListVisibleRange } from "../../hooks/useVirtualListVisibleRange";
import { ExplorerInlineCreateRow } from "./ExplorerInlineCreateRow";
import { RepositoryTreeDirRow } from "./RepositoryTreeDirRow";
import { RepositoryTreeFileNode } from "./RepositoryTreeFileNode";
import { repositoryTreeDepthIndentPx, REPOSITORY_TREE_ROW_HEIGHT_PX } from "./repositoryTreeLayout";
import type { FlatRepositoryTreeRow } from "./repositoryTreeFlatten";
import type { ExplorerInlineCreateState } from "./types";

const OVERSCAN_ROWS = 5;
const FILE_TREE_BUSY_RANGE_MIN_MS = 52;

export interface RepositoryVirtualTreeListProps {
  scrollRootRef: RefObject<HTMLDivElement | null>;
  rows: readonly FlatRepositoryTreeRow[];
  selectedPath: string | null;
  loadingDirKeys: ReadonlySet<string>;
  inlineCreate: ExplorerInlineCreateState | null;
  onInlineValueChange: (value: string) => void;
  onInlineCommit: () => void;
  onInlineCancel: () => void;
  rowHeight?: number;
}

function RepositoryVirtualTreeListInner({
  scrollRootRef,
  rows,
  selectedPath,
  loadingDirKeys: _loadingDirKeys,
  inlineCreate: _inlineCreate,
  onInlineValueChange,
  onInlineCommit,
  onInlineCancel,
  rowHeight = REPOSITORY_TREE_ROW_HEIGHT_PX,
}: RepositoryVirtualTreeListProps) {
  const range = useVirtualListVisibleRange({
    scrollRootRef,
    rowCount: rows.length,
    rowHeight,
    overscanRows: OVERSCAN_ROWS,
    initialVisibleEnd: 48,
    busyRangeMinMs: FILE_TREE_BUSY_RANGE_MIN_MS,
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
                />
              ) : null}
              {row.kind === "file" ? (
                <RepositoryTreeFileNode node={row.node} depth={row.depth} selectedPath={selectedPath} />
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
