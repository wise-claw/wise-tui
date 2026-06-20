import { expandTouchAffectsDir } from "./repositoryTreeNodeExpandTouch";
import { explorerDirKey } from "./repositoryExplorerDirKey";
import { repositoryDirNodeContentKey } from "./lazyExplorerTree";
import type { ExplorerInlineCreateState, RepositoryFileTreeNode } from "./types";

export function repositoryTreeDirShouldUpdate(args: {
  prevNode: RepositoryFileTreeNode;
  nextNode: RepositoryFileTreeNode;
  prevDepth: number;
  nextDepth: number;
  prevExpanded: boolean;
  nextExpanded: boolean;
  prevSelectedPath: string | null;
  nextSelectedPath: string | null;
  prevExpandEpoch: number;
  nextExpandEpoch: number;
  prevLastExpandPath: string;
  nextLastExpandPath: string;
  prevInlineCreate: ExplorerInlineCreateState | null;
  nextInlineCreate: ExplorerInlineCreateState | null;
  prevLoadingDirKeys: ReadonlySet<string>;
  nextLoadingDirKeys: ReadonlySet<string>;
  prevGitStatusRevision?: number;
  nextGitStatusRevision?: number;
}): boolean {
  if (repositoryDirNodeContentKey(args.prevNode) !== repositoryDirNodeContentKey(args.nextNode)) {
    return false;
  }
  if (args.prevDepth !== args.nextDepth) return false;
  if (args.prevExpanded !== args.nextExpanded) return false;
  const nodeKey = explorerDirKey(args.prevNode.path);
  const prevLoading =
    args.prevLoadingDirKeys.has(nodeKey) && args.prevNode.children === undefined;
  const nextLoading =
    args.nextLoadingDirKeys.has(nodeKey) && args.nextNode.children === undefined;
  if (prevLoading !== nextLoading) {
    return false;
  }

  const nodePath = args.prevNode.path;
  if ((args.prevSelectedPath === nodePath) !== (args.nextSelectedPath === nodePath)) {
    return false;
  }

  const prevInlineHere = args.prevInlineCreate?.parentDir === nodePath;
  const nextInlineHere = args.nextInlineCreate?.parentDir === nodePath;
  if (prevInlineHere || nextInlineHere) {
    if (args.prevInlineCreate?.parentDir !== args.nextInlineCreate?.parentDir) return false;
    if (args.prevInlineCreate?.type !== args.nextInlineCreate?.type) return false;
    if (args.prevInlineCreate?.value !== args.nextInlineCreate?.value) return false;
  }

  if (args.prevExpandEpoch !== args.nextExpandEpoch) {
    if (
      expandTouchAffectsDir(nodePath, args.nextLastExpandPath) ||
      expandTouchAffectsDir(nodePath, args.prevLastExpandPath)
    ) {
      return false;
    }
  }

  if ((args.prevGitStatusRevision ?? 0) !== (args.nextGitStatusRevision ?? 0)) {
    return false;
  }

  return true;
}

export function repositoryTreeFileShouldUpdate(args: {
  prevNode: RepositoryFileTreeNode;
  nextNode: RepositoryFileTreeNode;
  prevDepth: number;
  nextDepth: number;
  prevSelectedPath: string | null;
  nextSelectedPath: string | null;
  prevHoverPath?: string | null;
  nextHoverPath?: string | null;
  prevGitStatusRevision?: number;
  nextGitStatusRevision?: number;
  prevEditorDirtyRevision?: number;
  nextEditorDirtyRevision?: number;
}): boolean {
  if (args.prevNode !== args.nextNode) return false;
  if (args.prevDepth !== args.nextDepth) return false;
  if ((args.prevGitStatusRevision ?? 0) !== (args.nextGitStatusRevision ?? 0)) return false;
  if ((args.prevEditorDirtyRevision ?? 0) !== (args.nextEditorDirtyRevision ?? 0)) return false;
  if ((args.prevSelectedPath === args.prevNode.path) !== (args.nextSelectedPath === args.nextNode.path)) {
    return false;
  }
  const path = args.prevNode.path;
  return (args.prevHoverPath === path) === (args.nextHoverPath === path);
}
