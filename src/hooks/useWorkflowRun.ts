import { useEffect, useState } from "react";
import type { WorkflowRunDTO } from "../types/workflow";
import { getWorkflowFacade } from "../services/workflow";
import { promiseWithTimeout } from "../utils/promiseWithTimeout";

interface WorkflowRunSnapshot {
  run: WorkflowRunDTO | null;
  pollIntervalMs: number;
  inFlight: boolean;
}

type Listener = (snapshot: WorkflowRunSnapshot) => void;

interface Entry {
  run: WorkflowRunDTO | null;
  listeners: Set<Listener>;
  timer: number | null;
  refCount: number;
  requestSeq: number;
  inFlight: boolean;
  inFlightPromise: Promise<void> | null;
  refreshQueued: boolean;
  backoffMs: number;
  stopped: boolean;
}

const POLL_MS = 3000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 30_000;
const cache = new Map<string, Entry>();

/** Claude 会话 tab id 迁移后按仓库清理缓存，避免仍用旧 `sessionId` 拉取 workflow run。 */
export function invalidateWorkflowRunCacheForRepository(repositoryPath: string): void {
  const trimmed = repositoryPath.trim();
  if (!trimmed) return;
  const suffix = `@@${trimmed}`;
  for (const key of [...cache.keys()]) {
    if (!key.endsWith(suffix)) continue;
    const entry = cache.get(key);
    if (entry) entry.stopped = true;
    if (entry?.timer != null) {
      window.clearTimeout(entry.timer);
    }
    cache.delete(key);
  }
}

function emitEntry(entry: Entry): void {
  const snapshot: WorkflowRunSnapshot = {
    run: entry.run,
    pollIntervalMs: entry.backoffMs,
    inFlight: entry.inFlight,
  };
  for (const listener of entry.listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn("[wise:workflow-run] listener threw", error);
    }
  }
}

function keyOf(sessionId: string, repositoryPath: string): string {
  return `${sessionId}@@${repositoryPath}`;
}

async function fetchRun(sessionId: string, repositoryPath: string): Promise<WorkflowRunDTO | null> {
  const facade = getWorkflowFacade();
  const listed = await facade.listRuns({ repositoryPath, limit: 100 });
  if (!listed.ok) return null;
  const bound = listed.data.find((item) => item.sessionId === sessionId);
  if (!bound) return null;
  const detail = await facade.getRun({ workflowRunId: bound.workflowRunId });
  return detail.ok ? detail.data : null;
}

async function fetchRunWithTimeout(sessionId: string, repositoryPath: string): Promise<WorkflowRunDTO | null> {
  // promiseWithTimeout 会在请求提前完成时清理 timeout；旧实现每次轮询都让 10s timer 留到触发。
  return await promiseWithTimeout(
    fetchRun(sessionId, repositoryPath),
    FETCH_TIMEOUT_MS,
    "加载工作流运行状态",
  );
}

function refreshEntry(sessionId: string, repositoryPath: string): Promise<void> {
  const key = keyOf(sessionId, repositoryPath);
  const entry = cache.get(key);
  if (!entry || entry.stopped) return Promise.resolve();
  if (entry.inFlightPromise) {
    // 高频 DB 写事件只合并为一次补拉，避免同 session 的 listRuns/getRun 重叠堆积。
    entry.refreshQueued = true;
    return entry.inFlightPromise;
  }

  const task = (async () => {
    entry.inFlight = true;
    emitEntry(entry);
    try {
      do {
        entry.refreshQueued = false;
        const nextSeq = entry.requestSeq + 1;
        entry.requestSeq = nextSeq;
        const run = await fetchRunWithTimeout(sessionId, repositoryPath);
        const latest = cache.get(key);
        if (!latest || latest !== entry || latest.stopped) return;
        if (latest.requestSeq === nextSeq) {
          latest.run = run;
          emitEntry(latest);
        }
      } while (entry.refreshQueued && !entry.stopped && cache.get(key) === entry);
    } finally {
      const latest = cache.get(key);
      if (latest === entry) {
        latest.inFlight = false;
        latest.inFlightPromise = null;
        emitEntry(latest);
      }
    }
  })();
  entry.inFlightPromise = task;
  return task;
}

