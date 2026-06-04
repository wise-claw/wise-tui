import { startTransition, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { safeUnlistenPromise } from "../../utils/safeTauriUnlisten";
import { runWhenIdle } from "../../utils/deferIdle";
import { Button, Empty, Spin, Tooltip, message } from "antd";
import { GlobalOutlined } from "@ant-design/icons";
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
  gitUnstage,
  gitUnstageAll,
  startGitWatcher,
  stopGitWatcher,
} from "../../services/git";
import { openRepositoryRemoteInBrowser } from "../../services/openRepositoryRemote";
import type { GitStatusResponse } from "../../types";
import { runGitSyncAction, type GitSyncActionKind } from "./gitSyncActionRunner";
import { DiffMode } from "./DiffMode";
import { GitSyncActions } from "./GitSyncActions";
import { InitMode } from "./InitMode";
import { hasUnstagedFilesUnderDirectory, GIT_WATCHER_REFRESH_MS, gitStatusSnapshotEqual } from "./gitPanelUtils";
import { GitMultiRepoPanel } from "./GitMultiRepoPanel";
import type { GitPanelRepositoryEntry } from "../../utils/workspaceRepositoryTreeSelect";
import { GitPanelWorkspaceSelector } from "./GitPanelWorkspaceSelector";
import type { ProjectItem, Repository } from "../../types";
import type { WorkspaceFocus } from "../../utils/workspaceMode";
import type { GitPanelOpenFileOptions } from "./types";
import "./index.css";

export { RepositoryFilesExplorer } from "./RepositoryFilesExplorer";
export type { GitPanelOpenFileOptions } from "./types";

interface Props {
  repositoryPath: string | undefined;
  repositoryName: string | undefined;
  /** 多仓库模式：一次展示工作区内全部 Git 仓库（≥2 时启用）。 */
  repositoryEntries?: GitPanelRepositoryEntry[];
  /** 多仓库模式标题（通常为工作区名）。 */
  multiRepoContextTitle?: string;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  /** 左栏整合头部：Tab 切换等，渲染在上下文选择器左侧 */
  headerPrefix?: ReactNode;
  projects?: ProjectItem[];
  repositories?: Repository[];
  activeProjectId?: string | null;
  activeRepositoryId?: number | null;
  activeWorkspaceFocus?: WorkspaceFocus;
  onRepositorySelect?: (repositoryId: number) => void;
  onProjectSelect?: (projectId: string) => void;
  /** 仅切换 Git 面板目录，不联动全局工作区。 */
  directoryOnly?: boolean;
  /** 多仓 Git 面板是否 lazy 挂载各仓库区块（侧栏需配合 scrollRoot，见 GitMultiRepoPanel）。 */
  lazyMount?: boolean;
}

export function GitPanel(props: Props) {
  if ((props.repositoryEntries?.length ?? 0) >= 2) {
    return (
      <GitMultiRepoPanel
        repositoryEntries={props.repositoryEntries!}
        contextTitle={props.multiRepoContextTitle}
        headerPrefix={props.headerPrefix}
        onOpenFile={props.onOpenFile}
        projects={props.projects}
        repositories={props.repositories}
        activeProjectId={props.activeProjectId}
        activeRepositoryId={props.activeRepositoryId}
        activeWorkspaceFocus={props.activeWorkspaceFocus}
        activeRepositoryPath={props.repositoryPath}
        onRepositorySelect={props.onRepositorySelect}
        onProjectSelect={props.onProjectSelect}
        directoryOnly={props.directoryOnly}
        lazyMount={props.lazyMount}
      />
    );
  }
  return <GitSingleRepoPanel {...props} />;
}

