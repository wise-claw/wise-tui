import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { safeUnlistenPromise } from "../../utils/safeTauriUnlisten";
import { Button, Dropdown, Empty, Space, Spin, Tag, Tooltip, message } from "antd";
import { DownOutlined, FileTextOutlined, GlobalOutlined, HistoryOutlined } from "@ant-design/icons";
import {
  gitCommit,
  gitDiscard,
  gitDiscardAll,
  gitFetch,
  gitInit,
  gitLog,
  gitPull,
  gitPush,
  gitStage,
  gitStatus,
  gitUnstage,
  gitUnstageAll,
  startGitWatcher,
  stopGitWatcher,
} from "../../services/git";
import { openRepositoryRemoteInBrowser } from "../../services/openRepositoryRemote";
import type { GitLogEntry, GitPanelMode, GitStatusResponse } from "../../types";
import { DiffMode } from "./DiffMode";
import { GitSyncActions } from "./GitSyncActions";
import { InitMode } from "./InitMode";
import { LogMode } from "./LogMode";
import { yieldToPaint } from "./gitPanelUtils";
import { RepositoryFilesExplorer } from "./RepositoryFilesExplorer";
import type { GitPanelOpenFileOptions } from "./types";
import "./index.css";

export { RepositoryFilesExplorer };
export type { GitPanelOpenFileOptions };

const MODE_OPTIONS: { label: string; value: GitPanelMode; icon: React.ReactNode }[] = [
  { label: "变更", value: "diff", icon: <FileTextOutlined /> },
  { label: "日志", value: "log", icon: <HistoryOutlined /> },
];

interface Props {
  repositoryPath: string | undefined;
  repositoryName: string | undefined;
  onOpenFile?: (path: string, options?: GitPanelOpenFileOptions) => void;
}

