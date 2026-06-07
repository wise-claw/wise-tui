import { useVirtualListVisibleRange } from "../../hooks/useVirtualListVisibleRange";
import { useRef, type ReactNode } from "react";
import type { GitFileStatus } from "../../types";
import { GIT_PANEL_FILE_ROW_HEIGHT } from "./gitPanelUtils";

interface GitVirtualFileListProps {
  files: GitFileStatus[];
  rowHeight?: number;
  renderRow: (file: GitFileStatus) => ReactNode;
}

const OVERSCAN_ROWS = 8;

export function GitVirtualFileList({
  files,
  rowHeight = GIT_PANEL_FILE_ROW_HEIGHT,
  renderRow,
}: GitVirtualFileListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const range = useVirtualListVisibleRange({
    scrollRootRef: scrollRef,
    rowCount: files.length,
    rowHeight,
    overscanRows: OVERSCAN_ROWS,
    initialVisibleEnd: 40,
  });

  const totalHeight = files.length * rowHeight;

  return (
    <div ref={scrollRef} className="git-virtual-file-list" aria-rowcount={files.length}>
      <div className="git-virtual-file-list__spacer" style={{ height: totalHeight }}>
        {files.slice(range.start, range.end).map((file, index) => (
          <div
            key={file.path}
            className="git-virtual-file-list__row"
            style={{
              top: (range.start + index) * rowHeight,
              height: rowHeight,
            }}
          >
            {renderRow(file)}
          </div>
        ))}
      </div>
    </div>
  );
}
