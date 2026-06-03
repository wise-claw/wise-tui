import type { RepositoryExplorerEntry } from "../../services/repositoryFiles";
import type { GitFileStatus } from "../../types";
import type { FileTreeNode, RepositoryFileTreeNode } from "./types";

export function buildFileTree(files: GitFileStatus[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  const dirMap = new Map<string, FileTreeNode>();

  for (const file of files) {
    const parts = file.path.split("/");
    let currentPath = "";

    for (let i = 0; i < parts.length - 1; i += 1) {
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]!;

      if (!dirMap.has(currentPath)) {
        const node: FileTreeNode = {
          name: parts[i]!,
          path: currentPath,
          isDir: true,
          children: [],
          additions: 0,
          deletions: 0,
          status: "M",
        };
        dirMap.set(currentPath, node);

        const parent = parentPath ? dirMap.get(parentPath) : null;
        if (parent) {
          parent.children!.push(node);
        } else {
          root.push(node);
        }
      }
    }

    const fileName = parts[parts.length - 1]!;
    const fileNode: FileTreeNode = {
      name: fileName,
      path: file.path,
      isDir: false,
      file,
      additions: file.additions,
      deletions: file.deletions,
      status: file.status,
    };

    const parentDir = parts.length > 1 ? parts.slice(0, -1).join("/") : null;
    const parent = parentDir ? dirMap.get(parentDir) : null;
    if (parent) {
      parent.children!.push(fileNode);
    } else {
      root.push(fileNode);
    }
  }

  function aggregate(node: FileTreeNode): void {
    if (!node.children) return;
    for (const child of node.children) {
      aggregate(child);
      node.additions += child.additions;
      node.deletions += child.deletions;
    }
  }
  for (const node of root) {
    aggregate(node);
  }

  return root;
}

function sortRepositoryTreeNodes(nodes: RepositoryFileTreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.isDir !== right.isDir) {
      return left.isDir ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
  for (const node of nodes) {
    if (node.children) {
      sortRepositoryTreeNodes(node.children);
    }
  }
}

/** Build the explorer tree from backend directory and file entries, including empty folders. */
export function buildRepositoryFileTree(entries: RepositoryExplorerEntry[]): RepositoryFileTreeNode[] {
  const root: RepositoryFileTreeNode[] = [];
  const dirMap = new Map<string, RepositoryFileTreeNode>();

  function touchDirSegments(fullDirPath: string): void {
    const parts = fullDirPath.split("/").filter(Boolean);
    let currentPath = "";
    for (const part of parts) {
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (!dirMap.has(currentPath)) {
        const node: RepositoryFileTreeNode = {
          name: part,
          path: currentPath,
          isDir: true,
          children: [],
        };
        dirMap.set(currentPath, node);
        const parent = parentPath ? dirMap.get(parentPath) : null;
        if (parent) {
          parent.children!.push(node);
        } else {
          root.push(node);
        }
      }
    }
  }

  const sorted = [...entries].sort((a, b) => {
    const pc = a.path.localeCompare(b.path);
    if (pc !== 0) {
      return pc;
    }
    return a.isDir === b.isDir ? 0 : a.isDir ? -1 : 1;
  });

  for (const entry of sorted) {
    if (entry.isDir) {
      touchDirSegments(entry.path);
    }
  }

  for (const entry of sorted) {
    if (entry.isDir) {
      continue;
    }
    const parts = entry.path.split("/").filter(Boolean);
    if (parts.length === 0) {
      continue;
    }
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    if (parentPath) {
      touchDirSegments(parentPath);
    }
    const fileName = parts[parts.length - 1]!;
    const fileNode: RepositoryFileTreeNode = {
      name: fileName,
      path: entry.path,
      isDir: false,
    };
    const parent = parentPath ? dirMap.get(parentPath) : null;
    const list = parent ? parent.children! : root;
    if (!list.some((node) => node.path === entry.path && !node.isDir)) {
      list.push(fileNode);
    }
  }

  sortRepositoryTreeNodes(root);
  return root;
}

export function collectDirectoryPaths(nodes: RepositoryFileTreeNode[], out: Set<string>): void {
  for (const node of nodes) {
    if (!node.isDir) {
      continue;
    }
    out.add(node.path);
    if (node.children) {
      collectDirectoryPaths(node.children, out);
    }
  }
}

