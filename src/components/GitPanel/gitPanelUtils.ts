import type { GitFileStatus, GitStatusResponse } from "../../types";

/** 超过此数量时 Git 面板改用虚拟列表，并默认收起/列表视图。 */
export const GIT_PANEL_LARGE_CHANGE_COUNT = 200;

/** 虚拟列表行高（px），需与 `.git-file-row` 一致。 */
export const GIT_PANEL_FILE_ROW_HEIGHT = 28;

export function shouldUseGitVirtualFileList(fileCount: number): boolean {
  return fileCount > GIT_PANEL_LARGE_CHANGE_COUNT;
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

export function buildCommitDraftFromStatus(status: GitStatusResponse): string {
  const files = [...status.staged, ...status.unstaged];
  const topFiles = Array.from(new Set(files.map((item) => item.path))).slice(0, 4);
  const headline = files.length > 0 ? "更新代码变更，完善当前分支功能实现。" : "更新代码。";
  const scopeLine = topFiles.length > 0 ? `涉及：${topFiles.join("、")}` : "涉及：无变更文件";
  const statLine = `统计：+${Math.max(0, status.additions || 0)} / -${Math.max(0, status.deletions || 0)}`;
  return [headline, scopeLine, statLine].join("\n");
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
