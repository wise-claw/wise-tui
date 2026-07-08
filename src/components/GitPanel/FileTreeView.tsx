import { memo, useMemo } from "react";
import { Button, Space } from "antd";
import { MinusOutlined, PlusOutlined, VerticalAlignBottomOutlined, VerticalAlignTopOutlined } from "@ant-design/icons";
import type { GitFileStatus } from "../../types";
import { buildFileTree } from "./fileTree";
import { ExplorerTreeChevron, ExplorerTreeFolderIcon } from "./explorerTreeChrome";
import { DiscardFilePopconfirm } from "./DiscardFilePopconfirm";
import { FileRow } from "./FileRow";
import { RevertIcon } from "./RevertIcon";
import { gitTreeDirPaddingLeftPx, gitTreeFilePaddingLeftPx } from "./gitTreeLayout";
import type { FileTreeNode, GitPanelOpenFileOptions } from "./types";

interface FileTreeNodeProps {
  node: FileTreeNode;
  section: "staged" | "unstaged";
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onToggleDirRecursive?: (path: string, subDirPaths: readonly string[]) => void;
  onStage?: (path: string) => void;
  onUnstage?: (path: string) => void;
  onDiscard?: (path: string) => void | Promise<void>;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  depth: number;
}

function FileTreeNodeComponent({
  node,
  section,
  expandedDirs,
  onToggleDir,
  onToggleDirRecursive,
  onStage,
  onUnstage,
  onDiscard,
  onOpenFile,
  depth,
}: FileTreeNodeProps) {
  const isExpanded = expandedDirs.has(node.path);

  if (node.isDir) {
    // 递归收集该目录下所有子目录 path（含自身），用于「展开/收起子树」
    const subDirPaths: string[] = [node.path];
    const collect = (n: FileTreeNode) => {
      if (n.children) {
        for (const c of n.children) {
          if (c.isDir) {
            subDirPaths.push(c.path);
            collect(c);
          }
        }
      }
    };
    collect(node);

    return (
      <>
        <div
          className="git-tree-node git-tree-node--dir"
          style={{ paddingLeft: gitTreeDirPaddingLeftPx(depth) }}
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
          <span className="git-tree-node-meta">
            <Space size={0} className="git-tree-node-actions">
              <Button
                type="text"
                size="small"
                title={isExpanded ? "收起目录（含子目录）" : "展开目录（含子目录）"}
                aria-label={isExpanded ? `收起目录 ${node.name}（含子目录）` : `展开目录 ${node.name}（含子目录）`}
                aria-expanded={isExpanded}
                icon={isExpanded ? <VerticalAlignTopOutlined /> : <VerticalAlignBottomOutlined />}
                className="git-tree-node-toggle-dir"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onToggleDirRecursive) {
                    onToggleDirRecursive(node.path, subDirPaths);
                  } else {
                    onToggleDir(node.path);
                  }
                }}
              />
              {section === "unstaged" && onStage ? (
                <Button
                  type="text"
                  size="small"
                  title="暂存"
                  aria-label="暂存"
                  icon={<PlusOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onStage(node.path);
                  }}
                />
              ) : null}
              {section === "staged" && onUnstage ? (
                <Button
                  type="text"
                  size="small"
                  title="取消暂存"
                  aria-label="取消暂存"
                  icon={<MinusOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnstage(node.path);
                  }}
                />
              ) : null}
              {section === "unstaged" && onDiscard ? (
                <DiscardFilePopconfirm
                  filePath={node.path}
                  onConfirm={() => onDiscard(node.path)}
                >
                  <Button
                    type="text"
                    size="small"
                    title="放弃更改"
                    aria-label="放弃更改"
                    icon={<RevertIcon />}
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  />
                </DiscardFilePopconfirm>
              ) : null}
            </Space>
            <span className="git-tree-node-stats">
              <span className="git-file-add">+{node.additions}</span>
              <span className="git-file-sep">/</span>
              <span className="git-file-del">-{node.deletions}</span>
            </span>
          </span>
        </div>
        {isExpanded && node.children && (
          <div className="git-tree-children">
            {node.children.map((child) => (
              <MemoFileTreeNode
                key={child.path}
                node={child}
                section={section}
                expandedDirs={expandedDirs}
                onToggleDir={onToggleDir}
                onToggleDirRecursive={onToggleDirRecursive}
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
      style={{ paddingLeft: gitTreeFilePaddingLeftPx(depth) }}
    >
      {node.file ? (
        <FileRow
          file={node.file}
          section={section}
          onStage={onStage}
          onUnstage={onUnstage}
          onDiscard={onDiscard}
          onOpenFile={onOpenFile}
        />
      ) : null}
    </div>
  );
}

const MemoFileTreeNode = memo(FileTreeNodeComponent);

interface FileTreeViewProps {
  files: GitFileStatus[];
  section: "staged" | "unstaged";
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onToggleDirRecursive?: (path: string, subDirPaths: readonly string[]) => void;
  onStage?: (path: string) => void;
  onUnstage?: (path: string) => void;
  onDiscard?: (path: string) => void | Promise<void>;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
}

export function FileTreeView({
  files,
  section,
  expandedDirs,
  onToggleDir,
  onToggleDirRecursive,
  onStage,
  onUnstage,
  onDiscard,
  onOpenFile,
}: FileTreeViewProps) {
  const tree = useMemo(() => buildFileTree(files), [files]);

  return (
    <div className="git-file-list">
      {tree.map((node) => (
        <MemoFileTreeNode
          key={node.path}
          node={node}
          section={section}
          expandedDirs={expandedDirs}
          onToggleDir={onToggleDir}
          onToggleDirRecursive={onToggleDirRecursive}
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