function GitSingleRepoPanel({
  repositoryPath,
  repositoryName: _repositoryName,
  repositoryEntries: _repositoryEntries = [],
  onOpenFile,
  headerPrefix,
  projects = [],
  repositories = [],
  activeProjectId = null,
  activeRepositoryId = null,
  activeWorkspaceFocus = "repository",
  onRepositorySelect,
  onProjectSelect,
  directoryOnly,
}: Props) {
  const [status, setStatus] = useState<GitStatusResponse | null>(null);
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

  const runningActions = useRef(new Set<string>());
  const gitSyncActiveRef = useRef<GitSyncActionKind | null>(null);
  const lastActionTime = useRef(new Map<string, number>());
  const watcherRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncOpsInFlightRef = useRef(0);
  const pendingSilentRefreshRef = useRef(false);
  const statusRef = useRef<GitStatusResponse | null>(null);
  const statusLoadInFlightRef = useRef<Promise<void> | null>(null);
  const lastStatusLoadedAtRef = useRef(0);
  const DEBOUNCE_MS = 400;
  const STATUS_SILENT_MIN_INTERVAL_MS = 320;

  const loadStatus = useCallback(async (opts?: { silent?: boolean }) => {
    if (!repositoryPath) return;
    const silent = opts?.silent ?? false;
    if (silent) {
      if (statusLoadInFlightRef.current) {
        await statusLoadInFlightRef.current;
        return;
      }
      if (Date.now() - lastStatusLoadedAtRef.current < STATUS_SILENT_MIN_INTERVAL_MS) {
        return;
      }
    } else if (statusLoadInFlightRef.current) {
      await statusLoadInFlightRef.current;
      return;
    }
    const run = (async () => {
      if (!silent) {
        setLoading((prev) => ({ ...prev, status: true }));
      }
      try {
        const result = await gitStatus(repositoryPath);
        const apply = () => {
          if (gitStatusSnapshotEqual(statusRef.current, result)) {
            return;
          }
          statusRef.current = result;
          setStatus(result);
          setErrors((prev) => {
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
        const msg = e instanceof Error ? e.message : String(e);
        const applyErr = () => {
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
        lastStatusLoadedAtRef.current = Date.now();
        if (!silent) {
          setLoading((prev) => ({ ...prev, status: false }));
        }
      }
    })();
    statusLoadInFlightRef.current = run;
    try {
      await run;
    } finally {
      if (statusLoadInFlightRef.current === run) {
        statusLoadInFlightRef.current = null;
      }
    }
  }, [repositoryPath]);

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
    if (!repositoryPath) return;
    const cancelIdle = runWhenIdle(() => {
      void loadStatus();
    }, { timeoutMs: 1200 });
    return cancelIdle;
  }, [repositoryPath, loadStatus]);

  useEffect(() => {
    if (!repositoryPath) {
      if (watcherRefreshTimer.current) {
        clearTimeout(watcherRefreshTimer.current);
        watcherRefreshTimer.current = null;
      }
      void stopGitWatcher().catch(() => { });
      return;
    }

    void startGitWatcher(repositoryPath).catch(() => { });
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
      void stopGitWatcher().catch(() => { });
    };
  }, [repositoryPath, loadStatus]);

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

  const runGitSync = useCallback(
    (kind: GitSyncActionKind, work: () => Promise<void>, onErrorMessage: (msg: string) => void) => {
      void runGitSyncAction({
        kind,
        activeKindRef: gitSyncActiveRef,
        runningActions,
        setLoading,
        beginGitSyncOperation,
        endGitSyncOperation,
        refresh: () => loadStatus({ silent: true }),
        work,
        onError: onErrorMessage,
        onSuccess:
          kind === "fetch"
            ? () => {
                setErrors((prev) => {
                  if (!prev.fetch) return prev;
                  const next = { ...prev };
                  delete next.fetch;
                  return next;
                });
              }
            : undefined,
      });
    },
    [beginGitSyncOperation, endGitSyncOperation, loadStatus],
  );

  const handlePush = useCallback(() => {
    if (!repositoryPath) return;
    runGitSync("push", () => gitPush(repositoryPath), (msg) => message.error(`推送失败: ${msg}`));
  }, [repositoryPath, runGitSync]);

  const handlePull = useCallback(() => {
    if (!repositoryPath) return;
    runGitSync("pull", () => gitPull(repositoryPath), (msg) => message.error(`拉取失败: ${msg}`));
  }, [repositoryPath, runGitSync]);

  const handleFetch = useCallback(() => {
    if (!repositoryPath) return;
    runGitSync("fetch", () => gitFetch(repositoryPath), (msg) =>
      setErrors((prev) => ({ ...prev, fetch: msg })),
    );
  }, [repositoryPath, runGitSync]);

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
  const showPanelLoadingBar = Object.entries(loading).some(
    ([key, busy]) => busy && key !== "push" && key !== "pull" && key !== "fetch",
  );

  if (!repositoryPath) {
    return (
      <div className="app-git-panel">
        <Empty description="请选择仓库以查看 Git 状态" style={{ padding: "40px 0" }} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  }

  return (
    <div className="app-git-panel">
      <div className={`git-panel-loading-bar ${showPanelLoadingBar ? "git-panel-loading-bar--active" : ""}`} />
      <div className="git-panel-header">
        {headerPrefix ? <div className="git-panel-header-prefix">{headerPrefix}</div> : null}
        <div className="git-panel-header-left">
          {onRepositorySelect && repositoryPath ? (
            <GitPanelWorkspaceSelector
              projects={projects}
              repositories={repositories}
              activeProjectId={activeProjectId}
              activeRepositoryId={activeRepositoryId}
              activeWorkspaceFocus={activeWorkspaceFocus}
              activeRepositoryPath={repositoryPath}
              onRepositorySelect={onRepositorySelect}
              onProjectSelect={onProjectSelect}
              directoryOnly={directoryOnly}
            />
          ) : (
            <span className="git-panel-title">GIT</span>
          )}
        </div>
        <div className="git-panel-header-right">
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
          {status ? (
            <GitSyncActions
              status={status}
              loading={loading}
              onFetch={handleFetch}
              onPull={handlePull}
              onPush={handlePush}
            />
          ) : null}
        </div>
      </div>

      <div className="git-panel-body">
        {loading.status && !status && !isMissingRepo ? (
          <div style={{ padding: 24, textAlign: "center" }}>
            <Spin size="small" description="加载中..." />
          </div>
        ) : isMissingRepo ? (
          <InitMode onInit={handleInit} loading={loading.init} />
        ) : errors.status && !status ? (
          <Empty
            description={`Git 状态加载失败：${errors.status}`}
            style={{ padding: "24px 0" }}
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
    </div>
  );
}
