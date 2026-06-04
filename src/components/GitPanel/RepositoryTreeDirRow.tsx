import { memo, useCallback } from "react";
import { useRepositoryExplorerTreeActions } from "./RepositoryExplorerTreeActionsContext";
import { ExplorerTreeChevron, ExplorerTreeFolderIcon } from "./explorerTreeChrome";
import { repositoryDirNodeContentKey } from "./lazyExplorerTree";
import { repositoryTreeDepthIndentPx } from "./repositoryTreeLayout";
import type { RepositoryFileTreeNode } from "./types";

export interface RepositoryTreeDirRowProps {
  node: RepositoryFileTreeNode;
  depth: number;
  isExpanded: boolean;
  selectedPath: string | null;
}

function RepositoryTreeDirRowInner({ node, depth, isExpanded, selectedPath }: RepositoryTreeDirRowProps) {
  const { onToggleDir, onSelectNode } = useRepositoryExplorerTreeActions();
  const depthIndentPx = repositoryTreeDepthIndentPx(depth);
  const isSelected = selectedPath === node.path;

  const activateDir = useCallback(() => {
    onSelectNode(node.path, true);
    onToggleDir(node.path);
  }, [node.path, onSelectNode, onToggleDir]);

  return (
    <div
      className={`repo-tree-node repo-tree-node--dir${isSelected ? " repo-tree-node--selected" : ""}${isExpanded ? " repo-tree-node--expanded" : ""}`}
      data-repo-path={node.path}
      data-repo-is-dir="1"
      role="treeitem"
      tabIndex={0}
      aria-expanded={isExpanded}
      onClick={activateDir}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activateDir();
        }
      }}
    >
      <span className="repo-tree-node-indent" style={{ width: depthIndentPx }} aria-hidden />
      <span
        className={`repo-tree-node-arrow ${isExpanded ? "repo-tree-node-arrow--expanded" : ""}`}
        aria-hidden
      >
        <ExplorerTreeChevron />
      </span>
      <ExplorerTreeFolderIcon
        name={node.name}
        expanded={isExpanded}
        className="repo-tree-node-icon repo-tree-node-icon--dir"
      />
      <span className="repo-tree-node-name">{node.name}</span>
      {isExpanded ? <span className="repo-tree-node-branch-indicator" aria-hidden /> : null}
    </div>
  );
}

function dirRowMemoCompare(prev: Readonly<RepositoryTreeDirRowProps>, next: Readonly<RepositoryTreeDirRowProps>): boolean {
  if (repositoryDirNodeContentKey(prev.node) !== repositoryDirNodeContentKey(next.node)) {
    return false;
  }
  if (prev.depth !== next.depth) return false;
  if (prev.isExpanded !== next.isExpanded) return false;
  return (prev.selectedPath === prev.node.path) === (next.selectedPath === next.node.path);
}

export const RepositoryTreeDirRow = memo(RepositoryTreeDirRowInner, dirRowMemoCompare);
