import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { safeUnlistenPromise } from "../../utils/safeTauriUnlisten";
import { startGitWatcher, stopGitWatcher } from "../../services/git";
import type { GitPanelRepositoryEntry } from "../../utils/workspaceRepositoryTreeSelect";
import {
  GIT_MULTI_REPO_LOAD_STAGGER_MS,
  GIT_MULTI_REPO_WATCHER_REFRESH_MS,
} from "./gitPanelUtils";
import { GitRepoSection } from "./GitRepoSection";
import { GitWorkspaceCommitPush } from "./GitWorkspaceCommitPush";
import type { GitPanelOpenFileOptions } from "./types";

interface Props {
  repositoryEntries: GitPanelRepositoryEntry[];
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
  const refreshByPathRef = useRef(new Map<string, () => void>());
  const watcherRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRefreshPathsRef = useRef(new Set<string>());

  useEffect(() => {
    const validPaths = new Set(repositoryEntries.map((entry) => entry.path).filter(Boolean));
    for (const path of [...refreshByPathRef.current.keys()]) {
      if (!validPaths.has(path)) {
        refreshByPathRef.current.delete(path);
      }
    }
  }, [repositoryEntries]);

  const registerRefresh = useCallback((path: string, refresh: () => void) => {
    refreshByPathRef.current.set(path, refresh);
    return () => {
      refreshByPathRef.current.delete(path);
    };
  }, []);

  const refreshAllRepositories = useCallback(() => {
    for (const refresh of refreshByPathRef.current.values()) {
      refresh();
    }
  }, []);

  useEffect(() => {
    const paths = repositoryEntries.map((entry) => entry.path).filter(Boolean);
    if (paths.length === 0) {
      void stopGitWatcher().catch(() => {});
      return;
    }
    void startGitWatcher(paths).catch(() => {});
    return () => {
      void stopGitWatcher().catch(() => {});
    };
  }, [repositoryEntries]);

  useEffect(() => {
    const unlisten = listen<{ path?: string }>("git-changed", (event) => {
      const changedPath = event.payload?.path?.trim();
      if (changedPath) {
        pendingRefreshPathsRef.current.add(changedPath);
      } else {
        for (const entry of repositoryEntries) {
          pendingRefreshPathsRef.current.add(entry.path);
        }
      }
      if (watcherRefreshTimerRef.current) {
        clearTimeout(watcherRefreshTimerRef.current);
      }
      watcherRefreshTimerRef.current = setTimeout(() => {
        watcherRefreshTimerRef.current = null;
        const paths = [...pendingRefreshPathsRef.current];
        pendingRefreshPathsRef.current.clear();
        for (const path of paths) {
          refreshByPathRef.current.get(path)?.();
        }
      }, GIT_MULTI_REPO_WATCHER_REFRESH_MS);
    });

    return () => {
      if (watcherRefreshTimerRef.current) {
        clearTimeout(watcherRefreshTimerRef.current);
        watcherRefreshTimerRef.current = null;
      }
      pendingRefreshPathsRef.current.clear();
      safeUnlistenPromise(unlisten);
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
        <div className="git-panel-header-right">
          <GitWorkspaceCommitPush
            repositoryEntries={repositoryEntries}
            onAfterSync={refreshAllRepositories}
          />
        </div>
      </div>
      <div className="git-panel-multi-body">
        {repositoryEntries.map((entry, index) => (
          <GitRepoSection
            key={entry.path}
            entry={entry}
            defaultExpanded={false}
            loadDelayMs={index * GIT_MULTI_REPO_LOAD_STAGGER_MS}
            registerRefresh={registerRefresh}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>
    </div>
  );
}
