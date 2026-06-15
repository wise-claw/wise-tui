import type { ExplorerRevealTarget } from "./explorerRevealTarget";
import { explorerRevealMatchesTarget } from "./explorerRevealTarget";

export interface PendingExplorerReveal {
  repositoryPath: string;
  relativePath: string;
  isDirectory: boolean;
  revealTarget?: ExplorerRevealTarget;
}

const STORAGE_KEY = "wise/pending-explorer-reveal";

/** 文件树已挂载时由 `useRepositoryFilesExplorer` 监听，用于搜索/外链打开后即时展开定位。 */
export const WISE_EXPLORER_REVEAL_REQUESTED = "wise:explorer-reveal-requested";

export function writePendingExplorerReveal(pending: PendingExplorerReveal): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<PendingExplorerReveal>(WISE_EXPLORER_REVEAL_REQUESTED, { detail: pending }),
    );
  }
}

export function clearPendingExplorerReveal(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function consumePendingExplorerReveal(
  repositoryPath: string,
  ownRevealTarget?: ExplorerRevealTarget,
): PendingExplorerReveal | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PendingExplorerReveal>;
    const root = parsed.repositoryPath?.trim() ?? "";
    const relativePath = parsed.relativePath?.trim() ?? "";
    if (!root || !relativePath || root !== repositoryPath.trim()) {
      return null;
    }
    const pending: PendingExplorerReveal = {
      repositoryPath: root,
      relativePath,
      isDirectory: Boolean(parsed.isDirectory),
      revealTarget: parsed.revealTarget,
    };
    if (ownRevealTarget && !explorerRevealMatchesTarget(pending, ownRevealTarget)) {
      return null;
    }
    sessionStorage.removeItem(STORAGE_KEY);
    return pending;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}
