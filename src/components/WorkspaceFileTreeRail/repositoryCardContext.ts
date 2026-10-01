import type { GitPanelRepositoryEntry } from "../../utils/workspaceRepositoryTreeSelect";
import type { WorkspaceFileTreeRailContext } from "./types";

/** 卡片目录独立于会话选择；文件预览必须保留所选仓库根路径。 */
export function repositoryCardFileTreeContext(
  context: WorkspaceFileTreeRailContext,
  entry: GitPanelRepositoryEntry | null,
): WorkspaceFileTreeRailContext {
  if (!entry) return context;
  return {
    ...context,
    repositoryPath: entry.path,
    repositoryName: entry.name,
    repositoryEntries: [entry],
    onOpenFile: (path, options) => context.onOpenFile(path, {
      ...options,
      fileRootPath: entry.path,
    }),
  };
}
