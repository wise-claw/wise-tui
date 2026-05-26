import type { SnapshotTreeNode } from "../../types/myExtension";

export const SNAPSHOT_ROOT_KEY = "__snapshot_root__";

export function findSnapshotNode(nodes: SnapshotTreeNode[], key: string): SnapshotTreeNode | null {
  for (const node of nodes) {
    if (node.key === key) return node;
    if (node.children) {
      const nested = findSnapshotNode(node.children, key);
      if (nested) return nested;
    }
  }
  return null;
}

/** 新建文件/目录时的父路径：选中文件夹 → 该文件夹；选中文件 → 其所在目录 */
export function parentDirForSnapshotKey(nodes: SnapshotTreeNode[], key: string | null): string {
  if (!key || key === SNAPSHOT_ROOT_KEY) return "";
  const node = findSnapshotNode(nodes, key);
  if (node) {
    if (node.isLeaf) {
      const idx = key.lastIndexOf("/");
      return idx >= 0 ? key.slice(0, idx) : "";
    }
    return key;
  }
  const idx = key.lastIndexOf("/");
  return idx >= 0 ? key.slice(0, idx) : key;
}

export function joinSnapshotRelative(parent: string, name: string): string {
  const trimmed = name.trim().replace(/^\/+/, "").replace(/\\/g, "/");
  if (!trimmed) return "";
  if (trimmed.includes("/") || trimmed.includes("..")) return "";
  return parent ? `${parent}/${trimmed}` : trimmed;
}

export function resolveTreeFocusKey(key: string | null): string | null {
  if (!key || key === SNAPSHOT_ROOT_KEY) return null;
  return key;
}
