import { expandTouchAffectsDir } from "./repositoryTreeNodeExpandTouch";
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
  prevLoadingDirPath: string | null;
  nextLoadingDirPath: string | null;
}): boolean {
  if (repositoryDirNodeContentKey(args.prevNode) !== repositoryDirNodeContentKey(args.nextNode)) {
    return false;
  }
  if (args.prevDepth !== args.nextDepth) return false;
  if (args.prevExpanded !== args.nextExpanded) return false;
  if (args.prevLoadingDirPath === args.prevNode.path !== (args.nextLoadingDirPath === args.nextNode.path)) {
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

  return true;
}

export function repositoryTreeFileShouldUpdate(args: {
  prevNode: RepositoryFileTreeNode;
  nextNode: RepositoryFileTreeNode;
  prevDepth: number;
  nextDepth: number;
  prevSelectedPath: string | null;
  nextSelectedPath: string | null;
}): boolean {
  if (args.prevNode !== args.nextNode) return false;
  if (args.prevDepth !== args.nextDepth) return false;
  return (args.prevSelectedPath === args.prevNode.path) === (args.nextSelectedPath === args.nextNode.path);
}
