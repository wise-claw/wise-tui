import { useCallback, useEffect, useRef, useState } from "react";

/**
 * DiffMode 目录折叠状态 hook
 *
 * 三层职责：
 * 1. **首次默认**：仓库首次进入（无持久化）时，把当前 tree 的所有**顶层目录** path
 *    写入 expandedDirs。子目录保持收起，避免一次性展示几百行。
 *    顶层判定：path 中不含分隔符（`/`）。
 * 2. **持久化**：仿 `explorerUtils.ts` 的 `wise.repoExplorer.expanded.v1:${repositoryPath}`
 *    命名，DiffMode 用 `wise.gitPanel.expanded.v1:${repositoryPath}`，sessionStorage 写入。
 * 3. **prune 过期**：当前 tree 重新计算后，过滤掉不在 treeDirPaths 集合里的 path，
 *    防止 commit 后目录消失但仍占着 expandedDirs 内存与持久化条目。
 */

const STORAGE_PREFIX = "wise.gitPanel.expanded.v1:";

function storageKey(repositoryPath: string): string {
  return `${STORAGE_PREFIX}${repositoryPath}`;
}

/** 顶层目录 = path 不含分隔符 */
function topLevelDirs(treeDirPaths: readonly string[]): string[] {
  return treeDirPaths.filter((p) => p.indexOf("/") === -1);
}

function readPersisted(repositoryPath: string): Set<string> | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(storageKey(repositoryPath));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return null;
  }
}

function writePersisted(repositoryPath: string, expanded: Set<string>): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(storageKey(repositoryPath), JSON.stringify([...expanded]));
  } catch {
    /* ignore quota / private mode */
  }
}

export interface UseDiffModeExpandedDirsApi {
  /** 当前展开的目录集合（含用户 toggle 过的、非当前 tree 的残留会被 prune）。 */
  expandedDirs: Set<string>;
  /** 切换单个目录的展开状态。 */
  toggleDir: (path: string) => void;
  /**
   * 递归切换一个目录及其全部子目录的展开状态。
   * subDirPaths：当前目录下所有子目录 path（含自身）。
   * 当前已展开 → 全部收起；当前已收起 → 全部展开。
   */
  toggleDirRecursive: (path: string, subDirPaths: readonly string[]) => void;
  /** 全展开当前 tree 中所有目录（含嵌套），覆盖式。 */
  expandAll: (allDirPaths: readonly string[]) => void;
  /** 全收起。 */
  collapseAll: () => void;
  /** 顶层目录是否默认展开（用于工具栏 icon 状态）。 */
  isTreeAllExpanded: boolean;
}

export function useDiffModeExpandedDirs(
  repositoryPath: string,
  treeDirPaths: readonly string[],
): UseDiffModeExpandedDirsApi {
  /** expandedDirs 状态：内部持有当前展开目录集合。 */
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => {
    const persisted = readPersisted(repositoryPath);
    if (persisted) return new Set(persisted);
    // 首次默认：展开所有顶层目录（不递归）
    return new Set(topLevelDirs(treeDirPaths));
  });

  /** 持久化：用 ref 跟踪 expandedDirs，写入防抖为同步写（数据量小，写入开销可忽略）。 */
  const repoRef = useRef(repositoryPath);
  repoRef.current = repositoryPath;

  useEffect(() => {
    writePersisted(repoRef.current, expandedDirs);
  }, [expandedDirs]);

  /** treeDirPaths 变化时 prune：移除不再存在的目录路径。 */
  useEffect(() => {
    if (treeDirPaths.length === 0) return;
    const valid = new Set(treeDirPaths);
    setExpandedDirs((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const p of prev) {
        if (valid.has(p)) {
          next.add(p);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [treeDirPaths]);

  const toggleDir = useCallback((dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  }, []);

  const toggleDirRecursive = useCallback(
    (dirPath: string, subDirPaths: readonly string[]) => {
      setExpandedDirs((prev) => {
        // 当前已展开（自身在集合内） → 全部收起
        if (prev.has(dirPath)) {
          const next = new Set(prev);
          for (const p of subDirPaths) next.delete(p);
          return next;
        }
        // 当前已收起 → 全部展开
        const next = new Set(prev);
        for (const p of subDirPaths) next.add(p);
        return next;
      });
    },
    [],
  );

  const expandAll = useCallback((allDirPaths: readonly string[]) => {
    setExpandedDirs(new Set(allDirPaths));
  }, []);

  const collapseAll = useCallback(() => {
    setExpandedDirs(new Set());
  }, []);

  const isTreeAllExpanded = treeDirPaths.length > 0 && expandedDirs.size >= treeDirPaths.length;

  return { expandedDirs, toggleDir, toggleDirRecursive, expandAll, collapseAll, isTreeAllExpanded };
}