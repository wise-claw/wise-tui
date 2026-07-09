export interface RepositoryExplorerExpandState {
  dirs: Set<string>;
  epoch: number;
  lastPath: string;
}

export const INITIAL_REPOSITORY_EXPLORER_EXPAND_STATE: RepositoryExplorerExpandState = {
  dirs: new Set(),
  epoch: 0,
  lastPath: "",
};

export type RepositoryExplorerExpandAction =
  | { type: "toggle"; path: string }
  | { type: "replace"; dirs: Set<string> }
  | { type: "collapseAll" }
  | { type: "expandAncestors"; parentDir: string }
  | { type: "pruneSubtree"; rootPath: string }
  | { type: "renameDir"; fromPath: string; toPath: string };

export function mergeExpandedAncestorDirs(prev: Set<string>, parentDir: string): Set<string> {
  if (!parentDir) {
    return prev;
  }
  const next = new Set(prev);
  const parts = parentDir.split("/").filter(Boolean);
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    next.add(acc);
  }
  return next;
}

export function pruneExpandedSubtree(prev: Set<string>, rootPath: string): Set<string> {
  const next = new Set<string>();
  for (const entry of prev) {
    if (entry === rootPath || entry.startsWith(`${rootPath}/`)) {
      continue;
    }
    next.add(entry);
  }
  return next;
}

/**
 * 把展开表里 `fromPath` 及其后代迁移到 `toPath`，用于目录重命名后保留展开态。
 * 仅当 `fromPath` 或其后代存在时才有意义；不存在的 key 直接跳过。
 */
export function migrateExpandedDir(prev: Set<string>, fromPath: string, toPath: string): Set<string> {
  if (!fromPath || fromPath === toPath) {
    return prev;
  }
  let changed = false;
  const next = new Set<string>();
  for (const entry of prev) {
    if (entry === fromPath) {
      next.add(toPath);
      changed = true;
      continue;
    }
    if (entry.startsWith(`${fromPath}/`)) {
      next.add(`${toPath}${entry.slice(fromPath.length)}`);
      changed = true;
      continue;
    }
    next.add(entry);
  }
  return changed ? next : prev;
}

export function reduceRepositoryExplorerExpandState(
  state: RepositoryExplorerExpandState,
  action: RepositoryExplorerExpandAction,
): RepositoryExplorerExpandState {
  switch (action.type) {
    case "toggle": {
      const next = new Set(state.dirs);
      if (next.has(action.path)) {
        next.delete(action.path);
      } else {
        next.add(action.path);
      }
      return { dirs: next, epoch: state.epoch + 1, lastPath: action.path };
    }
    case "replace":
      return { dirs: new Set(action.dirs), epoch: state.epoch, lastPath: state.lastPath };
    case "collapseAll":
      if (state.dirs.size === 0) {
        return state;
      }
      return { dirs: new Set(), epoch: state.epoch + 1, lastPath: "" };
    case "expandAncestors": {
      const dirs = mergeExpandedAncestorDirs(state.dirs, action.parentDir);
      if (dirs.size === state.dirs.size) {
        return state;
      }
      return { dirs, epoch: state.epoch + 1, lastPath: action.parentDir };
    }
    case "pruneSubtree": {
      const dirs = pruneExpandedSubtree(state.dirs, action.rootPath);
      if (dirs.size === state.dirs.size) {
        return state;
      }
      return { dirs, epoch: state.epoch + 1, lastPath: action.rootPath };
    }
    case "renameDir": {
      const dirs = migrateExpandedDir(state.dirs, action.fromPath, action.toPath);
      if (dirs === state.dirs) {
        return state;
      }
      return { dirs, epoch: state.epoch + 1, lastPath: action.toPath };
    }
    default:
      return state;
  }
}
