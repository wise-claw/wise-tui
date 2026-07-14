import { invoke } from "@tauri-apps/api/core";
import { trackAsyncOperation } from "../stores/operationWatchdogStore";
import {
  REPO_EXPLORER_LIST_TIMEOUT_MS,
  REPO_EXPLORER_SEARCH_TIMEOUT_MS,
  REPO_FILE_MUTATION_TIMEOUT_MS,
} from "../utils/ipcTimeouts";

export interface RepositoryExplorerEntry {
  path: string;
  isDir: boolean;
}

export interface RepositoryFileContentMatch {
  path: string;
  line: number;
  preview: string;
  /** 匹配区间在 preview 中的起始 char 偏移（与 code point 切分一致），无匹配时缺省。 */
  matchStart?: number | null;
  /** 匹配区间在 preview 中的结束 char 偏移（exclusive），无匹配时缺省。 */
  matchEnd?: number | null;
}

/**
 * Fast file/directory search under a repository root (for @ mentions and explorer search).
 *
 * `relativeDir` 为仓库相对目录，限定搜索范围；省略/空串表示整个仓库。
 */
export async function searchRepositoryFiles(
  repositoryRoot: string,
  query: string,
  relativeDir?: string,
): Promise<RepositoryExplorerEntry[]> {
  try {
    return await trackAsyncOperation(
      "搜索仓库文件",
      invoke<RepositoryExplorerEntry[]>("search_repository_files", {
        root: repositoryRoot,
        query,
        relativeDir: relativeDir ? relativeDir : null,
      }),
      REPO_EXPLORER_SEARCH_TIMEOUT_MS,
    );
  } catch {
    return [];
  }
}

/**
 * Search plain-text file contents under a repository root (global search).
 *
 * `relativeDir` 为仓库相对目录，限定搜索范围；省略/空串表示整个仓库。
 */
export async function searchRepositoryFileContents(
  repositoryRoot: string,
  query: string,
  relativeDir?: string,
): Promise<RepositoryFileContentMatch[]> {
  try {
    return await trackAsyncOperation(
      "搜索仓库内容",
      invoke<RepositoryFileContentMatch[]>("search_repository_file_contents", {
        root: repositoryRoot,
        query,
        relativeDir: relativeDir ? relativeDir : null,
      }),
      REPO_EXPLORER_SEARCH_TIMEOUT_MS,
    );
  } catch {
    return [];
  }
}

/**
 * List files and directories (including empty folders) for the file explorer tree.
 */
export async function listRepositoryExplorerEntries(
  repositoryRoot: string,
): Promise<RepositoryExplorerEntry[]> {
  return trackAsyncOperation(
    "列出仓库文件",
    invoke<RepositoryExplorerEntry[]>("list_repository_explorer_entries", {
      root: repositoryRoot,
    }),
    REPO_EXPLORER_LIST_TIMEOUT_MS,
  );
}

/** List one directory level for lazy file-tree expansion (`relativeDir` empty = repo root). */
export async function listRepositoryExplorerChildren(
  repositoryRoot: string,
  relativeDir = "",
): Promise<RepositoryExplorerEntry[]> {
  return trackAsyncOperation(
    "加载目录",
    invoke<RepositoryExplorerEntry[]>("list_repository_explorer_children", {
      root: repositoryRoot,
      relativeDir,
    }),
    REPO_EXPLORER_LIST_TIMEOUT_MS,
  );
}

/**
 * Create an empty file at a path relative to the repository root.
 */
export async function createRepositoryFile(
  repositoryRoot: string,
  relativePath: string,
): Promise<void> {
  await trackAsyncOperation(
    "创建文件",
    invoke<void>("create_repository_file", {
      root: repositoryRoot,
      relativePath,
    }),
    REPO_FILE_MUTATION_TIMEOUT_MS,
  );
}

/**
 * Create a directory at a path relative to the repository root.
 */
export async function createRepositoryDirectory(
  repositoryRoot: string,
  relativePath: string,
): Promise<void> {
  await trackAsyncOperation(
    "创建目录",
    invoke<void>("create_repository_directory", {
      root: repositoryRoot,
      relativePath,
    }),
    REPO_FILE_MUTATION_TIMEOUT_MS,
  );
}

/**
 * Delete a file or directory (recursive for directories) relative to the repository root.
 */
export async function deleteRepositoryEntry(
  repositoryRoot: string,
  relativePath: string,
): Promise<void> {
  await trackAsyncOperation(
    "删除路径",
    invoke<void>("delete_repository_entry", {
      root: repositoryRoot,
      relativePath,
    }),
    REPO_FILE_MUTATION_TIMEOUT_MS,
  );
}

/**
 * Rename or move a file or directory within the repository root.
 *
 * Both paths must be relative to `repositoryRoot`. The destination parent
 * directory must already exist (rename does not auto-create parents); the
 * destination itself must NOT exist. Cross-directory renames are allowed.
 */
export async function renameRepositoryEntry(
  repositoryRoot: string,
  oldRelativePath: string,
  newRelativePath: string,
): Promise<void> {
  await trackAsyncOperation(
    "重命名路径",
    invoke<void>("rename_repository_entry", {
      root: repositoryRoot,
      oldRelativePath,
      newRelativePath,
    }),
    REPO_FILE_MUTATION_TIMEOUT_MS,
  );
}
