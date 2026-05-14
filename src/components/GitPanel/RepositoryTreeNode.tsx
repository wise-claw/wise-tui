import { memo } from "react";
import { setWiseRepositoryFileDragData } from "../../utils/repositoryFileDrag";
import { ExplorerTreeChevron, ExplorerTreeFileIcon, ExplorerTreeFolderIcon } from "./explorerTreeChrome";
import { ExplorerInlineCreateRow } from "./ExplorerInlineCreateRow";
import { hasExpandedDescendant } from "./gitPanelUtils";
import type {
  ExplorerInlineCreateState,
  GitPanelOpenFileOptions,
  RepositoryFileTreeNode,
} from "./types";

interface RepositoryTreeNodeProps {
  node: RepositoryFileTreeNode;
  expandedDirs: Set<string>;
  selectedPath: string | null;
  onToggleDir: (dirPath: string) => void;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  depth: number;
  onSelectNode: (path: string, isDir: boolean) => void;
  inlineCreate: ExplorerInlineCreateState | null;
  onInlineValueChange: (value: string) => void;
  onInlineCommit: () => void;
  onInlineCancel: () => void;
}

function repositoryTreeNodeShouldUpdate(
  prev: Readonly<RepositoryTreeNodeProps>,
  next: Readonly<RepositoryTreeNodeProps>,
): boolean {
  if (prev.node !== next.node) return false;
  if (prev.depth !== next.depth) return false;
  if (prev.onToggleDir !== next.onToggleDir) return false;
  if (prev.onOpenFile !== next.onOpenFile) return false;
  if (prev.onSelectNode !== next.onSelectNode) return false;
  if (prev.onInlineValueChange !== next.onInlineValueChange) return false;
  if (prev.onInlineCommit !== next.onInlineCommit) return false;
  if (prev.onInlineCancel !== next.onInlineCancel) return false;

  const nodePath = prev.node.path;
  const prevExpanded = prev.expandedDirs.has(nodePath);
  const nextExpanded = next.expandedDirs.has(nodePath);
  if (prevExpanded !== nextExpanded) return false;

  const prevSelected = prev.selectedPath === nodePath;
  const nextSelected = next.selectedPath === nodePath;
  if (prevSelected !== nextSelected) return false;

  const prevInlineRelevant =
    prev.inlineCreate?.parentDir === nodePath ||
    prev.inlineCreate?.parentDir.startsWith(`${nodePath}/`) ||
    prev.inlineCreate?.parentDir === "";
  const nextInlineRelevant =
    next.inlineCreate?.parentDir === nodePath ||
    next.inlineCreate?.parentDir.startsWith(`${nodePath}/`) ||
    next.inlineCreate?.parentDir === "";
  if (prevInlineRelevant || nextInlineRelevant) {
    if (prev.inlineCreate?.parentDir !== next.inlineCreate?.parentDir) return false;
    if (prev.inlineCreate?.type !== next.inlineCreate?.type) return false;
    if (prev.inlineCreate?.value !== next.inlineCreate?.value) return false;
  }

  if (prev.node.isDir && next.node.isDir && (prevExpanded || nextExpanded)) {
    const prevSelectedInBranch =
      prev.selectedPath != null &&
      (prev.selectedPath === nodePath || prev.selectedPath.startsWith(`${nodePath}/`));
    const nextSelectedInBranch =
      next.selectedPath != null &&
      (next.selectedPath === nodePath || next.selectedPath.startsWith(`${nodePath}/`));
    if (prevSelectedInBranch !== nextSelectedInBranch) return false;

    const prevExpandedInBranch = hasExpandedDescendant(prev.expandedDirs, nodePath);
    const nextExpandedInBranch = hasExpandedDescendant(next.expandedDirs, nodePath);
    if (prevExpandedInBranch !== nextExpandedInBranch) return false;
  }

  return true;
}

function RepositoryTreeNodeInner({
  node,
  expandedDirs,
  selectedPath,
  onToggleDir,
  onOpenFile,
  depth,
  onSelectNode,
  inlineCreate,
  onInlineValueChange,
  onInlineCommit,
  onInlineCancel,
}: RepositoryTreeNodeProps) {
  if (node.isDir) {
    const expanded = expandedDirs.has(node.path);
    const isSelected = selectedPath === node.path;
    const showInlineHere = inlineCreate != null && inlineCreate.parentDir === node.path;
    const showChildren = expanded || showInlineHere;
    return (
      <>
        <div
          className={`repo-tree-node repo-tree-node--dir${isSelected ? " repo-tree-node--selected" : ""}${expanded ? " repo-tree-node--expanded" : ""}`}
          style={{ paddingLeft: depth * 4 }}
          data-repo-path={node.path}
          data-repo-is-dir="1"
          onClick={() => {
            onSelectNode(node.path, true);
            onToggleDir(node.path);
          }}
          role="treeitem"
          tabIndex={-1}
          aria-expanded={expanded}
        >
          <button
            type="button"
            className={`repo-tree-node-arrow ${expanded ? "repo-tree-node-arrow--expanded" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              onSelectNode(node.path, true);
              onToggleDir(node.path);
            }}
            aria-label={expanded ? "收起目录" : "展开目录"}
          >
            <ExplorerTreeChevron />
          </button>
          <ExplorerTreeFolderIcon
            name={node.name}
            expanded={expanded}
            className="repo-tree-node-icon repo-tree-node-icon--dir"
          />
          <span className="repo-tree-node-name">{node.name}</span>
          {expanded ? <span className="repo-tree-node-branch-indicator" aria-hidden /> : null}
        </div>
        {showChildren && (
          <div className="repo-tree-children">
            {(node.children ?? []).map((childNode) => (
              <RepositoryTreeNode
                key={childNode.path}
                node={childNode}
                expandedDirs={expandedDirs}
                selectedPath={selectedPath}
                onToggleDir={onToggleDir}
                onOpenFile={onOpenFile}
                depth={depth + 1}
                onSelectNode={onSelectNode}
                inlineCreate={inlineCreate}
                onInlineValueChange={onInlineValueChange}
                onInlineCommit={onInlineCommit}
                onInlineCancel={onInlineCancel}
              />
            ))}
            {showInlineHere && inlineCreate ? (
              <ExplorerInlineCreateRow
                depth={depth + 1}
                kind={inlineCreate.type}
                value={inlineCreate.value}
                onChange={onInlineValueChange}
                onCommit={onInlineCommit}
                onCancel={onInlineCancel}
              />
            ) : null}
          </div>
        )}
      </>
    );
  }

  const isSelected = selectedPath === node.path;

  return (
    <div
      className={`repo-tree-node repo-tree-node--file${onOpenFile ? " repo-tree-node--file--clickable" : ""}${isSelected ? " repo-tree-node--selected" : ""}`}
      style={{ paddingLeft: depth * 4 }}
      data-repo-path={node.path}
      data-repo-is-dir="0"
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        setWiseRepositoryFileDragData(e.dataTransfer, node.path);
      }}
      onClick={() => {
        onSelectNode(node.path, false);
        onOpenFile?.(node.path);
      }}
      role={onOpenFile ? "button" : undefined}
      tabIndex={onOpenFile ? 0 : -1}
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
  );
}

export const RepositoryTreeNode = memo(RepositoryTreeNodeInner, repositoryTreeNodeShouldUpdate);
