import { startTransition, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { safeUnlistenPromise } from "../../utils/safeTauriUnlisten";
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
import { DiffMode } from "./DiffMode";
import { GitSyncActions } from "./GitSyncActions";
import { InitMode } from "./InitMode";
import { hasUnstagedFilesUnderDirectory, yieldToPaint } from "./gitPanelUtils";
import { RepositoryFilesExplorer } from "./RepositoryFilesExplorer";
import type { GitPanelOpenFileOptions } from "./types";
import "./index.css";

export { RepositoryFilesExplorer };
export type { GitPanelOpenFileOptions };

interface Props {
  repositoryPath: string | undefined;
  repositoryName: string | undefined;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
  /** 左栏整合头部：Tab 切换等，渲染在 GIT 标题左侧 */
  headerPrefix?: ReactNode;
}

export function GitPanel({ repositoryPath, repositoryName: _repositoryName, onOpenFile, headerPrefix }: Props) {
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
  const lastActionTime = useRef(new Map<string, number>());
  const watcherRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const DEBOUNCE_MS = 400;
  const WATCHER_REFRESH_MS = 120;

  const loadStatus = useCallback(async (opts?: { silent?: boolean }) => {
    if (!repositoryPath) return;
    const silent = opts?.silent ?? false;
    if (!silent) {
      setLoading((prev) => ({ ...prev, status: true }));
    }
    try {
      const result = await gitStatus(repositoryPath);
      const apply = () => {
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
        setErrors((prev) => ({ ...prev, status: msg }));
        setStatus(null);
      };
      if (silent) {
        startTransition(applyErr);
      } else {
        applyErr();
      }
    } finally {
      if (!silent) {
        setLoading((prev) => ({ ...prev, status: false }));
      }
    }
  }, [repositoryPath]);

  useEffect(() => {
    if (repositoryPath) {
      void loadStatus();
    }
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
    const unlisten = listen("git-changed", () => {
      if (watcherRefreshTimer.current) {
        clearTimeout(watcherRefreshTimer.current);
      }
      watcherRefreshTimer.current = setTimeout(() => {
        watcherRefreshTimer.current = null;
        void loadStatus({ silent: true });
      }, WATCHER_REFRESH_MS);
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
      if (now - lastTime < DEBOUNCE_MS) return;
      if (runningActions.current.has(action)) return;

      runningActions.current.add(action);
      lastActionTime.current.set(action, now);
      setLoading((prev) => ({ ...prev, [action]: true }));

      try {
        await yieldToPaint();
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
        runningActions.current.delete(action);
        setLoading((prev) => ({ ...prev, [action]: false }));
      }
    },
    [loadStatus],
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
        await gitCommit(repositoryPath!, msg);
      }),
    [repositoryPath, runAction],
  );

  const handlePush = useCallback(async () => {
    if (runningActions.current.has("push")) return;
    runningActions.current.add("push");
    setLoading((prev) => ({ ...prev, push: true }));
    try {
      await yieldToPaint();
      await gitPush(repositoryPath!);
      await loadStatus({ silent: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(`推送失败: ${msg}`);
    } finally {
      runningActions.current.delete("push");
      setLoading((prev) => ({ ...prev, push: false }));
    }
  }, [repositoryPath, loadStatus]);

  const handlePull = useCallback(async () => {
    if (runningActions.current.has("pull")) return;
    runningActions.current.add("pull");
    setLoading((prev) => ({ ...prev, pull: true }));
    try {
      await yieldToPaint();
      await gitPull(repositoryPath!);
      await loadStatus({ silent: true });
      message.success("拉取成功");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(`拉取失败: ${msg}`);
    } finally {
      runningActions.current.delete("pull");
      setLoading((prev) => ({ ...prev, pull: false }));
    }
  }, [repositoryPath, loadStatus]);

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
  const anyLoading = Object.values(loading).some(Boolean);
  if (!repositoryPath) {
    return (
      <div className="app-git-panel">
        <Empty description="请选择仓库以查看 Git 状态" style={{ padding: "40px 0" }} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  }

  return (
    <div className="app-git-panel">
      <div className={`git-panel-loading-bar ${anyLoading ? "git-panel-loading-bar--active" : ""}`} />
      <div className="git-panel-header">
        {headerPrefix ? <div className="git-panel-header-prefix">{headerPrefix}</div> : null}
        <div className="git-panel-header-left">
          <span className="git-panel-title">GIT</span>
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
              onPull={() => void handlePull()}
              onPush={() => void handlePush()}
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
