import type { GitFileStatus } from "../../types";

/** Passed when opening a file from the Git changes list so the editor can show the built-in diff. */
export type GitPanelOpenFileOptions = { fromGitChanges: "staged" | "unstaged" };

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
