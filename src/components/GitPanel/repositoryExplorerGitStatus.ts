import type { GitStatusResponse } from "../../types";

/**
 * git 状态严重度排序：D > M > A > R > T > ?
 * 目录继承子代最高严重度状态，与 VS Code 文件树颜色一致。
 */
const STATUS_SEVERITY: Record<string, number> = {
  D: 5,
  M: 4,
  A: 3,
  R: 2,
  T: 1,
  "?": 0,
};

function moreSevereStatus(a: string, b: string): string {
  const sa = STATUS_SEVERITY[a] ?? -1;
  const sb = STATUS_SEVERITY[b] ?? -1;
  return sa >= sb ? a : b;
}

export type ExplorerGitStatusIndex = {
  /** unstaged 覆盖 staged，与 VS Code 工作区装饰一致 */
  fileStatusByPath: ReadonlyMap<string, string>;
  dirsWithChanges: ReadonlySet<string>;
  /** 目录聚合状态——取子代最高严重度 */
  dirStatusByPath: ReadonlyMap<string, string>;
};

export const EMPTY_EXPLORER_GIT_STATUS_INDEX: ExplorerGitStatusIndex = {
  fileStatusByPath: new Map(),
  dirsWithChanges: new Set(),
  dirStatusByPath: new Map(),
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
  const dirStatusByPath = new Map<string, string>();
  for (const [path, status] of fileStatusByPath) {
    addAncestorDirs(dirsWithChanges, path);
    let parent = path;
    while (true) {
      const slash = parent.lastIndexOf("/");
      if (slash <= 0) break;
      const dir = parent.slice(0, slash);
      dirStatusByPath.set(dir, moreSevereStatus(dirStatusByPath.get(dir) ?? "", status));
      parent = dir;
    }
  }

  return { fileStatusByPath, dirsWithChanges, dirStatusByPath };
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
  if (left.dirStatusByPath.size !== right.dirStatusByPath.size) {
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
  for (const [dir, status] of left.dirStatusByPath) {
    if (right.dirStatusByPath.get(dir) !== status) {
      return false;
    }
  }
  return true;
}
