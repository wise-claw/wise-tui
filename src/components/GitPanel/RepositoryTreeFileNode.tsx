import { memo } from "react";
import { useRepositoryExplorerTreeActions } from "./RepositoryExplorerTreeActionsContext";
import { useRepositoryExplorerGitStatus } from "./RepositoryExplorerGitStatusContext";
import { ExplorerTreeFileIcon } from "./explorerTreeChrome";
import { RepoTreeGitFileDecoration } from "./repoTreeGitDecoration";
import { repositoryTreeFileShouldUpdate } from "./repositoryTreeNodeMemo";
import { repositoryTreeFileDepthIndentPx } from "./repositoryTreeLayout";
import { setWiseRepositoryFileDragData } from "../../utils/repositoryFileDrag";
import type { RepositoryFileTreeNode } from "./types";

interface RepositoryTreeFileNodeProps {
  node: RepositoryFileTreeNode;
  depth: number;
  selectedPath: string | null;
  hoverPath: string | null;
  gitStatusRevision: number;
}

function RepositoryTreeFileNodeInner({
  node,
  depth,
  selectedPath,
  hoverPath,
  gitStatusRevision: _gitStatusRevision,
}: RepositoryTreeFileNodeProps) {
  const { onSelectNode, onOpenFile } = useRepositoryExplorerTreeActions();
  const { getFileStatus } = useRepositoryExplorerGitStatus();
  const isSelected = selectedPath === node.path;
  const isPointerHover = hoverPath === node.path && !isSelected;
  const depthIndentPx = repositoryTreeFileDepthIndentPx(depth);
  const gitStatus = getFileStatus(node.path);

  return (
    <div
      className={`repo-tree-node repo-tree-node--file${onOpenFile ? " repo-tree-node--file--clickable" : ""}${isSelected ? " repo-tree-node--selected" : ""}${isPointerHover ? " repo-tree-node--pointer-hover" : ""}`}
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
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          onSelectNode(node.path, false);
        }}
        onClick={() => {
          onOpenFile?.(node.path, { fromFileTree: true });
        }}
        role={onOpenFile ? "button" : undefined}
        tabIndex={onOpenFile ? 0 : undefined}
        onKeyDown={(event) => {
          if (!onOpenFile) {
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpenFile(node.path, { fromFileTree: true });
          }
        }}
      >
        <ExplorerTreeFileIcon fileName={node.name} className="repo-tree-node-icon repo-tree-node-icon--file" />
        <span className="repo-tree-file-name">{node.name}</span>
        <RepoTreeGitFileDecoration status={gitStatus} />
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
    prevHoverPath: prev.hoverPath,
    nextHoverPath: next.hoverPath,
    prevGitStatusRevision: prev.gitStatusRevision,
    nextGitStatusRevision: next.gitStatusRevision,
  });
}

export const RepositoryTreeFileNode = memo(RepositoryTreeFileNodeInner, fileNodeMemoCompare);
