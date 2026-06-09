import { getOpencodeGoProxyStatus } from "../services/opencodeGoProxy";
import {
  clearOpencodeGoProxyTraces,
  listOpencodeGoProxyTraces,
} from "../services/opencodeGoProxyTraces";
import type { OpencodeGoProxyTraceEntry } from "../types/opencodeGoProxyTrace";
import { startAdaptiveInterval } from "../utils/adaptivePoll";
import { runWhenIdle } from "../utils/deferIdle";

const VISIBLE_POLL_MS = 5000;
const HIDDEN_POLL_MS = 10_000;

type Listener = () => void;

export type OpencodeGoProxyTracesStoreSnapshot = {
  traces: OpencodeGoProxyTraceEntry[];
  running: boolean;
  loading: boolean;
};

let traces: OpencodeGoProxyTraceEntry[] = [];
let running = false;
let loading = false;
let snapshot: OpencodeGoProxyTracesStoreSnapshot = { traces, running, loading };

let disposePoll: (() => void) | null = null;
let pollConsumers = 0;
let refreshInFlight = false;
const listeners = new Set<Listener>();

function publish(): void {
  snapshot = { traces, running, loading };
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

function tracesEqual(
  a: readonly OpencodeGoProxyTraceEntry[],
  b: readonly OpencodeGoProxyTraceEntry[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.id !== b[i]?.id || a[i]?.timestampMs !== b[i]?.timestampMs) {
      return false;
    }
  }
  return true;
}

async function refreshStore(): Promise<void> {
  if (refreshInFlight) return;
  refreshInFlight = true;
  const nextLoading = traces.length === 0 && !running;
  if (nextLoading !== loading) {
    loading = nextLoading;
    publish();
  }
  try {
    const [st, nextTraces] = await Promise.all([
      getOpencodeGoProxyStatus(),
      listOpencodeGoProxyTraces({ limit: 200 }),
    ]);
    const nextRunning = Boolean(st.enabled && st.running);
    let changed = nextRunning !== running;
    running = nextRunning;
    if (!tracesEqual(traces, nextTraces)) {
      traces = nextTraces;
      changed = true;
    }
    if (changed || loading) {
      loading = false;
      publish();
    }
  } catch {
    loading = false;
    publish();
  } finally {
    refreshInFlight = false;
  }
}

export function subscribeOpencodeGoProxyTracesStore(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOpencodeGoProxyTracesStoreSnapshot(): OpencodeGoProxyTracesStoreSnapshot {
  return snapshot;
}

export function startOpencodeGoProxyTracesPolling(): void {
  pollConsumers += 1;
  if (disposePoll) return;
  void refreshStore();
  disposePoll = startAdaptiveInterval(
    () => {
      runWhenIdle(() => {
        void refreshStore();
      });
    },
    VISIBLE_POLL_MS,
    HIDDEN_POLL_MS,
  );
}

export function stopOpencodeGoProxyTracesPolling(): void {
  pollConsumers = Math.max(0, pollConsumers - 1);
  if (pollConsumers > 0 || !disposePoll) return;
  disposePoll();
  disposePoll = null;
}

export async function refreshOpencodeGoProxyTracesStoreNow(): Promise<void> {
  await refreshStore();
}

export async function clearOpencodeGoProxyTracesStore(): Promise<void> {
  await clearOpencodeGoProxyTraces();
  traces = [];
  publish();
  await refreshStore();
}
