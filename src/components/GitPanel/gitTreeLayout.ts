/** 每层目录深度仅增加一次缩进（与仓库文件树一致，不叠加 `.git-tree-children` 边距）。 */
export const GIT_TREE_DEPTH_INDENT_PX = 8;

/** 与 `.git-tree-node-arrow { width: 16px }` 一致。 */
export const GIT_TREE_ARROW_COLUMN_PX = 16;

/** 目录行左内边距。 */
export function gitTreeDirPaddingLeftPx(depth: number): number {
  return Math.max(0, depth) * GIT_TREE_DEPTH_INDENT_PX;
}

/**
 * 文件行左内边距：状态徽章与父级文件夹图标左对齐（占父级箭头列，不再重复缩进一层 depth）。
 */
export function gitTreeFilePaddingLeftPx(depth: number): number {
  if (depth <= 0) {
    return GIT_TREE_ARROW_COLUMN_PX;
  }
  return gitTreeDirPaddingLeftPx(depth - 1) + GIT_TREE_ARROW_COLUMN_PX;
}

/** @deprecated 使用 {@link gitTreeDirPaddingLeftPx} */
export function gitTreeDepthIndentPx(depth: number): number {
  return gitTreeDirPaddingLeftPx(depth);
}
