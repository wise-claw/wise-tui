import { startTransition, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { safeUnlistenPromise } from "../../utils/safeTauriUnlisten";
import { Empty, Spin, message } from "antd";
import {
  gitCommit,
  gitDiscard,
  gitDiscardAll,
  gitFetch,
  gitInit,
  gitPull,
  gitStage,
  gitStagePaths,
  gitStageAll,
  gitStatus,
  gitUnstage,
  gitUnstageAll,
  startGitWatcher,
  stopGitWatcher,
} from "../../services/git";
import { consumeWarmGitStatus } from "../../services/gitStatusWarmCache";
import type { SessionExecutionEngine } from "../../constants/sessionExecutionEngine";
import { normalizeSessionExecutionEngine } from "../../constants/sessionExecutionEngine";
import { WISE_GIT_REPOSITORY_STATUS_REFRESH, type GitRepositoryStatusRefreshDetail } from "../../constants/gitUiEvents";
import { aiCommitPullPushRepository, commitPullPushRepository, isGitMergeConflictError } from "../../services/gitCommitPullPush";
import { openRepositoryRemoteInBrowser } from "../../services/openRepositoryRemote";
import { refreshGitRepositoryStats } from "../../stores/gitRepositoryStatsStore";
import { refreshGitRepositoryExplorerStatus } from "../../stores/gitRepositoryExplorerStatusStore";
import type { GitStatusResponse } from "../../types";
import { normalizeConventionalCommitMessage } from "../../utils/conventionalCommitMessage";
import { runGitSyncAction, type GitSyncActionKind } from "./gitSyncActionRunner";
import { DiffMode } from "./DiffMode";
import { GitHistoryDrawer } from "./GitHistoryDrawer";
import { GitPanelMoreMenu } from "./GitPanelMoreMenu";
import { GitSyncActions } from "./GitSyncActions";
import { InitMode } from "./InitMode";
import { hasUnstagedFilesUnderDirectory, GIT_WATCHER_REFRESH_MS, gitStatusSnapshotEqual } from "./gitPanelUtils";
import { GitMultiRepoPanel } from "./GitMultiRepoPanel";
import type { GitPanelRepositoryEntry } from "../../utils/workspaceRepositoryTreeSelect";
import type { GitPanelOpenFileOptions } from "./types";
import "./index.css";

export { RepositoryFilesExplorer } from "./RepositoryFilesExplorer";
export type { GitPanelOpenFileOptions } from "./types";

interface Props {
  repositoryPath: string | undefined;
  repositoryName: string | undefined;
  /** 多仓库模式：一次展示工作区内全部 Git 仓库（≥2 时启用）。 */
  repositoryEntries?: GitPanelRepositoryEntry[];
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  /** 左栏整合头部：Tab 切换等 */
  headerPrefix?: ReactNode;
  /** 多仓 Git 面板是否 lazy 挂载各仓库区块（侧栏需配合 scrollRoot，见 GitMultiRepoPanel）。 */
  lazyMount?: boolean;
}

export function GitPanel(props: Props) {
  if ((props.repositoryEntries?.length ?? 0) >= 2) {
    return (
      <GitMultiRepoPanel
        repositoryEntries={props.repositoryEntries!}
        headerPrefix={props.headerPrefix}
        onOpenFile={props.onOpenFile}
        activeRepositoryPath={props.repositoryPath}
        lazyMount={props.lazyMount}
      />
    );
  }
  return <GitSingleRepoPanel {...props} />;
}

function GitSingleRepoPanel({
  repositoryPath,
  repositoryName: _repositoryName,
  repositoryEntries = [],
  onOpenFile,
  headerPrefix,
}: Props) {
  const pathKey = repositoryPath?.trim() ?? "";
  const matchedEntry = pathKey
    ? repositoryEntries.find((entry) => entry.path.trim() === pathKey)
    : undefined;
  const executionEngine: SessionExecutionEngine | undefined = matchedEntry?.executionEngine
    ? normalizeSessionExecutionEngine(matchedEntry.executionEngine)
    : undefined;
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
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
  const pendingSilentStatusRefreshRef = useRef(false);
  const statusRef = useRef<GitStatusResponse | null>(null);
  const statusLoadInFlightRef = useRef<Promise<void> | null>(null);
  const lastStatusLoadedAtRef = useRef(0);
  const DEBOUNCE_MS = 400;
  const STATUS_SILENT_MIN_INTERVAL_MS = 320;

  const handleOpenRepoFile = useCallback(
    (path: string, options?: GitPanelOpenFileOptions) => {
      onOpenFile?.(path, {
        ...options,
        fileRootPath: options?.fileRootPath?.trim() || repositoryPath,
      });
    },
    [onOpenFile, repositoryPath],
  );

  const loadStatus = useCallback(async (opts?: { silent?: boolean; force?: boolean }) => {
    if (!repositoryPath) return;
    const silent = opts?.silent ?? false;
    const force = opts?.force ?? false;
    if (silent) {
      if (statusLoadInFlightRef.current) {
        pendingSilentStatusRefreshRef.current = true;
        return;
      }
      if (
        !force &&
        Date.now() - lastStatusLoadedAtRef.current < STATUS_SILENT_MIN_INTERVAL_MS
      ) {
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
        const warm = silent ? null : consumeWarmGitStatus(repositoryPath);
        const result = warm ? await warm : await gitStatus(repositoryPath);
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
      if (pendingSilentStatusRefreshRef.current) {
        pendingSilentStatusRefreshRef.current = false;
        void loadStatus({ silent: true });
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
    // 切仓后立即清空旧仓状态，避免点击瞬间残留上一个仓库的文件列表（无 spinner 状态）。
    setStatus(null);
    if (!repositoryPath) return;
    // 旧实现包了 runWhenIdle(timeoutMs: 1200)；点击切换瞬间主线程繁忙，
    // 空闲回调会被推到 ~1.2s 后才发起 git_status，肉眼看上去就是 Git 面板「卡几秒」。
    // 直接走微任务调度：让本帧渲染先 commit，下一 microtask 立刻发起 IPC。
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      void loadStatus();
    });
    return () => {
      cancelled = true;
    };
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

  useEffect(() => {
    if (!repositoryPath) return;
    const onPanelRefresh = (event: Event) => {
      const path = (event as CustomEvent<GitRepositoryStatusRefreshDetail>).detail?.path?.trim();
      if (path && path !== repositoryPath) return;
      void loadStatus({ silent: true, force: true });
    };
    window.addEventListener(WISE_GIT_REPOSITORY_STATUS_REFRESH, onPanelRefresh);
    return () => {
      window.removeEventListener(WISE_GIT_REPOSITORY_STATUS_REFRESH, onPanelRefresh);
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

      const tracksSync = action === "commit" || action === "commitAndPush" || action === "fetch";
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

  const handleCommitAndPush = useCallback(
    (msg: string) =>
      void runAction("commitAndPush", async () => {
        if (!repositoryPath) return;
        const raw = msg.trim();
        if (!raw) throw new Error("提交信息不能为空");
        const trimmed = normalizeConventionalCommitMessage(raw);
        const outcome = await commitPullPushRepository(repositoryPath, trimmed);
        if (outcome === "noop") {
          message.info("当前没有可提交的改动，也没有待推送的提交");
          return;
        }
        refreshGitRepositoryStats(repositoryPath);
        refreshGitRepositoryExplorerStatus(repositoryPath);
        if (outcome === "pushed_only") {
          message.success("已推送待同步提交");
        } else {
          message.success("已提交并推送");
        }
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
    runGitSync(
      "push",
      async () => {
        const outcome = await aiCommitPullPushRepository(repositoryPath, {
          executionEngine,
        });
        if (outcome === "noop") {
          message.info("当前没有可提交的改动，也没有待推送的提交");
        } else {
          message.success(outcome === "pushed_only" ? "已推送待同步提交" : "已提交并推送");
        }
      },
      (msg) => {
        if (isGitMergeConflictError(msg)) {
          message.warning("拉取/合并存在冲突，请手动解决后重试");
        } else {
          message.error(`推送失败: ${msg}`);
        }
      },
    );
  }, [executionEngine, repositoryPath, runGitSync]);

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
    ([key, busy]) => busy && key !== "push" && key !== "pull" && key !== "fetch" && key !== "commitAndPush",
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
        <div className="git-panel-header-right">
          {status ? (
            <GitSyncActions
              status={status}
              loading={loading}
              onFetch={handleFetch}
              onPull={handlePull}
              onPush={handlePush}
            />
          ) : null}
          <GitPanelMoreMenu
            repositoryPath={repositoryPath}
            historyActive={historyDrawerOpen}
            onOpenHistory={() => setHistoryDrawerOpen(true)}
            onOpenInBrowser={handleOpenRemoteInBrowser}
            openingBrowser={openingRemote}
            onFlowOperationDone={() => void loadStatus({ silent: true })}
          />
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
              executionEngine={executionEngine}
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
              onCommitAndPush={handleCommitAndPush}
              onOpenFile={handleOpenRepoFile}
              onBranchChanged={() => void loadStatus({ silent: true })}
            />
          )
        )}
      </div>
      <GitHistoryDrawer
        open={historyDrawerOpen}
        repositoryPath={repositoryPath}
        onClose={() => setHistoryDrawerOpen(false)}
        onOpenFile={handleOpenRepoFile}
        onRepositoryRefresh={() => void loadStatus({ silent: true })}
      />
    </div>
  );
}
