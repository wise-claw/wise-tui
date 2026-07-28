const EMPTY_STATS = { additions: 0, deletions: 0, ahead: 0, behind: 0 } as const;

export type GitRepositoryStats = { additions: number; deletions: number; ahead: number; behind: number };

type PathEntry = {
  stats: GitRepositoryStats;
  generation: number;
  consumers: number;
};

type Listener = () => void;

type ExplorerBridge = {
  refresh: (path: string) => void;
  subscribe: (path: string, listener: Listener) => () => void;
};

const entriesByPath = new Map<string, PathEntry>();
const listenersByPath = new Map<string, Set<Listener>>();
let explorerBridge: ExplorerBridge | null = null;

function normalizePath(path: string): string {
  return path.trim();
}

function publish(pathKey: string): void {
  const listeners = listenersByPath.get(pathKey);
  if (!listeners) return;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

function acquirePath(pathKey: string): PathEntry {
  const existing = entriesByPath.get(pathKey);
  if (existing) {
    existing.consumers += 1;
    return existing;
  }
  const created: PathEntry = {
    stats: { ...EMPTY_STATS },
    generation: 0,
    consumers: 1,
  };
  entriesByPath.set(pathKey, created);
  return created;
}

function releasePath(pathKey: string): void {
  const entry = entriesByPath.get(pathKey);
  if (!entry) return;
  entry.consumers = Math.max(0, entry.consumers - 1);
  if (entry.consumers > 0) return;
  entriesByPath.delete(pathKey);
  listenersByPath.delete(pathKey);
}

/** Wired by gitRepositoryExplorerStatusStore to share one git_status poll. */
export function registerGitRepositoryStatsExplorerBridge(bridge: ExplorerBridge): void {
  explorerBridge = bridge;
}

/** Apply stats derived from a full `git_status` payload (shared poll path). */
export function applyGitRepositoryStatsFromStatus(
  path: string,
  next: GitRepositoryStats,
): void {
  const pathKey = normalizePath(path);
  if (!pathKey) return;
  let entry = entriesByPath.get(pathKey);
  if (!entry) {
    // Keep derived values even when only explorer consumers are active, so a later
    // stats subscriber sees a warm snapshot without an extra IPC.
    entry = {
      stats: { ...EMPTY_STATS },
      generation: 0,
      consumers: 0,
    };
    entriesByPath.set(pathKey, entry);
  }
  if (
    entry.stats.additions === next.additions
    && entry.stats.deletions === next.deletions
    && entry.stats.ahead === next.ahead
    && entry.stats.behind === next.behind
  ) {
    return;
  }
  entry.stats = {
    additions: Math.max(0, next.additions || 0),
    deletions: Math.max(0, next.deletions || 0),
    ahead: Math.max(0, next.ahead || 0),
    behind: Math.max(0, next.behind || 0),
  };
  entry.generation += 1;
  publish(pathKey);
}

export function applyGitRepositoryStatsEmpty(path: string): void {
  applyGitRepositoryStatsFromStatus(path, { ...EMPTY_STATS });
}

export function subscribeGitRepositoryStats(path: string, listener: Listener): () => void {
  const pathKey = normalizePath(path);
  if (!pathKey) return () => {};
  acquirePath(pathKey);
  let set = listenersByPath.get(pathKey);
  if (!set) {
    set = new Set();
    listenersByPath.set(pathKey, set);
  }
  set.add(listener);
  // Keep the shared explorer git_status poll alive for this path.
  const unsubExplorer = explorerBridge?.subscribe(pathKey, () => {}) ?? (() => {});
  return () => {
    set?.delete(listener);
    unsubExplorer();
    releasePath(pathKey);
  };
}

export function getGitRepositoryStatsSnapshot(path: string): GitRepositoryStats {
  const pathKey = normalizePath(path);
  if (!pathKey) return { ...EMPTY_STATS };
  return entriesByPath.get(pathKey)?.stats ?? { ...EMPTY_STATS };
}

export function refreshGitRepositoryStats(path: string): void {
  const pathKey = normalizePath(path);
  if (!pathKey) return;
  explorerBridge?.refresh(pathKey);
}

export function getGitRepositoryStatsGeneration(path: string): number {
  const pathKey = normalizePath(path);
  if (!pathKey) return 0;
  return entriesByPath.get(pathKey)?.generation ?? 0;
}

/** @internal test helper */
export function resetGitRepositoryStatsStoreForTests(): void {
  entriesByPath.clear();
  listenersByPath.clear();
}
