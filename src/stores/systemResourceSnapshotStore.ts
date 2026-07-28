import type { ClaudeHostProcess, SystemResourceSnapshot } from "../types";
import { getSystemResourceSnapshot } from "../services/systemResource";
import { startAdaptiveInterval } from "../utils/adaptivePoll";

const VISIBLE_POLL_INTERVAL_MS = 15_000;
const HIDDEN_POLL_INTERVAL_MS = 45_000;

export type SystemResourceSnapshotStoreState = {
  snapshot: SystemResourceSnapshot;
  error: boolean;
  generation: number;
};

const EMPTY_SNAPSHOT: SystemResourceSnapshot = {
  systemTotalBytes: 0,
  systemUsedBytes: 0,
  appMemoryBytes: 0,
  claudeProcessCount: 0,
  claudeMemoryBytes: 0,
  claudeProcesses: [],
};

type Listener = () => void;

let state: SystemResourceSnapshotStoreState = {
  snapshot: EMPTY_SNAPSHOT,
  error: false,
  generation: 0,
};
let consumers = 0;
let disposePoll: (() => void) | null = null;
let refreshInFlight: Promise<void> | null = null;
const listeners = new Set<Listener>();

function publish(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

function snapshotsEqual(a: SystemResourceSnapshot, b: SystemResourceSnapshot): boolean {
  if (
    a.systemTotalBytes !== b.systemTotalBytes
    || a.systemUsedBytes !== b.systemUsedBytes
    || a.appMemoryBytes !== b.appMemoryBytes
    || a.claudeProcessCount !== b.claudeProcessCount
    || a.claudeMemoryBytes !== b.claudeMemoryBytes
    || a.claudeProcesses.length !== b.claudeProcesses.length
  ) {
    return false;
  }
  return a.claudeProcesses.every((proc, index) => {
    const other = b.claudeProcesses[index];
    return (
      other != null
      && proc.pid === other.pid
      && proc.memoryBytes === other.memoryBytes
      && proc.sessionId === other.sessionId
      && proc.projectPath === other.projectPath
      && proc.sessionSource === other.sessionSource
    );
  });
}

async function refreshOnce(): Promise<void> {
  if (refreshInFlight) {
    await refreshInFlight;
    return;
  }
  refreshInFlight = (async () => {
    try {
      const next = await getSystemResourceSnapshot();
      const normalized: SystemResourceSnapshot = {
        ...next,
        claudeProcesses: next.claudeProcesses ?? [],
      };
      if (snapshotsEqual(state.snapshot, normalized) && !state.error) return;
      state = {
        snapshot: normalized,
        error: false,
        generation: state.generation + 1,
      };
      publish();
    } catch {
      if (!state.error) {
        state = {
          ...state,
          error: true,
          generation: state.generation + 1,
        };
        publish();
      }
    } finally {
      refreshInFlight = null;
    }
  })();
  await refreshInFlight;
}

function ensurePollLoop(): void {
  if (disposePoll || consumers <= 0) return;
  void refreshOnce();
  disposePoll = startAdaptiveInterval(
    () => {
      void refreshOnce();
    },
    VISIBLE_POLL_INTERVAL_MS,
    HIDDEN_POLL_INTERVAL_MS,
  );
}

function stopPollLoopIfIdle(): void {
  if (consumers > 0) return;
  if (disposePoll) {
    disposePoll();
    disposePoll = null;
  }
}

function acquireConsumer(): void {
  consumers += 1;
  ensurePollLoop();
}

function releaseConsumer(): void {
  consumers = Math.max(0, consumers - 1);
  stopPollLoopIfIdle();
}

export function subscribeSystemResourceSnapshot(listener: Listener): () => void {
  acquireConsumer();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    releaseConsumer();
  };
}

export function getSystemResourceSnapshotStoreState(): SystemResourceSnapshotStoreState {
  return state;
}

export function getSystemResourceSnapshotStoreSnapshot(): SystemResourceSnapshot {
  return state.snapshot;
}

export function getSystemResourceClaudeProcesses(): readonly ClaudeHostProcess[] {
  return state.snapshot.claudeProcesses;
}

/** Force a refresh (one-shot actions / immediate sync). Safe to call without consumers. */
export function refreshSystemResourceSnapshotStore(): Promise<void> {
  return refreshOnce();
}

/** @internal test helper */
export function resetSystemResourceSnapshotStoreForTests(): void {
  if (disposePoll) {
    disposePoll();
    disposePoll = null;
  }
  state = {
    snapshot: EMPTY_SNAPSHOT,
    error: false,
    generation: 0,
  };
  consumers = 0;
  refreshInFlight = null;
  listeners.clear();
}
