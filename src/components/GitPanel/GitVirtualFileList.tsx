import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  const [range, setRange] = useState({ start: 0, end: 40 });

  const updateRange = useCallback(() => {
    const el = scrollRef.current;
    if (!el || files.length === 0) {
      return;
    }
    const height = Math.max(el.clientHeight, rowHeight);
    const scrollTop = el.scrollTop;
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS);
    const visibleRows = Math.ceil(height / rowHeight) + OVERSCAN_ROWS * 2;
    const end = Math.min(files.length, start + visibleRows);
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [files.length, rowHeight]);

  useLayoutEffect(() => {
    updateRange();
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(() => updateRange());
    ro.observe(el);
    el.addEventListener("scroll", updateRange, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", updateRange);
    };
  }, [updateRange]);

  const totalHeight = files.length * rowHeight;

  return (
    <div
      ref={scrollRef}
      className="git-virtual-file-list"
      aria-rowcount={files.length}
    >
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
