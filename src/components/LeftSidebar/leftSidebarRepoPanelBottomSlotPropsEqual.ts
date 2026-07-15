import type { GitPanelRepositoryEntry } from "../../utils/workspaceRepositoryTreeSelect";

export type LeftSidebarRepoPanelBottomSlotEqualProps = {
  effectiveRepoPanelPath: string;
  repoPanelRepositoryName: string;
  repositoryFileTreeSearch: string;
  workspaceListEffectivelyCollapsed: boolean;
  leftBottomTab: "git" | "files";
  bottomTabPanelsReady: boolean;
  showGitOnLeft: boolean;
  showFilesOnLeft: boolean;
  gitPanelRepositoryEntries: GitPanelRepositoryEntry[];
};

function repositoryEntriesFingerprint(entries: GitPanelRepositoryEntry[]): string {
  if (entries.length === 0) return "";
  return entries
    .map((entry) => `${entry.repositoryId}:${entry.path}:${entry.name}`)
    .join("|");
}

/** 左下 Git/文件树 slot：会话切换但目录未变时跳过重渲染。 */
export function leftSidebarRepoPanelBottomSlotPropsEqual(
  prev: LeftSidebarRepoPanelBottomSlotEqualProps,
  next: LeftSidebarRepoPanelBottomSlotEqualProps,
): boolean {
  if (prev === next) return true;
  if (prev.effectiveRepoPanelPath !== next.effectiveRepoPanelPath) return false;
  if (prev.repoPanelRepositoryName !== next.repoPanelRepositoryName) return false;
  if (prev.repositoryFileTreeSearch !== next.repositoryFileTreeSearch) return false;
  if (prev.workspaceListEffectivelyCollapsed !== next.workspaceListEffectivelyCollapsed) return false;
  if (prev.leftBottomTab !== next.leftBottomTab) return false;
  if (prev.bottomTabPanelsReady !== next.bottomTabPanelsReady) return false;
  if (prev.showGitOnLeft !== next.showGitOnLeft) return false;
  if (prev.showFilesOnLeft !== next.showFilesOnLeft) return false;
  if (
    repositoryEntriesFingerprint(prev.gitPanelRepositoryEntries) !==
    repositoryEntriesFingerprint(next.gitPanelRepositoryEntries)
  ) {
    return false;
  }
  return true;
}
