import type { GitFileStatus } from "../../types";

/** Passed when opening a file from the Git changes list so the editor can show the built-in diff. */
export type GitPanelOpenFileOptions = {
  fromGitChanges?: "staged" | "unstaged";
  fromCommit?: { sha: string };
  fromCommitCompare?: { baseSha: string; headSha: string };
  line?: number | null;
  /** Absolute root for read/write; defaults to hook `repositoryPath` (active repo). */
  fileRootPath?: string;
  /** 来自侧栏文件树点击；配合默认配置决定是否新开一屏。 */
  fromFileTree?: boolean;
  /** 入口指定编辑器宿主（左栏为第一屏，本屏文件树为所在屏），优先于新屏偏好。 */
  targetPaneIndex?: number;
};

export interface FileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileTreeNode[];
  file?: GitFileStatus;
  additions: number;
  deletions: number;
  fileCount: number;
  status: string;
}

export type UnstagedViewMode = "tree" | "list";

export interface RepositoryFileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: RepositoryFileTreeNode[];
}

export interface ExplorerContextMenuState {
  x: number;
  y: number;
  path: string;
  isDir: boolean;
}

export interface ExplorerInlineCreateState {
  type: "file" | "folder";
  parentDir: string;
  value: string;
}

/**
 * 行内重命名状态。被替换的原节点以 `path` 标识，新值用 `value` 缓冲（提交时再回写后端）。
 * `originalName` 始终是后端的初始名，供提交时构造目标相对路径。
 */
export interface ExplorerInlineRenameState {
  path: string;
  isDir: boolean;
  originalName: string;
  value: string;
}
