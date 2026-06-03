import type { RepositoryExplorerEntry } from "../../services/repositoryFiles";

/** Canonical map key / IPC `relativeDir` for lazy explorer loads (`""` = repository root). */
export function explorerDirKey(dirPath: string): string {
  return dirPath.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Normalize IPC listing paths so map keys match tree node paths. */
export function normalizeExplorerEntries(entries: RepositoryExplorerEntry[]): RepositoryExplorerEntry[] {
  return entries.map((entry) => ({
    path: explorerDirKey(entry.path),
    isDir: entry.isDir,
  }));
}

export function explorerParentDir(dirPath: string): string {
  const key = explorerDirKey(dirPath);
  const slash = key.lastIndexOf("/");
  return slash >= 0 ? key.slice(0, slash) : "";
}
