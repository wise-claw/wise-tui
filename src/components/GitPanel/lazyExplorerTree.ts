import type { RepositoryExplorerEntry } from "../../services/repositoryFiles";
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
      const childEntries = loadedByDir.get(entry.path);
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
    return `${node.path}:pending`;
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
      const childEntries = loadedByDir.get(targetDir);
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
  const normalized = changedDir.trim();
  if (!prevRoot.length || normalized === "") {
    return buildLazyRepositoryFileTree(loadedByDir);
  }
  return patchNodesAtPath(prevRoot, normalized, loadedByDir);
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
