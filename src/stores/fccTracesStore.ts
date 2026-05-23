import type { FreeClaudeCodeStatus } from "../services/freeClaudeCode";
import { getFreeClaudeCodeStatus } from "../services/freeClaudeCode";
import { clearFccTraces, listFccTraces } from "../services/fccTraces";
import type { FccTraceEntry } from "../types/fccTrace";

const MAX_TRACES = 200;
const POLL_MS = 2000;

type Listener = () => void;

type StoreSnapshot = {
  traces: FccTraceEntry[];
  status: FreeClaudeCodeStatus | null;
  loading: boolean;
};

let traces: FccTraceEntry[] = [];
let status: FreeClaudeCodeStatus | null = null;
let loading = false;
let snapshot: StoreSnapshot = { traces, status, loading };

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
  snapshot = { traces, status, loading };
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
    const [nextStatus, nextTraces] = await Promise.all([
      getFreeClaudeCodeStatus(),
      listFccTraces({ limit: MAX_TRACES }),
    ]);
    const capped = nextTraces.slice(0, MAX_TRACES);
    const changed =
      !statusFieldsEqual(status, nextStatus) || !tracesEqual(traces, capped);
    status = nextStatus;
    traces = capped;
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

export function getFccTracesStoreSnapshot(): StoreSnapshot {
  return snapshot;
}

export function startFccTracesPolling(): void {
  pollConsumers += 1;
  if (pollTimer) return;
  void refreshFccTracesStore();
  pollTimer = setInterval(() => {
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

export async function clearFccTracesStore(): Promise<void> {
  await clearFccTraces();
  traces = [];
  publish();
}
