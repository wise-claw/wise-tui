import { memo } from "react";
import { RepositoryTreeDirNode } from "./RepositoryTreeDirNode";
import { RepositoryTreeFileNode } from "./RepositoryTreeFileNode";
import type { ExplorerInlineCreateState, RepositoryFileTreeNode } from "./types";

export interface RepositoryTreeListProps {
  nodes: RepositoryFileTreeNode[];
  expandedDirs: Set<string>;
  expandEpoch: number;
  lastExpandPath: string;
  selectedPath: string | null;
  inlineCreate: ExplorerInlineCreateState | null;
  loadingDirPath: string | null;
}

function repositoryTreeListShouldUpdate(
  prev: Readonly<RepositoryTreeListProps>,
  next: Readonly<RepositoryTreeListProps>,
): boolean {
  if (prev.nodes !== next.nodes) return false;
  if (prev.selectedPath !== next.selectedPath) return false;
  if (prev.expandedDirs !== next.expandedDirs) return false;
  if (prev.loadingDirPath !== next.loadingDirPath) return false;
  if (prev.inlineCreate?.parentDir !== next.inlineCreate?.parentDir) return false;
  if (prev.inlineCreate?.type !== next.inlineCreate?.type) return false;
  if (prev.inlineCreate?.value !== next.inlineCreate?.value) return false;
  return true;
}

function RepositoryTreeListInner({
  nodes,
  expandedDirs,
  expandEpoch,
  lastExpandPath,
  selectedPath,
  inlineCreate,
  loadingDirPath,
}: RepositoryTreeListProps) {
  return (
    <>
      {nodes.map((node) =>
        node.isDir ? (
          <RepositoryTreeDirNode
            key={node.path}
            node={node}
            depth={0}
            isExpanded={expandedDirs.has(node.path)}
            expandEpoch={expandEpoch}
            lastExpandPath={lastExpandPath}
            selectedPath={selectedPath}
            expandedDirs={expandedDirs}
            inlineCreate={inlineCreate}
            loadingDirPath={loadingDirPath}
          />
        ) : (
          <RepositoryTreeFileNode
            key={node.path}
            node={node}
            depth={0}
            selectedPath={selectedPath}
          />
        ),
      )}
    </>
  );
}

export const RepositoryTreeList = memo(RepositoryTreeListInner, repositoryTreeListShouldUpdate);
