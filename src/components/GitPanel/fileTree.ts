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
