/** Per-depth indent for repository explorer rows (chevron column alignment). */
export const REPOSITORY_TREE_DEPTH_INDENT_PX = 12;

/** 与 `.repo-tree-node { min-height: 22px }` 一致，供虚拟列表窗口计算。 */
export const REPOSITORY_TREE_ROW_HEIGHT_PX = 22;

export function repositoryTreeDepthIndentPx(depth: number): number {
  return Math.max(0, depth) * REPOSITORY_TREE_DEPTH_INDENT_PX;
}
