import { useMemo } from "react";
import { Button, Space, Tooltip } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { GitFileStatus } from "../../types";
import { buildFileTree } from "./fileTree";
import { ExplorerTreeChevron, ExplorerTreeFolderIcon } from "./explorerTreeChrome";
import { DiscardFilePopconfirm } from "./DiscardFilePopconfirm";
import { FileRow } from "./FileRow";
import { RevertIcon } from "./RevertIcon";
import type { FileTreeNode, GitPanelOpenFileOptions } from "./types";

interface FileTreeNodeProps {
  node: FileTreeNode;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onDiscard: (path: string) => void | Promise<void>;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  depth: number;
}

function FileTreeNodeComponent({
  node,
  expandedDirs,
  onToggleDir,
  onStage,
  onUnstage,
  onDiscard,
  onOpenFile,
  depth,
}: FileTreeNodeProps) {
  const isExpanded = expandedDirs.has(node.path);

  if (node.isDir) {
    return (
      <>
        <div
          className="git-tree-node git-tree-node--dir"
          style={{ paddingLeft: depth * 4 }}
        >
          <span
            className={`git-tree-node-arrow ${isExpanded ? "git-tree-node-arrow--expanded" : ""}`}
            onClick={() => onToggleDir(node.path)}
          >
            <ExplorerTreeChevron />
          </span>
          <ExplorerTreeFolderIcon
            name={node.name}
            expanded={isExpanded}
            className="git-tree-node-icon git-tree-node-icon--dir"
          />
          <span
            className="git-tree-node-name"
            onClick={() => onToggleDir(node.path)}
          >{node.name}</span>
          <Space size={0} className="git-tree-node-actions">
            <Tooltip title="暂存" placement="top">
              <Button
                type="text"
                size="small"
                icon={<PlusOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  onStage(node.path);
                }}
              />
            </Tooltip>
            <DiscardFilePopconfirm
              filePath={node.path}
              onConfirm={() => onDiscard(node.path)}
            >
              <Tooltip title="放弃更改" placement="top">
                <Button
                  type="text"
                  size="small"
                  icon={<RevertIcon />}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                />
              </Tooltip>
            </DiscardFilePopconfirm>
          </Space>
          <span className="git-tree-node-stats">
            <span className="git-file-add">+{node.additions}</span>
            <span className="git-file-sep">/</span>
            <span className="git-file-del">-{node.deletions}</span>
          </span>
        </div>
        {isExpanded && node.children && (
          <div className="git-tree-children">
            {node.children.map((child) => (
              <FileTreeNodeComponent
                key={child.path}
                node={child}
                expandedDirs={expandedDirs}
                onToggleDir={onToggleDir}
                onStage={onStage}
                onUnstage={onUnstage}
                onDiscard={onDiscard}
                onOpenFile={onOpenFile}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <div
      className={`git-tree-node git-tree-node--file${onOpenFile ? " git-tree-node--file--clickable" : ""}`}
    >
      {node.file && (
        <FileRow
          file={node.file}
          section="unstaged"
          onStage={onStage}
          onDiscard={onDiscard}
          onOpenFile={onOpenFile}
        />
      )}
    </div>
  );
}

interface FileTreeViewProps {
  files: GitFileStatus[];
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onDiscard: (path: string) => void | Promise<void>;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
}

export function FileTreeView({
  files,
  expandedDirs,
  onToggleDir,
  onStage,
  onUnstage,
  onDiscard,
  onOpenFile,
}: FileTreeViewProps) {
  const tree = useMemo(() => buildFileTree(files), [files]);

  return (
    <div className="git-file-list">
      {tree.map((node) => (
        <FileTreeNodeComponent
          key={node.path}
          node={node}
          expandedDirs={expandedDirs}
          onToggleDir={onToggleDir}
          onStage={onStage}
          onUnstage={onUnstage}
          onDiscard={onDiscard}
          onOpenFile={onOpenFile}
          depth={0}
        />
      ))}
    </div>
  );
}
