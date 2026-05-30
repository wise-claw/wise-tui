import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { safeUnlistenPromise } from "../../utils/safeTauriUnlisten";
import { startGitWatcher, stopGitWatcher } from "../../services/git";
import type { GitPanelRepositoryEntry } from "../../utils/workspaceRepositoryTreeSelect";
import {
  GIT_MULTI_REPO_LOAD_STAGGER_MS,
  GIT_MULTI_REPO_WATCHER_REFRESH_MS,
  GIT_MULTI_REPO_WATCHER_RESTART_MS,
} from "./gitPanelUtils";
import { GitPanelWorkspaceSelector } from "./GitPanelWorkspaceSelector";
import { GitMultiRepoLazySection } from "./GitMultiRepoLazySection";
import { GitRepoSection } from "./GitRepoSection";
import { GitWorkspaceCommitPush } from "./GitWorkspaceCommitPush";
import type { GitPanelOpenFileOptions } from "./types";
import type { ProjectItem, Repository } from "../../types";
import type { WorkspaceFocus } from "../../utils/workspaceMode";

interface Props {
  repositoryEntries: GitPanelRepositoryEntry[];
  contextTitle?: string;
  headerPrefix?: ReactNode;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  projects?: ProjectItem[];
  repositories?: Repository[];
  activeProjectId?: string | null;
  activeRepositoryId?: number | null;
  activeWorkspaceFocus?: WorkspaceFocus;
  activeRepositoryPath?: string;
  onRepositorySelect?: (repositoryId: number) => void;
  onProjectSelect?: (projectId: string) => void;
  directoryOnly?: boolean;
  lazyMount?: boolean;
}

export function GitMultiRepoPanel({
  repositoryEntries,
  contextTitle = "变更",
  headerPrefix,
  onOpenFile,
  projects = [],
  repositories = [],
  activeProjectId = null,
  activeRepositoryId = null,
  activeWorkspaceFocus = "repository",
  activeRepositoryPath = "",
  onRepositorySelect,
  onProjectSelect,
  directoryOnly,
  lazyMount = true,
}: Props) {
  const refreshByPathRef = useRef(new Map<string, () => void>());
  const watchedPathsRef = useRef(new Set<string>());
  const [watchedPathsVersion, setWatchedPathsVersion] = useState(0);
  const watcherRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watcherRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const handleWatchScopeChange = useCallback((path: string, shouldWatch: boolean) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    const watched = watchedPathsRef.current;
    const had = watched.has(trimmed);
    if (shouldWatch) {
      if (had) return;
      watched.add(trimmed);
      setWatchedPathsVersion((version) => version + 1);
      return;
    }
    if (!had) return;
    watched.delete(trimmed);
    setWatchedPathsVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    const validPaths = new Set(repositoryEntries.map((entry) => entry.path).filter(Boolean));
    for (const path of [...watchedPathsRef.current]) {
      if (!validPaths.has(path)) {
        watchedPathsRef.current.delete(path);
      }
    }

    if (watcherRestartTimerRef.current) {
      clearTimeout(watcherRestartTimerRef.current);
    }

    watcherRestartTimerRef.current = setTimeout(() => {
      watcherRestartTimerRef.current = null;
      const paths = [...watchedPathsRef.current].filter((path) => validPaths.has(path));
      if (paths.length === 0) {
        void stopGitWatcher().catch(() => {});
        return;
      }
      void startGitWatcher(paths).catch(() => {});
    }, GIT_MULTI_REPO_WATCHER_RESTART_MS);

    return () => {
      if (watcherRestartTimerRef.current) {
        clearTimeout(watcherRestartTimerRef.current);
        watcherRestartTimerRef.current = null;
      }
      void stopGitWatcher().catch(() => {});
    };
  }, [repositoryEntries, watchedPathsVersion]);

  useEffect(() => {
    const unlisten = listen<{ path?: string }>("git-changed", (event) => {
      const changedPath = event.payload?.path?.trim();
      if (changedPath) {
        pendingRefreshPathsRef.current.add(changedPath);
      } else {
        for (const path of watchedPathsRef.current) {
          pendingRefreshPathsRef.current.add(path);
        }
      }
      if (watcherRefreshTimerRef.current) {
        clearTimeout(watcherRefreshTimerRef.current);
      }
      watcherRefreshTimerRef.current = setTimeout(() => {
        watcherRefreshTimerRef.current = null;
        const paths = [...pendingRefreshPathsRef.current];
        pendingRefreshPathsRef.current.clear();
        const watched = watchedPathsRef.current;
        for (const path of paths) {
          if (!watched.has(path)) continue;
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
  }, []);

  useEffect(
    () => () => {
      if (watcherRefreshTimerRef.current) {
        clearTimeout(watcherRefreshTimerRef.current);
        watcherRefreshTimerRef.current = null;
      }
      if (watcherRestartTimerRef.current) {
        clearTimeout(watcherRestartTimerRef.current);
        watcherRestartTimerRef.current = null;
      }
      pendingRefreshPathsRef.current.clear();
      refreshByPathRef.current.clear();
      watchedPathsRef.current.clear();
    },
    [],
  );

  return (
    <div className="app-git-panel app-git-panel--multi">
      <div className="git-panel-header">
        {headerPrefix ? <div className="git-panel-header-prefix">{headerPrefix}</div> : null}
        <div className="git-panel-header-left">
          {onRepositorySelect && activeRepositoryPath ? (
            <GitPanelWorkspaceSelector
              projects={projects}
              repositories={repositories}
              activeProjectId={activeProjectId}
              activeRepositoryId={activeRepositoryId}
              activeWorkspaceFocus={activeWorkspaceFocus}
              activeRepositoryPath={activeRepositoryPath}
              onRepositorySelect={onRepositorySelect}
              onProjectSelect={onProjectSelect}
              directoryOnly={directoryOnly}
            />
          ) : (
            <span className="git-panel-title">{contextTitle}</span>
          )}
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
        {repositoryEntries.map((entry, index) => {
          const sectionProps = {
            entry,
            defaultExpanded: !lazyMount,
            loadDelayMs: lazyMount ? index * GIT_MULTI_REPO_LOAD_STAGGER_MS : 0,
            registerRefresh,
            onWatchScopeChange: handleWatchScopeChange,
            onOpenFile,
          };
          if (lazyMount) {
            return <GitMultiRepoLazySection key={entry.path} {...sectionProps} />;
          }
          return (
            <GitRepoSection
              key={entry.path}
              {...sectionProps}
              externalInView
            />
          );
        })}
      </div>
    </div>
  );
}
