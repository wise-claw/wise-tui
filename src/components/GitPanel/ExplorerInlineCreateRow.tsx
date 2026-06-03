import { useLayoutEffect, useRef } from "react";
import { Input } from "antd";
import type { InputRef } from "antd/es/input";
import { ExplorerTreeFileIcon, ExplorerTreeFolderIcon } from "./explorerTreeChrome";
import { repositoryTreeDepthIndentPx } from "./repositoryTreeLayout";

interface ExplorerInlineCreateRowProps {
  depth: number;
  kind: "file" | "folder";
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export function ExplorerInlineCreateRow({
  depth,
  kind,
  value,
  onChange,
  onCommit,
  onCancel,
}: ExplorerInlineCreateRowProps) {
  const inputRef = useRef<InputRef>(null);
  const skipBlurCommit = useRef(false);

  useLayoutEffect(() => {
    const el = inputRef.current?.input;
    if (el) {
      el.focus();
      el.select();
    }
  }, [kind, depth]);

  return (
    <div
      className="repo-tree-node repo-tree-node--inline-create"
      style={{ paddingLeft: repositoryTreeDepthIndentPx(depth) }}
      data-repo-inline-create="1"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {kind === "folder" ? (
        <ExplorerTreeFolderIcon name="" expanded={false} className="repo-tree-node-icon repo-tree-node-icon--dir" />
      ) : (
        <ExplorerTreeFileIcon fileName={value || "untitled"} className="repo-tree-node-icon repo-tree-node-icon--file" />
      )}
      <Input
        ref={inputRef}
        size="small"
        className="repo-tree-inline-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPressEnter={() => void onCommit()}
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
            void onCommit();
          }, 0);
        }}
        aria-label={kind === "folder" ? "新建文件夹名称" : "新建文件名称"}
      />
    </div>
  );
}
