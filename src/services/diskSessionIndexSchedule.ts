/** 切仓后等首屏 Git / 文件树 / transcript 完成，再扫磁盘会话索引。 */
export const DISK_SESSION_INDEX_SWITCH_DEFER_MS = 4000;
/** 后台扫其它已打开仓路径的起始延迟。 */
export const DISK_SESSION_INDEX_BACKGROUND_DEFER_MS = 4500;
export const DISK_SESSION_INDEX_BACKGROUND_STAGGER_MS = 800;
/** 同一仓自动扫盘的最短间隔，避免切仓反复打满命令线程。 */
export const DISK_SESSION_INDEX_COOLDOWN_MS = 30_000;

const lastListedAtByPath = new Map<string, number>();
const refreshInflight = new Map<string, Promise<void>>();

export function wasDiskSessionIndexListedRecently(
  repositoryPath: string,
  now = Date.now(),
  cooldownMs = DISK_SESSION_INDEX_COOLDOWN_MS,
): boolean {
  const key = repositoryPath.trim();
  if (!key) return false;
  const last = lastListedAtByPath.get(key);
  return last != null && now - last < cooldownMs;
}

export function markDiskSessionIndexListed(repositoryPath: string, now = Date.now()): void {
  const key = repositoryPath.trim();
  if (!key) return;
  lastListedAtByPath.set(key, now);
}

export function runSharedDiskSessionIndexRefresh(
  repositoryPath: string,
  run: () => Promise<void>,
): Promise<void> {
  const key = repositoryPath.trim();
  if (!key) return Promise.resolve();
  const existing = refreshInflight.get(key);
  if (existing) return existing;
  const promise = run().finally(() => {
    if (refreshInflight.get(key) === promise) {
      refreshInflight.delete(key);
    }
  });
  refreshInflight.set(key, promise);
  return promise;
}

export function scheduleDeferredTask(task: () => void, delayMs: number): () => void {
  const timer = window.setTimeout(task, delayMs);
  return () => window.clearTimeout(timer);
}

/** @internal */
export function clearDiskSessionIndexScheduleForTests(): void {
  lastListedAtByPath.clear();
  refreshInflight.clear();
}
