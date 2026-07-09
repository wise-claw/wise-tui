import { useLayoutEffect, useRef, useState } from "react";
import { Input } from "antd";
import type { InputRef } from "antd/es/input";
import { ExplorerTreeFileIcon, ExplorerTreeFolderIcon } from "./explorerTreeChrome";
import {
  repositoryTreeDepthIndentPx,
  repositoryTreeFileDepthIndentPx,
  REPOSITORY_TREE_CHEVRON_COLUMN_PX,
} from "./repositoryTreeLayout";

interface ExplorerInlineRenameRowProps {
  depth: number;
  kind: "file" | "folder";
  /** 默认值（原名），组件挂载时会选中文件名（不含扩展名外的中段）以便快速重写。 */
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

export function ExplorerInlineRenameRow({
  depth,
  kind,
  initialValue,
  onCommit,
  onCancel,
}: ExplorerInlineRenameRowProps) {
  const inputRef = useRef<InputRef>(null);
  const skipBlurCommit = useRef(false);
  // local 缓冲避免父组件 controlled 重渲染覆盖正在打字的内容；同时允许外部初值变更时（重命名不同 row）重置。
  const [value, setValue] = useState(initialValue);

  useLayoutEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useLayoutEffect(() => {
    const el = inputRef.current?.input;
    if (!el) return;
    el.focus();
    // 文件：选中文件名主体（不含扩展名），方便直接覆盖重命名。
    if (kind === "file") {
      const dot = value.lastIndexOf(".");
      const selEnd = dot > 0 ? dot : value.length;
      try {
        el.setSelectionRange(0, selEnd);
      } catch {
        el.select();
      }
    } else {
      el.select();
    }
  }, [kind, depth, initialValue]);

  const paddingLeft =
    kind === "file"
      ? repositoryTreeFileDepthIndentPx(depth)
      : repositoryTreeDepthIndentPx(depth) + REPOSITORY_TREE_CHEVRON_COLUMN_PX;

  return (
    <div
      className="repo-tree-node repo-tree-node--inline-rename"
      style={{ paddingLeft }}
      data-repo-inline-rename="1"
      data-repo-path=""
      data-repo-is-dir={kind === "folder" ? "1" : "0"}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {kind === "folder" ? (
        <ExplorerTreeFolderIcon name="" expanded={false} className="repo-tree-node-icon repo-tree-node-icon--dir" />
      ) : (
        <ExplorerTreeFileIcon fileName={value || initialValue || "untitled"} className="repo-tree-node-icon repo-tree-node-icon--file" />
      )}
      <Input
        ref={inputRef}
        size="small"
        className="repo-tree-inline-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onPressEnter={() => {
          skipBlurCommit.current = true;
          onCommit(value.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            skipBlurCommit.current = true;
            onCancel();
          }
        }}
        onBlur={() => {
          window.setTimeout(() => {
            if (skipBlurCommit.current) {
              skipBlurCommit.current = false;
              return;
            }
            onCommit(value.trim());
          }, 0);
        }}
        aria-label={kind === "folder" ? "文件夹新名称" : "文件新名称"}
      />
    </div>
  );
}