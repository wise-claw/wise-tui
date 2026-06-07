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
};

export interface FileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileTreeNode[];
  file?: GitFileStatus;
  additions: number;
  deletions: number;
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
