import { gitStatusSummary } from "../services/git";
import { startAdaptiveInterval } from "../utils/adaptivePoll";

const VISIBLE_POLL_INTERVAL_MS = 10000;
const HIDDEN_POLL_INTERVAL_MS = 30000;
const EMPTY_STATS = { additions: 0, deletions: 0 } as const;

export type GitRepositoryStats = { additions: number; deletions: number };

type PathEntry = {
  stats: GitRepositoryStats;
  generation: number;
  consumers: number;
};

type Listener = () => void;

const entriesByPath = new Map<string, PathEntry>();
const listenersByPath = new Map<string, Set<Listener>>();
let disposePoll: (() => void) | null = null;
let pollConsumerPaths = 0;

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

async function refreshPath(pathKey: string): Promise<void> {
  const entry = entriesByPath.get(pathKey);
  if (!entry || entry.consumers <= 0) return;
  try {
    const status = await gitStatusSummary(pathKey);
    const next: GitRepositoryStats = {
      additions: Math.max(0, status.additions || 0),
      deletions: Math.max(0, status.deletions || 0),
    };
    if (entry.stats.additions === next.additions && entry.stats.deletions === next.deletions) {
      return;
    }
    entry.stats = next;
    entry.generation += 1;
    publish(pathKey);
  } catch {
    if (entry.stats.additions === 0 && entry.stats.deletions === 0) return;
    entry.stats = { ...EMPTY_STATS };
    entry.generation += 1;
    publish(pathKey);
  }
}

function refreshAllPaths(): void {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  for (const pathKey of entriesByPath.keys()) {
    void refreshPath(pathKey);
  }
}

function ensurePollLoop(): void {
  if (disposePoll || pollConsumerPaths <= 0) return;
  void refreshAllPaths();
  disposePoll = startAdaptiveInterval(
    refreshAllPaths,
    VISIBLE_POLL_INTERVAL_MS,
    HIDDEN_POLL_INTERVAL_MS,
  );
}

function stopPollLoopIfIdle(): void {
  if (pollConsumerPaths > 0) return;
  if (disposePoll) {
    disposePoll();
    disposePoll = null;
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
  pollConsumerPaths += 1;
  ensurePollLoop();
  void refreshPath(pathKey);
  return created;
}

function releasePath(pathKey: string): void {
  const entry = entriesByPath.get(pathKey);
  if (!entry) return;
  entry.consumers = Math.max(0, entry.consumers - 1);
  if (entry.consumers > 0) return;
  entriesByPath.delete(pathKey);
  listenersByPath.delete(pathKey);
  pollConsumerPaths = Math.max(0, pollConsumerPaths - 1);
  stopPollLoopIfIdle();
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
  return () => {
    set?.delete(listener);
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
  void refreshPath(pathKey);
}

export function getGitRepositoryStatsGeneration(path: string): number {
  const pathKey = normalizePath(path);
  if (!pathKey) return 0;
  return entriesByPath.get(pathKey)?.generation ?? 0;
}

/** @internal test helper */
export function resetGitRepositoryStatsStoreForTests(): void {
  if (disposePoll) {
    disposePoll();
    disposePoll = null;
  }
  entriesByPath.clear();
  listenersByPath.clear();
  pollConsumerPaths = 0;
}
