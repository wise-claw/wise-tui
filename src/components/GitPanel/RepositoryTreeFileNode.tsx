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
  editorDirtyRevision: number;
}

function RepositoryTreeFileNodeInner({
  node,
  depth,
  selectedPath,
  hoverPath,
  gitStatusRevision: _gitStatusRevision,
  editorDirtyRevision: _editorDirtyRevision,
}: RepositoryTreeFileNodeProps) {
  const { onSelectNode, onOpenFile } = useRepositoryExplorerTreeActions();
  const { getFileStatus, isEditorDirty } = useRepositoryExplorerGitStatus();
  const isEditorDirtyPath = isEditorDirty(node.path);
  const isSelected = selectedPath === node.path;
  const isPointerHover = hoverPath === node.path;
  const gitStatus = getFileStatus(node.path);
  const depthIndentPx = repositoryTreeFileDepthIndentPx(depth);

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
        <span className={`repo-tree-file-name${gitStatus ? ` repo-tree-file-name--status-${gitStatus.toLowerCase()}` : ""}${isEditorDirtyPath && !gitStatus ? " repo-tree-file-name--editor-dirty" : ""}`}>{node.name}</span>
        <RepoTreeGitFileDecoration status={gitStatus} editorDirty={isEditorDirtyPath} />
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
    prevEditorDirtyRevision: prev.editorDirtyRevision,
    nextEditorDirtyRevision: next.editorDirtyRevision,
  });
}

export const RepositoryTreeFileNode = memo(RepositoryTreeFileNodeInner, fileNodeMemoCompare);
