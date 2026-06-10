import type { ProjectItem, Repository } from "../types";
import {
  buildWorkspaceRepositoryTreeData,
  type WorkspaceRepositoryTreeNode,
} from "./workspaceRepositoryTreeSelect";

export function buildWorkspaceTodoTargetTree(
  projects: readonly ProjectItem[],
  repositories: readonly Repository[],
): WorkspaceRepositoryTreeNode[] {
  return buildWorkspaceRepositoryTreeData(projects, repositories);
}

function treeContainsSelectableKey(nodes: readonly WorkspaceRepositoryTreeNode[], key: string): boolean {
  for (const node of nodes) {
    if (node.value === key && node.selectable) return true;
    if (node.children && treeContainsSelectableKey(node.children, key)) return true;
  }
  return false;
}

export function findFirstSelectableWorkspaceTodoTreeKey(
  nodes: readonly WorkspaceRepositoryTreeNode[],
): string | null {
  for (const node of nodes) {
    if (node.selectable) return node.value;
    if (node.children) {
      const childKey = findFirstSelectableWorkspaceTodoTreeKey(node.children);
      if (childKey) return childKey;
    }
  }
  return null;
}

export function resolveDefaultWorkspaceTodoTreeKey(input: {
  treeNodes: readonly WorkspaceRepositoryTreeNode[];
  activeProjectId: string | null;
  activeRepositoryId: number | null;
}): string | null {
  if (input.activeRepositoryId != null) {
    const repositoryKey = `repo:${input.activeRepositoryId}`;
    if (treeContainsSelectableKey(input.treeNodes, repositoryKey)) {
      return repositoryKey;
    }
  }
  if (input.activeProjectId?.trim()) {
    const projectKey = `project:${input.activeProjectId.trim()}`;
    if (treeContainsSelectableKey(input.treeNodes, projectKey)) {
      return projectKey;
    }
  }
  return findFirstSelectableWorkspaceTodoTreeKey(input.treeNodes);
}
