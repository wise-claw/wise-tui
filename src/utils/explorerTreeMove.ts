/** 文件树拖放到目录时的路径解析（纯函数，不碰 DOM / IPC）。 */

export interface ExplorerMoveSource {
  relativePath: string;
  isDir: boolean;
}

export interface ExplorerDropTarget {
  /** 仓库相对路径；空串表示仓库根。 */
  relativePath: string;
  isDir: boolean;
}

export type ExplorerMovePlan =
  | { kind: "invalid"; reason: "empty" | "self" | "into-descendant" }
  | { kind: "noop"; destDir: string }
  | { kind: "move"; fromPath: string; toPath: string; destDir: string; isDir: boolean };

export function normalizeExplorerRelativePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

export function explorerEntryParentDir(path: string): string {
  const key = normalizeExplorerRelativePath(path);
  const slash = key.lastIndexOf("/");
  return slash >= 0 ? key.slice(0, slash) : "";
}

export function explorerEntryBaseName(path: string): string {
  const key = normalizeExplorerRelativePath(path);
  const slash = key.lastIndexOf("/");
  return slash >= 0 ? key.slice(slash + 1) : key;
}

/** 落在文件上时，目标是该文件所在目录；落在目录上时即该目录。 */
export function resolveExplorerDropDestDir(target: ExplorerDropTarget): string {
  const path = normalizeExplorerRelativePath(target.relativePath);
  if (target.isDir) {
    return path;
  }
  return explorerEntryParentDir(path);
}

/**
 * 把源条目拖到目标节点后应执行的操作。
 * 文件落点视为其父目录；目录不能拖进自身或子孙。
 */
export function resolveExplorerMove(
  source: ExplorerMoveSource,
  target: ExplorerDropTarget,
): ExplorerMovePlan {
  const fromPath = normalizeExplorerRelativePath(source.relativePath);
  if (!fromPath) {
    return { kind: "invalid", reason: "empty" };
  }
  const destDir = resolveExplorerDropDestDir(target);
  if (destDir === fromPath) {
    return { kind: "invalid", reason: "self" };
  }
  if (source.isDir && destDir.startsWith(`${fromPath}/`)) {
    return { kind: "invalid", reason: "into-descendant" };
  }
  const fromParent = explorerEntryParentDir(fromPath);
  if (fromParent === destDir) {
    return { kind: "noop", destDir };
  }
  const name = explorerEntryBaseName(fromPath);
  if (!name) {
    return { kind: "invalid", reason: "empty" };
  }
  const toPath = destDir ? `${destDir}/${name}` : name;
  if (toPath === fromPath) {
    return { kind: "noop", destDir };
  }
  return { kind: "move", fromPath, toPath, destDir, isDir: source.isDir };
}
