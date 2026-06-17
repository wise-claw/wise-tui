import type { RepositoryExplorerEntry } from "../../services/repositoryFiles";
import type { GitFileStatus, GitStatusResponse } from "../../types";
import { buildConventionalCommitFallback } from "../../utils/conventionalCommitMessage";

export function repositoryExplorerEntriesEqual(
  left: readonly RepositoryExplorerEntry[],
  right: readonly RepositoryExplorerEntry[],
): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i]!;
    const b = right[i]!;
    if (a.path !== b.path || a.isDir !== b.isDir) return false;
  }
  return true;
}

/** 超过此数量时 Git 变更列表启用虚拟滚动（列表视图）。 */
export const GIT_PANEL_VIRTUAL_LIST_THRESHOLD = 48;

/** 文档/测试用参考：超大变更集仍可走列表虚拟滚动，树状视图默认仅渲染已展开目录。 */
export const GIT_PANEL_LARGE_CHANGE_COUNT = 200;

/** 文件 watcher 触发 git status 刷新的防抖间隔（ms）。 */
export const GIT_WATCHER_REFRESH_MS = 450;

/** 多仓面板 watcher 刷新防抖（更长，避免多仓同时全量 status）。 */
export const GIT_MULTI_REPO_WATCHER_REFRESH_MS = 1500;

/** 多仓模式下各仓库 status 初始加载的错峰间隔（ms）。 */
export const GIT_MULTI_REPO_LOAD_STAGGER_MS = 280;

/** 多仓 lazy 区块滚出视口后延迟卸载（ms），避免快速滚动时反复挂载。 */
export const GIT_MULTI_REPO_LAZY_UNMOUNT_MS = 900;

/** 多仓 file watcher 路径集合变更后的合并重启延迟（ms）。 */
export const GIT_MULTI_REPO_WATCHER_RESTART_MS = 180;

/** 虚拟列表行高（px），需与 `.git-file-row` 一致。 */
export const GIT_PANEL_FILE_ROW_HEIGHT = 28;

export function shouldUseGitVirtualFileList(fileCount: number): boolean {
  return fileCount > GIT_PANEL_VIRTUAL_LIST_THRESHOLD;
}

export function getStatusSymbol(status: string): string {
  switch (status) {
    case "A":
      return "A";
    case "M":
      return "M";
    case "D":
      return "D";
    case "R":
      return "R";
    case "T":
      return "T";
    default:
      return "?";
  }
}

/** 比较 git status 快照，避免 watcher 刷新触发无效重渲染。 */
export function gitStatusSnapshotEqual(
  prev: GitStatusResponse | null,
  next: GitStatusResponse,
): boolean {
  if (!prev) return false;
  if (
    prev.branch !== next.branch ||
    prev.ahead !== next.ahead ||
    prev.behind !== next.behind ||
    prev.additions !== next.additions ||
    prev.deletions !== next.deletions ||
    prev.staged.length !== next.staged.length ||
    prev.unstaged.length !== next.unstaged.length
  ) {
    return false;
  }
  for (let i = 0; i < prev.staged.length; i += 1) {
    const a = prev.staged[i]!;
    const b = next.staged[i]!;
    if (a.path !== b.path || a.status !== b.status) return false;
  }
  for (let i = 0; i < prev.unstaged.length; i += 1) {
    const a = prev.unstaged[i]!;
    const b = next.unstaged[i]!;
    if (a.path !== b.path || a.status !== b.status) return false;
  }
  return true;
}

export interface GitStatusHeaderSnapshot {
  branch: string | null;
  ahead: number;
  behind: number;
  stagedCount: number;
  unstagedCount: number;
}

/** 比较多仓折叠 header 快照，避免 watcher 刷新触发无效重渲染。 */
export function gitStatusHeaderSnapshotEqual(
  prev: GitStatusHeaderSnapshot | null,
  next: GitStatusHeaderSnapshot,
): boolean {
  if (!prev) return false;
  return (
    prev.branch === next.branch &&
    prev.ahead === next.ahead &&
    prev.behind === next.behind &&
    prev.stagedCount === next.stagedCount &&
    prev.unstagedCount === next.unstagedCount
  );
}

export function buildCommitDraftFromStatus(status: GitStatusResponse): string {
  return buildConventionalCommitFallback(status);
}

export function getStatusColor(status: string): string {
  switch (status) {
    case "A":
      return "#52c41a";
    case "M":
      return "#faad14";
    case "D":
      return "#ff4d4f";
    default:
      return "var(--ant-color-text-tertiary)";
  }
}

/** 未暂存列表中是否存在该目录下的文件（用于目录行批量暂存）。 */
export function hasUnstagedFilesUnderDirectory(
  unstaged: GitFileStatus[],
  dirPath: string,
): boolean {
  const prefix = `${dirPath}/`;
  return unstaged.some((file) => file.path.startsWith(prefix));
}

export function hasExpandedDescendant(expandedDirs: Set<string>, path: string): boolean {
  const prefix = `${path}/`;
  for (const entry of expandedDirs) {
    if (entry.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

export function formatCommitDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function splitPath(path: string) {
  const parts = path.split("/");
  if (parts.length === 1) return { name: path, dir: "" };
  return { name: parts[parts.length - 1], dir: parts.slice(0, -1).join("/") };
}

export function splitNameAndExt(name: string) {
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === name.length - 1) return { base: name, ext: "" };
  return { base: name.slice(0, lastDot), ext: name.slice(lastDot + 1).toLowerCase() };
}

/** Let the browser paint loading state before a potentially slow Tauri call starts. */
export function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/** Run after the next paint so sidebar selection can update before heavy IPC / session work. */
export function deferAfterPaint(task: () => void): () => void {
  let cancelled = false;
  let secondFrame = 0;
  const firstFrame = requestAnimationFrame(() => {
    secondFrame = requestAnimationFrame(() => {
      if (!cancelled) {
        task();
      }
    });
  });

  return () => {
    cancelled = true;
    cancelAnimationFrame(firstFrame);
    if (secondFrame) {
      cancelAnimationFrame(secondFrame);
    }
  };
}
