import { memo } from "react";
import { useRepositoryExplorerTreeActions } from "./RepositoryExplorerTreeActionsContext";
import { ExplorerTreeFileIcon } from "./explorerTreeChrome";
import { repositoryTreeFileShouldUpdate } from "./repositoryTreeNodeMemo";
import { repositoryTreeDepthIndentPx } from "./repositoryTreeLayout";
import { setWiseRepositoryFileDragData } from "../../utils/repositoryFileDrag";
import type { RepositoryFileTreeNode } from "./types";

interface RepositoryTreeFileNodeProps {
  node: RepositoryFileTreeNode;
  depth: number;
  selectedPath: string | null;
}

function RepositoryTreeFileNodeInner({ node, depth, selectedPath }: RepositoryTreeFileNodeProps) {
  const { onSelectNode, onOpenFile } = useRepositoryExplorerTreeActions();
  const isSelected = selectedPath === node.path;
  const depthIndentPx = repositoryTreeDepthIndentPx(depth);

  return (
    <div
      className={`repo-tree-node repo-tree-node--file${onOpenFile ? " repo-tree-node--file--clickable" : ""}${isSelected ? " repo-tree-node--selected" : ""}`}
      data-repo-path={node.path}
      data-repo-is-dir="0"
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        setWiseRepositoryFileDragData(e.dataTransfer, node.path);
      }}
      tabIndex={-1}
    >
      <span className="repo-tree-node-indent" style={{ width: depthIndentPx }} aria-hidden />
      <div
        className={`repo-tree-node-body repo-tree-node-body--file${onOpenFile ? " repo-tree-node-body--clickable" : ""}`}
        onClick={() => {
          onSelectNode(node.path, false);
          onOpenFile?.(node.path);
        }}
        role={onOpenFile ? "button" : undefined}
        tabIndex={onOpenFile ? 0 : undefined}
        onKeyDown={(event) => {
          if (!onOpenFile) {
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpenFile(node.path);
          }
        }}
      >
        <ExplorerTreeFileIcon fileName={node.name} className="repo-tree-node-icon repo-tree-node-icon--file" />
        <span className="repo-tree-file-name">{node.name}</span>
      </div>
    </div>
  );
}

function fileNodeMemoCompare(
  prev: Readonly<RepositoryTreeFileNodeProps>,
  next: Readonly<RepositoryTreeFileNodeProps>,
): boolean {
  return repositoryTreeFileShouldUpdate({
    prevNode: prev.node,
    nextNode: next.node,
    prevDepth: prev.depth,
    nextDepth: next.depth,
    prevSelectedPath: prev.selectedPath,
    nextSelectedPath: next.selectedPath,
  });
}

export const RepositoryTreeFileNode = memo(RepositoryTreeFileNodeInner, fileNodeMemoCompare);
