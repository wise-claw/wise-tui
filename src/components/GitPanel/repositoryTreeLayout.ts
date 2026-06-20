/** Per-depth indent for repository explorer rows (chevron column alignment). */
export const REPOSITORY_TREE_DEPTH_INDENT_PX = 16;

/** 与 `.repo-tree-node-arrow { width: 24px }` 一致。 */
export const REPOSITORY_TREE_CHEVRON_COLUMN_PX = 24;

/** 与 `.repo-tree-node { min-height: 26px }` 一致，供虚拟列表窗口计算。 */
export const REPOSITORY_TREE_ROW_HEIGHT_PX = 26;

export function repositoryTreeDepthIndentPx(depth: number): number {
  return Math.max(0, depth) * REPOSITORY_TREE_DEPTH_INDENT_PX;
}

/** 文件行：图标与父文件夹图标左对齐（占用父级 chevron 列，不再多缩进一层 depth）。 */
export function repositoryTreeFileDepthIndentPx(depth: number): number {
  if (depth <= 0) {
    return REPOSITORY_TREE_CHEVRON_COLUMN_PX;
  }
  return repositoryTreeDepthIndentPx(depth - 1) + REPOSITORY_TREE_CHEVRON_COLUMN_PX;
}