/** Min query length before running explorer search (avoids ultra-broad single-char scans). */
export const MIN_EXPLORER_SEARCH_QUERY_LEN = 2;

/** Max rows shown in flat explorer search results. */
export const EXPLORER_SEARCH_MAX_MATCHES = 500;

export interface ExplorerSearchResultRow {
  path: string;
  isDir: boolean;
  name: string;
  parentPath: string;
  score: number;
}

export interface ExplorerEntryIndexRow {
  entry: RepositoryExplorerEntry;
  pathLower: string;
  nameLower: string;
}

export interface ExplorerEntryIndex {
  entries: RepositoryExplorerEntry[];
  byPath: Map<string, RepositoryExplorerEntry>;
  rows: ExplorerEntryIndexRow[];
}

export interface ExplorerSearchSlice {
  rows: ExplorerSearchResultRow[];
  truncated: boolean;
  tooShort: boolean;
}

export function buildExplorerEntryIndex(entries: RepositoryExplorerEntry[]): ExplorerEntryIndex {
  const byPath = new Map<string, RepositoryExplorerEntry>();
  const rows: ExplorerEntryIndexRow[] = [];
  for (const entry of entries) {
    byPath.set(entry.path, entry);
    const slash = entry.path.lastIndexOf("/");
    const name = slash >= 0 ? entry.path.slice(slash + 1) : entry.path;
    rows.push({
      entry,
      pathLower: entry.path.toLowerCase(),
      nameLower: name.toLowerCase(),
    });
  }
  return { entries, byPath, rows };
}

function explorerSearchMatchScore(nameLower: string, pathLower: string, q: string): number | null {
  if (nameLower.startsWith(q)) {
    return 0;
  }
  if (nameLower.includes(q)) {
    return 1;
  }
  if (pathLower.includes(q)) {
    return 2;
  }
  return null;
}

/**
 * Indexed flat scan for explorer search — builds ranked rows for a compact result list.
 */
export function sliceExplorerEntriesForSearch(
  index: ExplorerEntryIndex,
  query: string,
): ExplorerSearchSlice {
  const q = query.trim().toLowerCase();
  if (!q) {
    return { rows: [], truncated: false, tooShort: false };
  }
  if (q.length < MIN_EXPLORER_SEARCH_QUERY_LEN) {
    return { rows: [], truncated: false, tooShort: true };
  }

  const scored: ExplorerSearchResultRow[] = [];

  for (const row of index.rows) {
    const score = explorerSearchMatchScore(row.nameLower, row.pathLower, q);
    if (score == null) {
      continue;
    }
    const slash = row.entry.path.lastIndexOf("/");
    const name = slash >= 0 ? row.entry.path.slice(slash + 1) : row.entry.path;
    const parentPath = slash >= 0 ? row.entry.path.slice(0, slash) : "";
    scored.push({
      path: row.entry.path,
      isDir: row.entry.isDir,
      name,
      parentPath,
      score,
    });
  }

  scored.sort((left, right) => {
    if (left.score !== right.score) {
      return left.score - right.score;
    }
    if (left.path.length !== right.path.length) {
      return left.path.length - right.path.length;
    }
    return left.path.localeCompare(right.path);
  });

  const truncated = scored.length > EXPLORER_SEARCH_MAX_MATCHES;
  if (truncated) {
    scored.length = EXPLORER_SEARCH_MAX_MATCHES;
  }

  return { rows: scored, truncated, tooShort: false };
}

export function filterRepositoryTree(
  nodes: RepositoryFileTreeNode[],
  query: string,
): RepositoryFileTreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return nodes;
  }

  const filtered: RepositoryFileTreeNode[] = [];
  for (const node of nodes) {
    if (node.isDir) {
      const children = filterRepositoryTree(node.children ?? [], q);
      const dirMatched = node.name.toLowerCase().includes(q);
      if (dirMatched || children.length > 0) {
        filtered.push({
          ...node,
          children,
        });
      }
      continue;
    }
    if (node.path.toLowerCase().includes(q)) {
      filtered.push(node);
    }
  }
  return filtered;
}
