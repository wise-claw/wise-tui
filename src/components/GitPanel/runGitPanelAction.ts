/**
 * Git 面板 stage/unstage/discard/commit 等 mutation 的共用执行器。
 *
 * 关键点：loading 只覆盖真正的 mutation IPC，不覆盖随后的 `git_status` 刷新。
 * 文件很多时 status 可能要数秒；若把 loading 一直挂到 status 结束，就会「转圈很久」。
 */

export type GitPanelActionLoadingSetter = (
  update: (prev: Record<string, boolean>) => Record<string, boolean>,
) => void;

export type GitPanelActionErrorSetter = (
  update: (prev: Record<string, string>) => Record<string, string>,
) => void;

/** 会改动工作区/index，需压制 watcher 并发刷新的 action。 */
const WORKSPACE_MUTATION_ACTIONS = new Set([
  "stage",
  "unstage",
  "discard",
  "stageAll",
  "unstageAll",
  "discardAll",
  "commit",
  "commitAndPush",
  "init",
]);

export interface RunGitPanelActionParams {
  action: string;
  debounceMs: number;
  lastActionTime: Map<string, number>;
  runningActions: Set<string>;
  setLoading: GitPanelActionLoadingSetter;
  setErrors: GitPanelActionErrorSetter;
  beginGitSyncOperation?: () => void;
  endGitSyncOperation?: () => void;
  /** 成功后刷新状态；应使用 silent + force，避免被节流吞掉。 */
  refreshStatus: () => Promise<void>;
  fn: () => Promise<void>;
}

export async function runGitPanelAction(params: RunGitPanelActionParams): Promise<void> {
  const {
    action,
    debounceMs,
    lastActionTime,
    runningActions,
    setLoading,
    setErrors,
    beginGitSyncOperation,
    endGitSyncOperation,
    refreshStatus,
    fn,
  } = params;

  const now = Date.now();
  const lastTime = lastActionTime.get(action) || 0;
  if (action !== "commit" && now - lastTime < debounceMs) return;
  if (runningActions.has(action)) return;

  runningActions.add(action);
  lastActionTime.set(action, now);
  setLoading((prev) => ({ ...prev, [action]: true }));

  const tracksWorkspace = WORKSPACE_MUTATION_ACTIONS.has(action);
  if (tracksWorkspace) beginGitSyncOperation?.();

  let succeeded = false;
  try {
    await fn();
    succeeded = true;
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
    runningActions.delete(action);
    setLoading((prev) => ({ ...prev, [action]: false }));
  }

  if (succeeded) {
    try {
      await refreshStatus();
    } catch {
      /* refresh 失败由下次 watcher / 手动刷新兜底 */
    }
  }

  if (tracksWorkspace) endGitSyncOperation?.();
}