function scheduleNextRefresh(sessionId: string, repositoryPath: string): void {
  const key = keyOf(sessionId, repositoryPath);
  const entry = cache.get(key);
  if (!entry || entry.stopped) return;
  if (entry.timer != null) {
    window.clearTimeout(entry.timer);
  }
  entry.timer = window.setTimeout(() => {
    const current = cache.get(key);
    if (!current || current.stopped) return;
    current.timer = null;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      // 隐藏窗口不访问 DB；保留低频唤醒以便无 visibility 事件的 WebView 也能自愈。
      current.backoffMs = MAX_BACKOFF_MS;
      scheduleNextRefresh(sessionId, repositoryPath);
      return;
    }
    void refreshEntry(sessionId, repositoryPath)
      .then(() => {
        const latest = cache.get(key);
        if (!latest || latest.stopped) return;
        latest.backoffMs = POLL_MS;
        emitEntry(latest);
      })
      .catch(() => {
        const latest = cache.get(key);
        if (!latest || latest.stopped) return;
        latest.backoffMs = Math.min(MAX_BACKOFF_MS, Math.max(POLL_MS, latest.backoffMs * 2));
        emitEntry(latest);
      })
      .finally(() => {
        scheduleNextRefresh(sessionId, repositoryPath);
      });
  }, entry.backoffMs);
}

function ensureEntry(sessionId: string, repositoryPath: string): Entry {
  const key = keyOf(sessionId, repositoryPath);
  const existing = cache.get(key);
  if (existing) return existing;
  const created: Entry = {
    run: null,
    listeners: new Set(),
    timer: null,
    refCount: 0,
    requestSeq: 0,
    inFlight: false,
    inFlightPromise: null,
    refreshQueued: false,
    backoffMs: POLL_MS,
    stopped: false,
  };
  cache.set(key, created);
  return created;
}

export function useWorkflowRun(sessionId: string, repositoryPath: string) {
  const [run, setRun] = useState<WorkflowRunDTO | null>(null);
  const [pollIntervalMs, setPollIntervalMs] = useState(POLL_MS);
  const [pollInFlight, setPollInFlight] = useState(false);

  useEffect(() => {
    if (!sessionId || !repositoryPath) {
      setRun(null);
      setPollIntervalMs(POLL_MS);
      setPollInFlight(false);
      return;
    }
    const entry = ensureEntry(sessionId, repositoryPath);
    entry.refCount += 1;
    const listener: Listener = (snapshot) => {
      setRun(snapshot.run);
      setPollIntervalMs(snapshot.pollIntervalMs);
      setPollInFlight(snapshot.inFlight);
    };
    entry.listeners.add(listener);
    listener({
      run: entry.run,
      pollIntervalMs: entry.backoffMs,
      inFlight: entry.inFlight,
    });

    if (entry.timer == null) {
      entry.stopped = false;
      void refreshEntry(sessionId, repositoryPath)
        .then(() => {
          const latest = cache.get(keyOf(sessionId, repositoryPath));
          if (!latest || latest.stopped) return;
          latest.backoffMs = POLL_MS;
          emitEntry(latest);
        })
        .catch(() => {
          const latest = cache.get(keyOf(sessionId, repositoryPath));
          if (!latest || latest.stopped) return;
          latest.backoffMs = Math.min(MAX_BACKOFF_MS, Math.max(POLL_MS, latest.backoffMs * 2));
          emitEntry(latest);
        })
        .finally(() => {
          scheduleNextRefresh(sessionId, repositoryPath);
        });
    }

    return () => {
      const key = keyOf(sessionId, repositoryPath);
      const current = cache.get(key);
      if (!current) return;
      current.listeners.delete(listener);
      current.refCount -= 1;
      if (current.refCount <= 0) {
        current.stopped = true;
        current.refreshQueued = false;
        if (current.timer != null) window.clearTimeout(current.timer);
        cache.delete(key);
      }
    };
  }, [sessionId, repositoryPath]);

  async function refreshNow() {
    await refreshEntry(sessionId, repositoryPath);
  }

  return {
    run,
    refreshNow,
    poll: {
      intervalMs: pollIntervalMs,
      inFlight: pollInFlight,
      isBackingOff: pollIntervalMs > POLL_MS,
    },
  };
}

/** 工作流快照在应用内被直接更新后触发一次拉取（如其它路径写入 `workflow_runs`）。 */
export function requestWorkflowRunRefresh(sessionId: string, repositoryPath: string): void {
  const sid = sessionId.trim();
  const rp = repositoryPath.trim();
  if (!sid || !rp) return;
  void refreshEntry(sid, rp).catch((error) => {
    console.warn("[wise:workflow-run] immediate refresh failed", error);
  });
}
