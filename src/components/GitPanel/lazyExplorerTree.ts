import type { RepositoryExplorerEntry } from "../../services/repositoryFiles";
import { explorerDirKey, explorerParentDir } from "./repositoryExplorerDirKey";
import type { RepositoryFileTreeNode } from "./types";

function entryBaseName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function sortExplorerNodesShallow(nodes: RepositoryFileTreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.isDir !== right.isDir) {
      return left.isDir ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

function entriesToTreeNodes(
  entries: RepositoryExplorerEntry[],
  loadedByDir: ReadonlyMap<string, RepositoryExplorerEntry[]>,
): RepositoryFileTreeNode[] {
  const nodes: RepositoryFileTreeNode[] = entries.map((entry) => {
    const node: RepositoryFileTreeNode = {
      name: entryBaseName(entry.path),
      path: entry.path,
      isDir: entry.isDir,
    };
    if (entry.isDir) {
      const childEntries = loadedByDir.get(explorerDirKey(entry.path));
      if (childEntries !== undefined) {
        node.children = entriesToTreeNodes(childEntries, loadedByDir);
      }
    }
    return node;
  });
  sortExplorerNodesShallow(nodes);
  return nodes;
}

/** Stable key for memo — avoids re-render when unrelated branches update. */
export function repositoryDirNodeContentKey(node: RepositoryFileTreeNode): string {
  if (!node.isDir) {
    return node.path;
  }
  if (node.children === undefined) {
    return `${explorerDirKey(node.path)}:pending`;
  }
  return `${node.path}:${node.children.map((child) => child.path).join("/")}`;
}

/** Build visible tree from per-directory lazy loads (`""` key = repository root). */
export function buildLazyRepositoryFileTree(
  loadedByDir: ReadonlyMap<string, RepositoryExplorerEntry[]>,
): RepositoryFileTreeNode[] {
  return entriesToTreeNodes(loadedByDir.get("") ?? [], loadedByDir);
}

function patchNodesAtPath(
  nodes: RepositoryFileTreeNode[],
  targetDir: string,
  loadedByDir: ReadonlyMap<string, RepositoryExplorerEntry[]>,
): RepositoryFileTreeNode[] {
  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (node.path === targetDir && node.isDir) {
      changed = true;
      const childEntries = loadedByDir.get(explorerDirKey(targetDir));
      return {
        ...node,
        children: childEntries !== undefined ? entriesToTreeNodes(childEntries, loadedByDir) : undefined,
      };
    }
    if (node.isDir && node.children && targetDir.startsWith(`${node.path}/`)) {
      const patchedChildren = patchNodesAtPath(node.children, targetDir, loadedByDir);
      if (patchedChildren !== node.children) {
        changed = true;
        return { ...node, children: patchedChildren };
      }
    }
    return node;
  });
  return changed ? nextNodes : nodes;
}

/** Patch one directory branch instead of rebuilding the whole tree. */
export function patchLazyRepositoryFileTree(
  prevRoot: RepositoryFileTreeNode[],
  loadedByDir: ReadonlyMap<string, RepositoryExplorerEntry[]>,
  changedDir: string,
): RepositoryFileTreeNode[] {
  const normalized = explorerDirKey(changedDir);
  if (!prevRoot.length || normalized === "") {
    return buildLazyRepositoryFileTree(loadedByDir);
  }
  return patchNodesAtPath(prevRoot, normalized, loadedByDir);
}

/** Drop a directory that no longer exists on disk from the lazy-load map and its parent listing. */
export function pruneStaleExplorerDirFromMap(
  loadedByDir: ReadonlyMap<string, RepositoryExplorerEntry[]>,
  staleDir: string,
): Map<string, RepositoryExplorerEntry[]> {
  const normalized = explorerDirKey(staleDir);
  const next = new Map(loadedByDir);
  next.delete(normalized);
  for (const key of [...next.keys()]) {
    if (key.startsWith(`${normalized}/`)) {
      next.delete(key);
    }
  }
  const parentKey = explorerDirKey(explorerParentDir(normalized));
  const parentChildren = next.get(parentKey);
  if (parentChildren) {
    next.set(
      parentKey,
      parentChildren.filter((entry) => explorerDirKey(entry.path) !== normalized),
    );
  }
  return next;
}

export function pruneLoadedChildrenMap(
  loadedByDir: ReadonlyMap<string, RepositoryExplorerEntry[]>,
  removedPath: string,
): Map<string, RepositoryExplorerEntry[]> {
  const next = new Map(loadedByDir);
  for (const key of [...next.keys()]) {
    if (key === removedPath || key.startsWith(`${removedPath}/`)) {
      next.delete(key);
    }
  }
  return next;
}

/** 懒加载目录缓存上限；保留根目录 `""`，按 Map 插入顺序淘汰最旧分支。 */
export const MAX_LOADED_EXPLORER_DIRS = 72;

export function capLoadedChildrenMap(
  loadedByDir: ReadonlyMap<string, RepositoryExplorerEntry[]>,
  maxDirs: number = MAX_LOADED_EXPLORER_DIRS,
): Map<string, RepositoryExplorerEntry[]> {
  if (loadedByDir.size <= maxDirs) {
    return loadedByDir instanceof Map ? loadedByDir : new Map(loadedByDir);
  }
  const next = new Map(loadedByDir);
  while (next.size > maxDirs) {
    let removed = false;
    for (const key of next.keys()) {
      if (key === "") continue;
      next.delete(key);
      removed = true;
      break;
    }
    if (!removed) break;
  }
  return next;
}
