import { memo, useCallback } from "react";
import { useRepositoryExplorerTreeActions } from "./RepositoryExplorerTreeActionsContext";
import { ExplorerInlineCreateRow } from "./ExplorerInlineCreateRow";
import { ExplorerTreeChevron, ExplorerTreeFolderIcon } from "./explorerTreeChrome";
import { repositoryTreeDirShouldUpdate } from "./repositoryTreeNodeMemo";
import { explorerDirKey } from "./repositoryExplorerDirKey";
import { repositoryTreeDepthIndentPx } from "./repositoryTreeLayout";
import { RepositoryTreeFileNode } from "./RepositoryTreeFileNode";
import type { ExplorerInlineCreateState, RepositoryFileTreeNode } from "./types";

export interface RepositoryTreeDirNodeProps {
  node: RepositoryFileTreeNode;
  depth: number;
  isExpanded: boolean;
  expandEpoch: number;
  lastExpandPath: string;
  selectedPath: string | null;
  expandedDirs: Set<string>;
  inlineCreate: ExplorerInlineCreateState | null;
  loadingDirKeys: ReadonlySet<string>;
}

function RepositoryTreeDirNodeInner({
  node,
  depth,
  isExpanded,
  expandEpoch,
  lastExpandPath,
  selectedPath,
  expandedDirs,
  inlineCreate,
  loadingDirKeys,
}: RepositoryTreeDirNodeProps) {
  const { onToggleDir, onSelectNode, onInlineValueChange, onInlineCommit, onInlineCancel } =
    useRepositoryExplorerTreeActions();
  const depthIndentPx = repositoryTreeDepthIndentPx(depth);
  const isSelected = selectedPath === node.path;
  const showInlineHere = inlineCreate != null && inlineCreate.parentDir === node.path;
  const nodeDirKey = explorerDirKey(node.path);
  const showChildren = isExpanded || showInlineHere;
  const childNodes = node.children;
  const isLoadingChildren = loadingDirKeys.has(nodeDirKey) && childNodes === undefined;
  const showEmptyDirHint =
    isExpanded && !isLoadingChildren && Array.isArray(childNodes) && childNodes.length === 0;

  const activateDir = useCallback(() => {
    onSelectNode(node.path, true);
    onToggleDir(node.path);
  }, [node.path, onSelectNode, onToggleDir]);

  return (
    <>
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
      {showChildren ? (
        <div className="repo-tree-children">
          {isLoadingChildren ? (
            <div className="repo-tree-children-loading" aria-live="polite">
              加载中…
            </div>
          ) : null}
          {showEmptyDirHint ? (
            <div className="repo-tree-children-loading" aria-live="polite">
              空文件夹
            </div>
          ) : null}
          {(childNodes ?? []).map((childNode) =>
            childNode.isDir ? (
              <RepositoryTreeDirNode
                key={childNode.path}
                node={childNode}
                depth={depth + 1}
                isExpanded={expandedDirs.has(explorerDirKey(childNode.path))}
                expandEpoch={expandEpoch}
                lastExpandPath={lastExpandPath}
                selectedPath={selectedPath}
                expandedDirs={expandedDirs}
                inlineCreate={inlineCreate}
                loadingDirKeys={loadingDirKeys}
              />
            ) : (
              <RepositoryTreeFileNode
                key={childNode.path}
                node={childNode}
                depth={depth + 1}
                selectedPath={selectedPath}
              />
            ),
          )}
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
      ) : null}
    </>
  );
}

function dirNodeMemoCompare(prev: Readonly<RepositoryTreeDirNodeProps>, next: Readonly<RepositoryTreeDirNodeProps>): boolean {
  return repositoryTreeDirShouldUpdate({
    prevNode: prev.node,
    nextNode: next.node,
    prevDepth: prev.depth,
    nextDepth: next.depth,
    prevExpanded: prev.isExpanded,
    nextExpanded: next.isExpanded,
    prevSelectedPath: prev.selectedPath,
    nextSelectedPath: next.selectedPath,
    prevExpandEpoch: prev.expandEpoch,
    nextExpandEpoch: next.expandEpoch,
    prevLastExpandPath: prev.lastExpandPath,
    nextLastExpandPath: next.lastExpandPath,
    prevInlineCreate: prev.inlineCreate,
    nextInlineCreate: next.inlineCreate,
    prevLoadingDirKeys: prev.loadingDirKeys,
    nextLoadingDirKeys: next.loadingDirKeys,
  });
}

export const RepositoryTreeDirNode = memo(RepositoryTreeDirNodeInner, dirNodeMemoCompare);
