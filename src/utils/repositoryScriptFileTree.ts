import type { RepositoryExplorerEntry } from "../services/repositoryFiles";
import { normalizeScheduledTaskScriptFilePath } from "./scheduledTaskScript";

export interface RepositoryScriptFileTreeNode {
  title: string;
  value: string;
  selectable: boolean;
  isLeaf: boolean;
  children?: RepositoryScriptFileTreeNode[];
}

/** 树节点展示名：取路径最后一段。 */
export function repositoryScriptFileTreeNodeTitle(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

export function buildRepositoryScriptFileTreeNodes(
  entries: readonly RepositoryExplorerEntry[],
): RepositoryScriptFileTreeNode[] {
  const nodes: RepositoryScriptFileTreeNode[] = [];
  for (const entry of entries) {
    const path = normalizeScheduledTaskScriptFilePath(entry.path);
    if (!path) continue;
    if (entry.isDir) {
      nodes.push({
        title: path,
        value: path,
        selectable: false,
        isLeaf: false,
      });
    } else {
      nodes.push({
        title: path,
        value: path,
        selectable: true,
        isLeaf: true,
      });
    }
  }
  nodes.sort((a, b) => {
    if (a.isLeaf !== b.isLeaf) return a.isLeaf ? 1 : -1;
    return a.title.localeCompare(b.title, "zh");
  });
  return nodes;
}

export function patchRepositoryScriptFileTreeChildren(
  nodes: RepositoryScriptFileTreeNode[],
  parentValue: string,
  children: RepositoryScriptFileTreeNode[],
): RepositoryScriptFileTreeNode[] {
  if (!parentValue) return children;
  return nodes.map((node) => {
    if (node.value === parentValue) {
      return { ...node, children, isLeaf: children.length === 0 };
    }
    if (node.children) {
      return {
        ...node,
        children: patchRepositoryScriptFileTreeChildren(node.children, parentValue, children),
      };
    }
    return node;
  });
}

function treeContainsValue(nodes: readonly RepositoryScriptFileTreeNode[], value: string): boolean {
  for (const node of nodes) {
    if (node.value === value) return true;
    if (node.children && treeContainsValue(node.children, value)) return true;
  }
  return false;
}

/** 编辑态已选路径尚未出现在已加载树中时，补一个叶子以便回显。 */
export function ensureSelectedFileTreeNode(
  nodes: RepositoryScriptFileTreeNode[],
  selectedPath: string | undefined,
): RepositoryScriptFileTreeNode[] {
  const current = normalizeScheduledTaskScriptFilePath(selectedPath);
  if (!current) return nodes;
  if (treeContainsValue(nodes, current)) return nodes;
  return [
    {
      title: current,
      value: current,
      selectable: true,
      isLeaf: true,
    },
    ...nodes,
  ];
}
