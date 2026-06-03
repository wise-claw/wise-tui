/** Per-depth indent for repository explorer rows (chevron column alignment). */
export const REPOSITORY_TREE_DEPTH_INDENT_PX = 12;

export function repositoryTreeDepthIndentPx(depth: number): number {
  return Math.max(0, depth) * REPOSITORY_TREE_DEPTH_INDENT_PX;
}
