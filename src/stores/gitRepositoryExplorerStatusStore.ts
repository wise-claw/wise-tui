import { listen } from "@tauri-apps/api/event";
import {
  buildExplorerGitStatusIndex,
  EMPTY_EXPLORER_GIT_STATUS_INDEX,
  explorerGitStatusIndexEqual,
  type ExplorerGitStatusIndex,
} from "../components/GitPanel/repositoryExplorerGitStatus";
import { GIT_WATCHER_REFRESH_MS } from "../components/GitPanel/gitPanelUtils";
import { gitStatus } from "../services/git";
import { consumeWarmGitStatus } from "../services/gitStatusWarmCache";
import { startAdaptiveInterval } from "../utils/adaptivePoll";
import { safeUnlisten } from "../utils/safeTauriUnlisten";

const VISIBLE_POLL_INTERVAL_MS = 10000;
const HIDDEN_POLL_INTERVAL_MS = 30000;

type PathEntry = {
  index: ExplorerGitStatusIndex;
  generation: number;
  consumers: number;
};

type Listener = () => void;

const entriesByPath = new Map<string, PathEntry>();
const listenersByPath = new Map<string, Set<Listener>>();
let disposePoll: (() => void) | null = null;
let pollConsumerPaths = 0;
let gitChangedUnlisten: (() => void) | null = null;
let gitChangedListenerConsumers = 0;
let gitChangedRefreshTimer: ReturnType<typeof setTimeout> | null = null;

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
    const warm = consumeWarmGitStatus(pathKey);
    const status = warm ? await warm : await gitStatus(pathKey);
    const nextIndex = buildExplorerGitStatusIndex(status);
    if (explorerGitStatusIndexEqual(entry.index, nextIndex)) {
      return;
    }
    entry.index = nextIndex;
    entry.generation += 1;
    publish(pathKey);
  } catch {
    if (
      entry.index.fileStatusByPath.size === 0 &&
      entry.index.dirsWithChanges.size === 0
    ) {
      return;
    }
    entry.index = EMPTY_EXPLORER_GIT_STATUS_INDEX;
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

function scheduleGitChangedRefresh(): void {
  if (gitChangedRefreshTimer) {
    clearTimeout(gitChangedRefreshTimer);
  }
  gitChangedRefreshTimer = setTimeout(() => {
    gitChangedRefreshTimer = null;
    refreshAllPaths();
  }, GIT_WATCHER_REFRESH_MS);
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

function ensureGitChangedListener(): void {
  if (gitChangedUnlisten) return;
  void listen<{ path?: string }>("git-changed", () => {
    scheduleGitChangedRefresh();
  }).then((unlisten) => {
    gitChangedUnlisten = () => {
      safeUnlisten(unlisten);
    };
  });
}

function releaseGitChangedListener(): void {
  if (gitChangedListenerConsumers > 0) return;
  if (gitChangedRefreshTimer) {
    clearTimeout(gitChangedRefreshTimer);
    gitChangedRefreshTimer = null;
  }
  if (gitChangedUnlisten) {
    gitChangedUnlisten();
    gitChangedUnlisten = null;
  }
}

function acquirePath(pathKey: string): PathEntry {
  const existing = entriesByPath.get(pathKey);
  if (existing) {
    existing.consumers += 1;
    return existing;
  }
  const created: PathEntry = {
    index: EMPTY_EXPLORER_GIT_STATUS_INDEX,
    generation: 0,
    consumers: 1,
  };
  entriesByPath.set(pathKey, created);
  pollConsumerPaths += 1;
  gitChangedListenerConsumers += 1;
  ensurePollLoop();
  ensureGitChangedListener();
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
  gitChangedListenerConsumers = Math.max(0, gitChangedListenerConsumers - 1);
  stopPollLoopIfIdle();
  releaseGitChangedListener();
}

export function subscribeGitRepositoryExplorerStatus(path: string, listener: Listener): () => void {
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

export function getGitRepositoryExplorerStatusSnapshot(path: string): ExplorerGitStatusIndex {
  const pathKey = normalizePath(path);
  if (!pathKey) return EMPTY_EXPLORER_GIT_STATUS_INDEX;
  return entriesByPath.get(pathKey)?.index ?? EMPTY_EXPLORER_GIT_STATUS_INDEX;
}

export function getGitRepositoryExplorerStatusGeneration(path: string): number {
  const pathKey = normalizePath(path);
  if (!pathKey) return 0;
  return entriesByPath.get(pathKey)?.generation ?? 0;
}

export function refreshGitRepositoryExplorerStatus(path: string): void {
  const pathKey = normalizePath(path);
  if (!pathKey) return;
  void refreshPath(pathKey);
}

/** @internal test helper */
export function resetGitRepositoryExplorerStatusStoreForTests(): void {
  if (disposePoll) {
    disposePoll();
    disposePoll = null;
  }
  if (gitChangedRefreshTimer) {
    clearTimeout(gitChangedRefreshTimer);
    gitChangedRefreshTimer = null;
  }
  if (gitChangedUnlisten) {
    gitChangedUnlisten();
    gitChangedUnlisten = null;
  }
  entriesByPath.clear();
  listenersByPath.clear();
  pollConsumerPaths = 0;
  gitChangedListenerConsumers = 0;
}