export function GitPanel({ repositoryPath, repositoryName: _repositoryName, onOpenFile }: Props) {
  const [mode, setMode] = useState<GitPanelMode>("diff");
  const [status, setStatus] = useState<GitStatusResponse | null>(null);
  const [logData, setLogData] = useState<{
    entries: GitLogEntry[];
    ahead: number;
    behind: number;
    upstream: string | null;
  }>({ entries: [], ahead: 0, behind: 0, upstream: null });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [openingRemote, setOpeningRemote] = useState(false);
  const [loading, setLoading] = useState<Record<string, boolean>>({
    status: false,
    log: false,
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

  const loadLog = useCallback(async (opts?: { silent?: boolean }) => {
    if (!repositoryPath) return;
    const silent = opts?.silent ?? false;
    if (!silent) {
      setLoading((prev) => ({ ...prev, log: true }));
    }
    try {
      const result = await gitLog(repositoryPath, 20);
      const apply = () => {
        setLogData({
          entries: result.entries,
          ahead: result.ahead,
          behind: result.behind,
          upstream: result.upstream,
        });
      };
      if (silent) {
        startTransition(apply);
      } else {
        apply();
      }
    } catch {
      // Silently fail for log.
    } finally {
      if (!silent) {
        setLoading((prev) => ({ ...prev, log: false }));
      }
    }
  }, [repositoryPath]);

  useEffect(() => {
    if (repositoryPath) {
      void loadStatus();
      if (mode === "log") {
        void loadLog();
      }
    }
  }, [repositoryPath, mode, loadStatus, loadLog]);

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
        if (mode === "log") {
          void loadLog({ silent: true });
        }
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
  }, [repositoryPath, mode, loadStatus, loadLog]);

  const runAction = useCallback(
    async (
      action: string,
      fn: () => Promise<void>,
      options?: { successMessage?: string },
    ) => {
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
        if (mode === "log") {
          await loadLog({ silent: true });
        }
        setErrors((prev) => {
          if (!prev[action]) return prev;
          const next = { ...prev };
          delete next[action];
          return next;
        });
        if (options?.successMessage) {
          message.success(options.successMessage);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setErrors((prev) => ({ ...prev, [action]: msg }));
      } finally {
        runningActions.current.delete(action);
        setLoading((prev) => ({ ...prev, [action]: false }));
      }
    },
    [mode, loadStatus, loadLog],
  );

  const handleStage = useCallback(
    (filePath: string) => runAction("stage", () => gitStage(repositoryPath!, filePath)),
    [repositoryPath, runAction],
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
      if (!status) return;
      for (const file of status.unstaged) {
        await gitStage(repositoryPath!, file.path);
      }
    });
  }, [repositoryPath, status, runAction]);

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
      void runAction(
        "commit",
        async () => {
          await gitCommit(repositoryPath!, msg);
        },
        { successMessage: "提交成功" },
      ),
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
      if (mode === "log") {
        await loadLog({ silent: true });
      }
      message.success("推送成功");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(`推送失败: ${msg}`);
    } finally {
      runningActions.current.delete("push");
      setLoading((prev) => ({ ...prev, push: false }));
    }
  }, [repositoryPath, mode, loadStatus, loadLog]);

  const handlePull = useCallback(async () => {
    if (runningActions.current.has("pull")) return;
    runningActions.current.add("pull");
    setLoading((prev) => ({ ...prev, pull: true }));
    try {
      await yieldToPaint();
      await gitPull(repositoryPath!);
      await loadStatus({ silent: true });
      if (mode === "log") {
        await loadLog({ silent: true });
      }
      message.success("拉取成功");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(`拉取失败: ${msg}`);
    } finally {
      runningActions.current.delete("pull");
      setLoading((prev) => ({ ...prev, pull: false }));
    }
  }, [repositoryPath, mode, loadStatus, loadLog]);

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
  const modeIcon = useMemo(() => {
    const opt = MODE_OPTIONS.find((option) => option.value === mode);
    return opt?.icon;
  }, [mode]);

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
        <div className="git-panel-header-left">
          <span className="git-panel-title">GIT</span>
          {status && (
            <Tag
              color={mode === "diff" ? "blue" : mode === "log" ? "green" : "default"}
              style={{ fontSize: 10, padding: "0 5px", lineHeight: "16px", borderRadius: 3 }}
            >
              {mode === "diff" ? `${status.staged.length + status.unstaged.length} 个变更` : `${logData.entries.length} 条记录`}
            </Tag>
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
          {mode === "diff" && status ? (
            <GitSyncActions
              status={status}
              loading={loading}
              onFetch={handleFetch}
              onPull={() => void handlePull()}
              onPush={() => void handlePush()}
            />
          ) : null}
          <Dropdown
            menu={{
              items: MODE_OPTIONS.map((option) => ({
                key: option.value,
                label: (
                  <Space size={6}>
                    {option.icon}
                    {option.label}
                  </Space>
                ),
              })),
              onClick: ({ key }) => setMode(key as GitPanelMode),
              selectedKeys: [mode],
            }}
            placement="bottomRight"
            trigger={["click"]}
          >
            <Button type="text" size="small" icon={modeIcon} className="git-mode-btn">
              <span className="git-mode-btn-text">{mode === "diff" ? "变更" : "日志"}</span>
              <DownOutlined style={{ fontSize: 10 }} />
            </Button>
          </Dropdown>
        </div>
      </div>

      <div className="git-panel-body">
        {loading.status && !status && !isMissingRepo ? (
          <div style={{ padding: 24, textAlign: "center" }}>
            <Spin size="small" description="加载中..." />
          </div>
        ) : isMissingRepo ? (
          <InitMode onInit={handleInit} loading={loading.init} />
        ) : mode === "diff" ? (
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
        ) : (
          <LogMode
            entries={logData.entries}
            loading={loading.log}
            ahead={logData.ahead}
            behind={logData.behind}
            upstream={logData.upstream}
          />
        )}
      </div>
    </div>
  );
}
