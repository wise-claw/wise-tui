export interface PendingExplorerReveal {
  repositoryPath: string;
  relativePath: string;
  isDirectory: boolean;
}

const STORAGE_KEY = "wise/pending-explorer-reveal";

export function writePendingExplorerReveal(pending: PendingExplorerReveal): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
}

export function consumePendingExplorerReveal(repositoryPath: string): PendingExplorerReveal | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }
  sessionStorage.removeItem(STORAGE_KEY);
  try {
    const parsed = JSON.parse(raw) as Partial<PendingExplorerReveal>;
    const root = parsed.repositoryPath?.trim() ?? "";
    const relativePath = parsed.relativePath?.trim() ?? "";
    if (!root || !relativePath || root !== repositoryPath.trim()) {
      return null;
    }
    return {
      repositoryPath: root,
      relativePath,
      isDirectory: Boolean(parsed.isDirectory),
    };
  } catch {
    return null;
  }
}
