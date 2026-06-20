import type { GitStatusResponse } from "../../types";

export type ExplorerGitStatusIndex = {
  /** unstaged 覆盖 staged，与 VS Code 工作区装饰一致 */
  fileStatusByPath: ReadonlyMap<string, string>;
  dirsWithChanges: ReadonlySet<string>;
};

export const EMPTY_EXPLORER_GIT_STATUS_INDEX: ExplorerGitStatusIndex = {
  fileStatusByPath: new Map(),
  dirsWithChanges: new Set(),
};

function addAncestorDirs(set: Set<string>, filePath: string): void {
  let slash = filePath.lastIndexOf("/");
  while (slash > 0) {
    set.add(filePath.slice(0, slash));
    slash = filePath.lastIndexOf("/", slash - 1);
  }
}

export function buildExplorerGitStatusIndex(status: GitStatusResponse | null): ExplorerGitStatusIndex {
  if (!status) {
    return EMPTY_EXPLORER_GIT_STATUS_INDEX;
  }

  const fileStatusByPath = new Map<string, string>();
  for (const file of status.staged) {
    fileStatusByPath.set(file.path, file.status);
  }
  for (const file of status.unstaged) {
    fileStatusByPath.set(file.path, file.status);
  }

  const dirsWithChanges = new Set<string>();
  for (const path of fileStatusByPath.keys()) {
    addAncestorDirs(dirsWithChanges, path);
  }

  return { fileStatusByPath, dirsWithChanges };
}

export function explorerGitStatusIndexEqual(
  left: ExplorerGitStatusIndex,
  right: ExplorerGitStatusIndex,
): boolean {
  if (left.fileStatusByPath.size !== right.fileStatusByPath.size) {
    return false;
  }
  if (left.dirsWithChanges.size !== right.dirsWithChanges.size) {
    return false;
  }
  for (const [path, status] of left.fileStatusByPath) {
    if (right.fileStatusByPath.get(path) !== status) {
      return false;
    }
  }
  for (const dir of left.dirsWithChanges) {
    if (!right.dirsWithChanges.has(dir)) {
      return false;
    }
  }
  return true;
}
