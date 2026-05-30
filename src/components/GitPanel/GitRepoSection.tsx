import { memo, startTransition, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useInView, useInViewActive } from "../../hooks/useInView";
import { listen } from "@tauri-apps/api/event";
import { safeUnlistenPromise } from "../../utils/safeTauriUnlisten";
import { Button, Empty, Spin, Tooltip, message } from "antd";
import { DownOutlined, GlobalOutlined, RightOutlined } from "@ant-design/icons";
import {
  gitCommit,
  gitDiscard,
  gitDiscardAll,
  gitFetch,
  gitInit,
  gitPull,
  gitPush,
  gitStage,
  gitStagePaths,
  gitStageAll,
  gitStatus,
  gitStatusSummary,
  gitUnstage,
  gitUnstageAll,
} from "../../services/git";
import { openRepositoryRemoteInBrowser } from "../../services/openRepositoryRemote";
import type { GitStatusResponse } from "../../types";
import { DiffMode } from "./DiffMode";
import { GitSyncActions } from "./GitSyncActions";
import { InitMode } from "./InitMode";
import {
  GIT_WATCHER_REFRESH_MS,
  gitStatusHeaderSnapshotEqual,
  gitStatusSnapshotEqual,
  hasUnstagedFilesUnderDirectory,
  type GitStatusHeaderSnapshot,
} from "./gitPanelUtils";
import type { GitPanelOpenFileOptions } from "./types";

export interface GitRepoSectionEntry {
  repositoryId: number;
  path: string;
  name: string;
}

interface Props {
  entry: GitRepoSectionEntry;
  defaultExpanded?: boolean;
  /** 多仓模式下错峰加载 header 状态，展开时立即加载。 */
  loadDelayMs?: number;
  /** 多仓面板统一注册 watcher 刷新，避免每仓独立监听。 */
  registerRefresh?: (path: string, refresh: () => void) => () => void;
  /** 多仓面板按可见/展开范围注册 file watcher。 */
  onWatchScopeChange?: (path: string, shouldWatch: boolean) => void;
  /** 多仓面板展开状态变更回调（用于按需加载 diff 详情）。 */
  onExpandedChange?: (path: string, expanded: boolean) => void;
  /** 多仓 lazy 容器注入的视口状态，避免重复 IntersectionObserver。 */
  externalInView?: boolean;
  externalSectionRef?: RefObject<HTMLElement | null>;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
}

function formatBranchLabel(
  status: GitStatusResponse | null,
  header: GitStatusHeaderSnapshot | null,
): string {
  const branch = status?.branch?.trim() ?? header?.branch?.trim();
  if (!branch) return "Git";
  const stagedLen = status?.staged.length ?? header?.stagedCount ?? 0;
  const unstagedLen = status?.unstaged.length ?? header?.unstagedCount ?? 0;
  const dirty = stagedLen > 0 || unstagedLen > 0;
  const ahead = status?.ahead ?? header?.ahead ?? 0;
  const behind = status?.behind ?? header?.behind ?? 0;
  let suffix = "";
  if (dirty) suffix += "*";
  if (ahead > 0 || behind > 0) suffix += "+";
  return `${branch}${suffix}`;
}

