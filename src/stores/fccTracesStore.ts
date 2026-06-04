import { FCC_TRACES_FETCH_LIMIT, FCC_TRACES_IN_MEMORY_MAX } from "../constants/fccTraces";
import type { FreeClaudeCodeStatus } from "../services/freeClaudeCode";
import { getFreeClaudeCodeStatus } from "../services/freeClaudeCode";
import { clearFccTraces, listFccTraces } from "../services/fccTraces";
import type { FccTraceEntry } from "../types/fccTrace";
import { mergeFccTraceEntries } from "../utils/mergeFccTraceEntries";
import { readVisiblePollIntervalMs } from "../utils/adaptivePoll";

const POLL_MS = readVisiblePollIntervalMs(8000, 20000);

type Listener = () => void;

export type FccTracesStoreSnapshot = {
  traces: FccTraceEntry[];
  status: FreeClaudeCodeStatus | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
};

let traces: FccTraceEntry[] = [];
let status: FreeClaudeCodeStatus | null = null;
let loading = false;
let loadingMore = false;
let hasMore = false;
let snapshot: FccTracesStoreSnapshot = {
  traces,
  status,
  loading,
  loadingMore,
  hasMore,
};

let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollConsumers = 0;
let refreshInFlight = false;
const listeners = new Set<Listener>();

function tracesEqual(a: readonly FccTraceEntry[], b: readonly FccTraceEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.id !== b[i]?.id || a[i]?.timestampMs !== b[i]?.timestampMs) {
      return false;
    }
  }
  return true;
}

function statusFieldsEqual(
  a: FreeClaudeCodeStatus | null,
  b: FreeClaudeCodeStatus | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.serverRunning === b.serverRunning &&
    a.installed === b.installed &&
    a.proxyBaseUrl === b.proxyBaseUrl &&
    a.model === b.model &&
    a.claudeSettingsAligned === b.claudeSettingsAligned
  );
}

function publish(): void {
  snapshot = { traces, status, loading, loadingMore, hasMore };
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

async function refreshFccTracesStore(): Promise<void> {
  if (refreshInFlight) return;
  refreshInFlight = true;
  const nextLoading = status == null;
  if (nextLoading !== loading) {
    loading = nextLoading;
    publish();
  }
  try {
    const [nextStatus, newest] = await Promise.all([
      getFreeClaudeCodeStatus(),
      listFccTraces({ limit: FCC_TRACES_FETCH_LIMIT }),
    ]);
    const merged = mergeFccTraceEntries(traces, newest);
    const overCap = merged.length > FCC_TRACES_IN_MEMORY_MAX;
    if (overCap) {
      merged.splice(0, merged.length - FCC_TRACES_IN_MEMORY_MAX);
    }
    const changed =
      !statusFieldsEqual(status, nextStatus) || !tracesEqual(traces, merged);
    status = nextStatus;
    traces = merged;
    if (overCap) {
      hasMore = false;
    } else {
      const onlyInitialWindow = traces.length <= newest.length;
      if (onlyInitialWindow) {
        hasMore = newest.length >= FCC_TRACES_FETCH_LIMIT;
      }
    }
    if (changed || loading) {
      loading = false;
      publish();
    }
  } catch {
    if (loading) {
      loading = false;
      publish();
    }
  } finally {
    refreshInFlight = false;
  }
}

export function subscribeFccTracesStore(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getFccTracesStoreSnapshot(): FccTracesStoreSnapshot {
  return snapshot;
}

export function startFccTracesPolling(): void {
  pollConsumers += 1;
  if (pollTimer) return;
  void refreshFccTracesStore();
  pollTimer = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    void refreshFccTracesStore();
  }, POLL_MS);
}

export function stopFccTracesPolling(): void {
  pollConsumers = Math.max(0, pollConsumers - 1);
  if (pollConsumers > 0 || !pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

export async function refreshFccTracesStoreNow(): Promise<void> {
  await refreshFccTracesStore();
}

/** 滚动到底时加载更早一页（每页 {@link FCC_TRACES_FETCH_LIMIT} 条）。 */
export async function loadMoreFccTraces(): Promise<void> {
  if (loadingMore || !hasMore || traces.length === 0) return;
  const oldest = traces[traces.length - 1]?.timestampMs;
  if (oldest == null) return;

  loadingMore = true;
  publish();
  try {
    const older = await listFccTraces({
      limit: FCC_TRACES_FETCH_LIMIT,
      beforeMs: oldest,
    });
    const merged = mergeFccTraceEntries(traces, older);
    if (merged.length > FCC_TRACES_IN_MEMORY_MAX) {
      merged.splice(0, merged.length - FCC_TRACES_IN_MEMORY_MAX);
      hasMore = false;
    } else {
      hasMore = older.length >= FCC_TRACES_FETCH_LIMIT;
    }
    traces = merged;
    publish();
  } catch {
    publish();
  } finally {
    loadingMore = false;
    publish();
  }
}

export async function clearFccTracesStore(): Promise<void> {
  await clearFccTraces();
  traces = [];
  hasMore = false;
  publish();
}
