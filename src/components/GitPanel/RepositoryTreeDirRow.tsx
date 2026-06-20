import { memo, useCallback } from "react";
import { useRepositoryExplorerTreeActions } from "./RepositoryExplorerTreeActionsContext";
import { useRepositoryExplorerGitStatus } from "./RepositoryExplorerGitStatusContext";
import { ExplorerTreeChevron, ExplorerTreeFolderIcon } from "./explorerTreeChrome";
import { repositoryDirNodeContentKey } from "./lazyExplorerTree";
import { RepoTreeGitDirDot } from "./repoTreeGitDecoration";
import { repositoryTreeDepthIndentPx } from "./repositoryTreeLayout";
import { setWiseRepositoryFileDragData } from "../../utils/repositoryFileDrag";
import type { RepositoryFileTreeNode } from "./types";

export interface RepositoryTreeDirRowProps {
  node: RepositoryFileTreeNode;
  depth: number;
  isExpanded: boolean;
  selectedPath: string | null;
  hoverPath: string | null;
  gitStatusRevision: number;
}

function RepositoryTreeDirRowInner({
  node,
  depth,
  isExpanded,
  selectedPath,
  hoverPath,
  gitStatusRevision: _gitStatusRevision,
}: RepositoryTreeDirRowProps) {
  const { onToggleDir, onSelectNode } = useRepositoryExplorerTreeActions();
  const { dirHasChanges } = useRepositoryExplorerGitStatus();
  const depthIndentPx = repositoryTreeDepthIndentPx(depth);
  const isSelected = selectedPath === node.path;
  const isPointerHover = hoverPath === node.path && !isSelected;
  const showGitDot = dirHasChanges(node.path);

  const activateDir = useCallback(() => {
    onSelectNode(node.path, true);
    onToggleDir(node.path);
  }, [node.path, onSelectNode, onToggleDir]);

  return (
    <div
      className={`repo-tree-node repo-tree-node--dir${isSelected ? " repo-tree-node--selected" : ""}${isPointerHover ? " repo-tree-node--pointer-hover" : ""}${isExpanded ? " repo-tree-node--expanded" : ""}`}
      data-repo-path={node.path}
      data-repo-is-dir="1"
      draggable
      role="treeitem"
      tabIndex={0}
      aria-expanded={isExpanded}
      onDragStart={(e) => {
        e.stopPropagation();
        setWiseRepositoryFileDragData(e.dataTransfer, node.path);
      }}
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
      <RepoTreeGitDirDot visible={showGitDot} />
    </div>
  );
}

function dirRowMemoCompare(prev: Readonly<RepositoryTreeDirRowProps>, next: Readonly<RepositoryTreeDirRowProps>): boolean {
  if (repositoryDirNodeContentKey(prev.node) !== repositoryDirNodeContentKey(next.node)) {
    return false;
  }
  if (prev.depth !== next.depth) return false;
  if (prev.isExpanded !== next.isExpanded) return false;
  if (prev.gitStatusRevision !== next.gitStatusRevision) return false;
  if ((prev.selectedPath === prev.node.path) !== (next.selectedPath === next.node.path)) {
    return false;
  }
  const path = prev.node.path;
  return (prev.hoverPath === path) === (next.hoverPath === path);
}

export const RepositoryTreeDirRow = memo(RepositoryTreeDirRowInner, dirRowMemoCompare);