function GitRepoSectionInner({
  entry,
  defaultExpanded = true,
  loadDelayMs = 0,
  registerRefresh,
  onWatchScopeChange,
  onExpandedChange,
  externalInView,
  externalSectionRef,
  onOpenFile,
}: Props) {
  const repositoryPath = entry.path;
  const isMultiRepo = Boolean(registerRefresh);
  const useExternalInView = externalInView !== undefined;
  const [sectionRefSticky, inViewSticky] = useInView("160px", !isMultiRepo && !useExternalInView);
  const [sectionRefActive, inViewActive] = useInViewActive("160px", isMultiRepo && !useExternalInView);
  const sectionRef = externalSectionRef ?? (isMultiRepo ? sectionRefActive : sectionRefSticky);
  const inView = useExternalInView ? externalInView : isMultiRepo ? inViewActive : inViewSticky;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const shouldLoadHeader = expanded || inView;
  const [status, setStatus] = useState<GitStatusResponse | null>(null);
  const [headerSnapshot, setHeaderSnapshot] = useState<GitStatusHeaderSnapshot | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [openingRemote, setOpeningRemote] = useState(false);
  const [loading, setLoading] = useState<Record<string, boolean>>({
    status: false,
    stage: false,
    unstage: false,
    commit: false,
    push: false,
    pull: false,
    fetch: false,
    discard: false,
    stageAll: false,
    unstageAll: false,
    discardAll: false,
    init: false,
  });

  const statusRef = useRef<GitStatusResponse | null>(null);
  const headerSnapshotRef = useRef<GitStatusHeaderSnapshot | null>(null);
  const runningActions = useRef(new Set<string>());
  const lastActionTime = useRef(new Map<string, number>());
  const watcherRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncOpsInFlightRef = useRef(0);
  const pendingSilentRefreshRef = useRef(false);
  const loadRequestIdRef = useRef(0);
  const shouldLoadHeaderRef = useRef(shouldLoadHeader);
  shouldLoadHeaderRef.current = shouldLoadHeader;
  const silentRefreshRef = useRef<() => void>(() => {});
  const mountedRef = useRef(true);
  const DEBOUNCE_MS = 400;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRequestIdRef.current += 1;
    };
  }, [repositoryPath]);

  const loadStatus = useCallback(async (opts?: { silent?: boolean }) => {
    if (!repositoryPath) return;
    const silent = opts?.silent ?? false;
    const requestId = ++loadRequestIdRef.current;
    if (!silent) {
      setLoading((prev) => ({ ...prev, status: true }));
    }
    try {
      const result = await gitStatus(repositoryPath);
      if (requestId !== loadRequestIdRef.current || !mountedRef.current) return;
      const apply = () => {
        if (!mountedRef.current) return;
        if (gitStatusSnapshotEqual(statusRef.current, result)) {
          return;
        }
        statusRef.current = result;
        setStatus(result);
        setErrors((prev) => {
          if (!prev.status) return prev;
          const next = { ...prev };
          delete next.status;
          return next;
        });
      };
      if (silent) {
        startTransition(apply);
      } else {
        apply();
      }
    } catch (e) {
      if (requestId !== loadRequestIdRef.current || !mountedRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      const applyErr = () => {
        if (!mountedRef.current) return;
        statusRef.current = null;
        setErrors((prev) => ({ ...prev, status: msg }));
        setStatus(null);
      };
      if (silent) {
        startTransition(applyErr);
      } else {
        applyErr();
      }
    } finally {
      if (requestId === loadRequestIdRef.current && !silent && mountedRef.current) {
        setLoading((prev) => ({ ...prev, status: false }));
      }
    }
  }, [repositoryPath]);

  const loadSummary = useCallback(async (opts?: { silent?: boolean }) => {
    if (!repositoryPath) return;
    const silent = opts?.silent ?? false;
    const requestId = ++loadRequestIdRef.current;
    if (!silent) {
      setLoading((prev) => ({ ...prev, status: true }));
    }
    try {
      const result = await gitStatusSummary(repositoryPath);
      if (requestId !== loadRequestIdRef.current || !mountedRef.current) return;
      const snapshot: GitStatusHeaderSnapshot = {
        branch: result.branch,
        ahead: result.ahead,
        behind: result.behind,
        stagedCount: result.stagedCount,
        unstagedCount: result.unstagedCount,
      };
      const apply = () => {
        if (!mountedRef.current) return;
        if (gitStatusHeaderSnapshotEqual(headerSnapshotRef.current, snapshot)) {
          return;
        }
        headerSnapshotRef.current = snapshot;
        setHeaderSnapshot(snapshot);
        setErrors((prev) => {
          if (!prev.status) return prev;
          const next = { ...prev };
          delete next.status;
          return next;
        });
      };
      if (silent) {
        startTransition(apply);
      } else {
        apply();
      }
    } catch (e) {
      if (requestId !== loadRequestIdRef.current || !mountedRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      const applyErr = () => {
        if (!mountedRef.current) return;
        headerSnapshotRef.current = null;
        setErrors((prev) => ({ ...prev, status: msg }));
        setHeaderSnapshot(null);
      };
      if (silent) {
        startTransition(applyErr);
      } else {
        applyErr();
      }
    } finally {
      if (requestId === loadRequestIdRef.current && !silent && mountedRef.current) {
        setLoading((prev) => ({ ...prev, status: false }));
      }
    }
  }, [repositoryPath]);

  const silentRefresh = useCallback(() => {
    if (!shouldLoadHeaderRef.current) return;
    if (syncOpsInFlightRef.current > 0) {
      pendingSilentRefreshRef.current = true;
      return;
    }
    if (expanded) {
      void loadStatus({ silent: true });
      return;
    }
    if (isMultiRepo) {
      void loadSummary({ silent: true });
      return;
    }
    void loadStatus({ silent: true });
  }, [expanded, isMultiRepo, loadStatus, loadSummary]);

  silentRefreshRef.current = silentRefresh;

  const silentRefreshForRegistry = useCallback(() => {
    silentRefreshRef.current();
  }, []);

  const beginGitSyncOperation = useCallback(() => {
    syncOpsInFlightRef.current += 1;
  }, []);

  const endGitSyncOperation = useCallback(() => {
    syncOpsInFlightRef.current = Math.max(0, syncOpsInFlightRef.current - 1);
    if (syncOpsInFlightRef.current === 0 && pendingSilentRefreshRef.current) {
      pendingSilentRefreshRef.current = false;
      void loadStatus({ silent: true });
    }
  }, [loadStatus]);

  useEffect(() => {
    statusRef.current = null;
    headerSnapshotRef.current = null;
    setStatus(null);
    setHeaderSnapshot(null);
  }, [repositoryPath]);

  useEffect(() => {
    if (!shouldLoadHeader) return;
    if (expanded) {
      if (statusRef.current) return;
    } else if (isMultiRepo) {
      if (headerSnapshotRef.current) return;
    } else if (statusRef.current) {
      return;
    }
    let cancelled = false;
    const delay = expanded ? 0 : loadDelayMs;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      if (expanded || !isMultiRepo) {
        void loadStatus({ silent: delay > 0 });
      } else {
        void loadSummary({ silent: delay > 0 });
      }
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [shouldLoadHeader, expanded, isMultiRepo, loadDelayMs, loadStatus, loadSummary]);

  useEffect(() => {
    if (shouldLoadHeader) return;
    loadRequestIdRef.current += 1;
    statusRef.current = null;
    headerSnapshotRef.current = null;
    setStatus(null);
    setHeaderSnapshot(null);
    setErrors({});
  }, [shouldLoadHeader]);

  useEffect(() => {
    if (!isMultiRepo || !expanded || inView) return;
    setExpanded(false);
    onExpandedChange?.(repositoryPath, false);
  }, [isMultiRepo, expanded, inView, onExpandedChange, repositoryPath]);

  useEffect(() => {
    if (!onWatchScopeChange) return;
    onWatchScopeChange(repositoryPath, shouldLoadHeader);
    return () => {
      onWatchScopeChange(repositoryPath, false);
    };
  }, [onWatchScopeChange, repositoryPath, shouldLoadHeader]);

  useEffect(() => {
    if (expanded) return;
    if (!statusRef.current) return;
    const current = statusRef.current;
    const snapshot: GitStatusHeaderSnapshot = {
      branch: current.branch,
      ahead: current.ahead,
      behind: current.behind,
      stagedCount: current.staged.length,
      unstagedCount: current.unstaged.length,
    };
    headerSnapshotRef.current = snapshot;
    setHeaderSnapshot(snapshot);
    statusRef.current = null;
    setStatus(null);
  }, [expanded]);

  useEffect(() => {
    if (registerRefresh) {
      return registerRefresh(repositoryPath, silentRefreshForRegistry);
    }

    const unlisten = listen<{ path?: string }>("git-changed", (event) => {
      const changedPath = event.payload?.path?.trim();
      if (changedPath && changedPath !== repositoryPath) return;
      if (syncOpsInFlightRef.current > 0) {
        pendingSilentRefreshRef.current = true;
        return;
      }
      if (watcherRefreshTimer.current) {
        clearTimeout(watcherRefreshTimer.current);
      }
      watcherRefreshTimer.current = setTimeout(() => {
        watcherRefreshTimer.current = null;
        if (syncOpsInFlightRef.current > 0) {
          pendingSilentRefreshRef.current = true;
          return;
        }
        void loadStatus({ silent: true });
      }, GIT_WATCHER_REFRESH_MS);
    });

    return () => {
      if (watcherRefreshTimer.current) {
        clearTimeout(watcherRefreshTimer.current);
        watcherRefreshTimer.current = null;
      }
      safeUnlistenPromise(unlisten);
    };
  }, [loadStatus, registerRefresh, repositoryPath, silentRefreshForRegistry]);

  const runAction = useCallback(
    async (action: string, fn: () => Promise<void>) => {
      const now = Date.now();
      const lastTime = lastActionTime.current.get(action) || 0;
      if (action !== "commit" && now - lastTime < DEBOUNCE_MS) return;
      if (runningActions.current.has(action)) return;

      runningActions.current.add(action);
      lastActionTime.current.set(action, now);
      setLoading((prev) => ({ ...prev, [action]: true }));

      const tracksSync = action === "commit" || action === "fetch";
      if (tracksSync) beginGitSyncOperation();

      try {
        await fn();
        await loadStatus({ silent: true });
        setErrors((prev) => {
          if (!prev[action]) return prev;
          const next = { ...prev };
          delete next[action];
          return next;
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setErrors((prev) => ({ ...prev, [action]: msg }));
      } finally {
        if (tracksSync) endGitSyncOperation();
        runningActions.current.delete(action);
        setLoading((prev) => ({ ...prev, [action]: false }));
      }
    },
    [beginGitSyncOperation, endGitSyncOperation, loadStatus],
  );

  const handleStage = useCallback(
    (filePath: string) =>
      void runAction("stage", async () => {
        if (!repositoryPath) return;
        if (status && hasUnstagedFilesUnderDirectory(status.unstaged, filePath)) {
          await gitStagePaths(repositoryPath, [filePath]);
          return;
        }
        await gitStage(repositoryPath, filePath);
      }),
    [repositoryPath, status, runAction],
  );

  const handleUnstage = useCallback(
    (filePath: string) => runAction("unstage", () => gitUnstage(repositoryPath!, filePath)),
    [repositoryPath, runAction],
  );

  const handleDiscard = useCallback(
    (filePath: string) => runAction("discard", () => gitDiscard(repositoryPath!, filePath)),
    [repositoryPath, runAction],
  );

  const handleStageAll = useCallback(() => {
    void runAction("stageAll", async () => {
      if (!repositoryPath) return;
      await gitStageAll(repositoryPath);
    });
  }, [repositoryPath, runAction]);

  const handleUnstageAll = useCallback(() => {
    void runAction("unstageAll", async () => {
      if (!repositoryPath) return;
      await gitUnstageAll(repositoryPath);
    });
  }, [repositoryPath, runAction]);

  const handleDiscardAll = useCallback(
    () =>
      void runAction("discardAll", async () => {
        if (!repositoryPath) return;
        await gitDiscardAll(repositoryPath);
      }),
    [repositoryPath, runAction],
  );

  const handleCommit = useCallback(
    (msg: string) =>
      void runAction("commit", async () => {
        if (!repositoryPath) return;
        const trimmed = msg.trim();
        if (!trimmed) return;
        let latest = await gitStatus(repositoryPath);
        if (latest.staged.length === 0 && latest.unstaged.length > 0) {
          await gitStageAll(repositoryPath);
          latest = await gitStatus(repositoryPath);
        }
        if (latest.staged.length === 0) {
          throw new Error("没有可提交的改动");
        }
        await gitCommit(repositoryPath, trimmed);
      }),
    [repositoryPath, runAction],
  );

  const handlePush = useCallback(async () => {
    if (runningActions.current.has("push")) return;
    runningActions.current.add("push");
    setLoading((prev) => ({ ...prev, push: true }));
    beginGitSyncOperation();
    try {
      await gitPush(repositoryPath!);
      await loadStatus({ silent: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(`推送失败: ${msg}`);
    } finally {
      endGitSyncOperation();
      runningActions.current.delete("push");
      setLoading((prev) => ({ ...prev, push: false }));
    }
  }, [beginGitSyncOperation, endGitSyncOperation, repositoryPath, loadStatus]);

  const handlePull = useCallback(async () => {
    if (runningActions.current.has("pull")) return;
    runningActions.current.add("pull");
    setLoading((prev) => ({ ...prev, pull: true }));
    beginGitSyncOperation();
    try {
      await gitPull(repositoryPath!);
      await loadStatus({ silent: true });
      message.success("拉取成功");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(`拉取失败: ${msg}`);
    } finally {
      endGitSyncOperation();
      runningActions.current.delete("pull");
      setLoading((prev) => ({ ...prev, pull: false }));
    }
  }, [beginGitSyncOperation, endGitSyncOperation, repositoryPath, loadStatus]);

  const handleFetch = useCallback(
    () => void runAction("fetch", () => gitFetch(repositoryPath!)),
    [repositoryPath, runAction],
  );

  const handleInit = useCallback(() => {
    void runAction("init", async () => {
      if (!repositoryPath) return;
      await gitInit(repositoryPath);
    });
  }, [repositoryPath, runAction]);

  const handleOpenRemoteInBrowser = useCallback(() => {
    if (!repositoryPath || openingRemote) return;
    setOpeningRemote(true);
    void openRepositoryRemoteInBrowser(repositoryPath)
      .then((result) => {
        if (!result.ok) {
          message.warning(result.message);
        }
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        message.error(`打开失败: ${msg}`);
      })
      .finally(() => {
        setOpeningRemote(false);
      });
  }, [openingRemote, repositoryPath]);

  const isMissingRepo = errors.status?.includes("Failed to open git repo");
  const changeCount =
    (status?.staged.length ?? headerSnapshot?.stagedCount ?? 0) +
    (status?.unstaged.length ?? headerSnapshot?.unstagedCount ?? 0);
  const syncStatus: GitStatusResponse | null =
    status ??
    (headerSnapshot
      ? {
          branch: headerSnapshot.branch,
          ahead: headerSnapshot.ahead,
          behind: headerSnapshot.behind,
          additions: 0,
          deletions: 0,
          upstream: null,
          staged: [],
          unstaged: [],
        }
      : null);

  return (
    <section
      ref={sectionRef}
      className={`git-repo-section${expanded ? " git-repo-section--expanded" : ""}`}
      data-repository-path={repositoryPath}
    >
      <div className="git-repo-section__header">
        <button
          type="button"
          className="git-repo-section__toggle"
          aria-expanded={expanded}
          aria-label={`${entry.name} ${formatBranchLabel(status, headerSnapshot)}`}
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            onExpandedChange?.(repositoryPath, next);
          }}
        >
          <span className="git-repo-section__chevron" aria-hidden>
            {expanded ? <DownOutlined /> : <RightOutlined />}
          </span>
          <span className="git-repo-section__name" title={entry.name}>
            {entry.name}
          </span>
          <span className="git-repo-section__branch">{formatBranchLabel(status, headerSnapshot)}</span>
          {changeCount > 0 ? (
            <span className="git-repo-section__change-count">{changeCount}</span>
          ) : null}
        </button>
        <div className="git-repo-section__actions">
          <Tooltip title="在浏览器中打开仓库" placement="top">
            <Button
              type="text"
              size="small"
              className="git-remote-browser-btn"
              icon={<GlobalOutlined />}
              aria-label="在浏览器中打开仓库"
              loading={openingRemote}
              onClick={handleOpenRemoteInBrowser}
            />
          </Tooltip>
          {syncStatus ? (
            <GitSyncActions
              status={syncStatus}
              loading={loading}
              hideStagedCount
              onFetch={handleFetch}
              onPull={() => void handlePull()}
              onPush={() => void handlePush()}
            />
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div className="git-repo-section__body">
          {loading.status && !status && !isMissingRepo ? (
            <div style={{ padding: 16, textAlign: "center" }}>
              <Spin size="small" description="加载中..." />
            </div>
          ) : isMissingRepo ? (
            <InitMode onInit={handleInit} loading={loading.init} />
          ) : errors.status && !status ? (
            <Empty
              description={`Git 状态加载失败：${errors.status}`}
              style={{ padding: "16px 0" }}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            status && (
              <DiffMode
                repositoryPath={repositoryPath}
                status={status}
                loading={loading}
                errors={errors}
                onStage={handleStage}
                onUnstage={handleUnstage}
                onDiscard={handleDiscard}
                onStageAll={handleStageAll}
                onUnstageAll={handleUnstageAll}
                onDiscardAll={handleDiscardAll}
                onCommit={handleCommit}
                onOpenFile={onOpenFile}
              />
            )
          )}
        </div>
      ) : null}
    </section>
  );
}

export const GitRepoSection = memo(GitRepoSectionInner);
