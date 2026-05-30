import { useEffect, type ReactNode } from "react";
import { startGitWatcher, stopGitWatcher } from "../../services/git";
import type { GitPanelRepositoryEntry } from "../../utils/workspaceRepositoryTreeSelect";
import { GitRepoSection } from "./GitRepoSection";
import type { GitPanelOpenFileOptions } from "./types";

interface Props {
  repositoryEntries: GitPanelRepositoryEntry[];
  /** 工作区名称等多仓上下文标题；缺省为「变更」。 */
  contextTitle?: string;
  headerPrefix?: ReactNode;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
}

export function GitMultiRepoPanel({
  repositoryEntries,
  contextTitle = "变更",
  headerPrefix,
  onOpenFile,
}: Props) {
  useEffect(() => {
    const paths = repositoryEntries.map((entry) => entry.path).filter(Boolean);
    if (paths.length === 0) return;
    void startGitWatcher(paths).catch(() => {});
    return () => {
      void stopGitWatcher().catch(() => {});
    };
  }, [repositoryEntries]);

  return (
    <div className="app-git-panel app-git-panel--multi">
      <div className="git-panel-header">
        {headerPrefix ? <div className="git-panel-header-prefix">{headerPrefix}</div> : null}
        <div className="git-panel-header-left">
          <span className="git-panel-title">{contextTitle}</span>
          <span className="git-panel-multi-count">{repositoryEntries.length} 个仓库</span>
        </div>
      </div>
      <div className="git-panel-multi-body">
        {repositoryEntries.map((entry) => (
          <GitRepoSection key={entry.path} entry={entry} onOpenFile={onOpenFile} />
        ))}
      </div>
    </div>
  );
}
