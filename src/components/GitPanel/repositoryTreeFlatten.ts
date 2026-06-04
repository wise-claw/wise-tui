import { explorerDirKey } from "./repositoryExplorerDirKey";
import type { ExplorerInlineCreateState, RepositoryFileTreeNode } from "./types";

export type FlatRepositoryTreeRow =
  | {
      kind: "dir";
      key: string;
      node: RepositoryFileTreeNode;
      depth: number;
      isExpanded: boolean;
    }
  | {
      kind: "file";
      key: string;
      node: RepositoryFileTreeNode;
      depth: number;
    }
  | {
      kind: "loading";
      key: string;
      depth: number;
      parentPath: string;
    }
  | {
      kind: "empty-dir";
      key: string;
      depth: number;
      parentPath: string;
    }
  | {
      kind: "inline-create";
      key: string;
      depth: number;
      parentPath: string;
      inline: ExplorerInlineCreateState;
    };

export function flattenRepositoryTreeRows(input: {
  nodes: readonly RepositoryFileTreeNode[];
  expandedDirs: ReadonlySet<string>;
  loadingDirKeys: ReadonlySet<string>;
  inlineCreate: ExplorerInlineCreateState | null;
}): FlatRepositoryTreeRow[] {
  const rows: FlatRepositoryTreeRow[] = [];

  const walk = (nodes: readonly RepositoryFileTreeNode[], depth: number): void => {
    for (const node of nodes) {
      if (!node.isDir) {
        rows.push({ kind: "file", key: node.path, node, depth });
        continue;
      }

      const nodeDirKey = explorerDirKey(node.path);
      const isExpanded = input.expandedDirs.has(nodeDirKey);
      rows.push({
        kind: "dir",
        key: node.path,
        node,
        depth,
        isExpanded,
      });

      const showInlineHere = input.inlineCreate != null && input.inlineCreate.parentDir === node.path;
      if (!isExpanded && !showInlineHere) {
        continue;
      }

      const childNodes = node.children;
      const isLoadingChildren = input.loadingDirKeys.has(nodeDirKey) && childNodes === undefined;
      if (isLoadingChildren) {
        rows.push({
          kind: "loading",
          key: `${node.path}::loading`,
          depth: depth + 1,
          parentPath: node.path,
        });
      } else if (isExpanded && Array.isArray(childNodes) && childNodes.length === 0) {
        rows.push({
          kind: "empty-dir",
          key: `${node.path}::empty`,
          depth: depth + 1,
          parentPath: node.path,
        });
      } else {
        walk(childNodes ?? [], depth + 1);
      }

      if (showInlineHere && input.inlineCreate) {
        rows.push({
          kind: "inline-create",
          key: `${node.path}::inline`,
          depth: depth + 1,
          parentPath: node.path,
          inline: input.inlineCreate,
        });
      }
    }
  };

  walk(input.nodes, 0);
  return rows;
}
