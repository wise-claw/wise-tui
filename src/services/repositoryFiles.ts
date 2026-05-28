import { invoke } from "@tauri-apps/api/core";

export interface RepositoryExplorerEntry {
  path: string;
  isDir: boolean;
}

/**
 * Fast file search under a repository root (for @ mentions).
 */
export async function searchRepositoryFiles(
  repositoryRoot: string,
  query: string,
): Promise<string[]> {
  try {
    return await invoke<string[]>("search_repository_files", {
      root: repositoryRoot,
      query,
    });
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
  return invoke<RepositoryExplorerEntry[]>("list_repository_explorer_entries", {
    root: repositoryRoot,
  });
}

/**
 * Create an empty file at a path relative to the repository root.
 */
export async function createRepositoryFile(
  repositoryRoot: string,
  relativePath: string,
): Promise<void> {
  await invoke<void>("create_repository_file", {
    root: repositoryRoot,
    relativePath,
  });
}

/**
 * Create a directory at a path relative to the repository root.
 */
export async function createRepositoryDirectory(
  repositoryRoot: string,
  relativePath: string,
): Promise<void> {
  await invoke<void>("create_repository_directory", {
    root: repositoryRoot,
    relativePath,
  });
}

/**
 * Delete a file or directory (recursive for directories) relative to the repository root.
 */
export async function deleteRepositoryEntry(
  repositoryRoot: string,
  relativePath: string,
): Promise<void> {
  await invoke<void>("delete_repository_entry", {
    root: repositoryRoot,
    relativePath,
  });
}
