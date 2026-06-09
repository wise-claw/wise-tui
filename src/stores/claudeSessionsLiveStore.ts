import { startTransition } from "react";
import { useSyncExternalStore } from "react";
import type { ClaudeSession } from "../types";
import { sessionsReactiveStructureKey } from "../utils/sessionConversationTasks";
import {
  isClaudeScrollInteractionActive,
  scheduleAfterScrollInteractionIdle,
} from "./claudeScrollInteractionGate";
import {
  isFileTreeScrollActive,
  isSidePanelPriorityReliefActive,
  isWorkspacePriorityReliefActive,
} from "./chromePanelHoverStore";

let sessionsSnapshot: ClaudeSession[] = [];
let structureKey = "";

const liveListeners = new Set<() => void>();
const structureListeners = new Set<() => void>();
const sessionLiveListeners = new Map<string, Set<() => void>>();
const pendingSessionLiveIds = new Set<string>();

/** live 订阅合并上限：侧栏 hover 时略降优先级，为 hit-test 让路。 */
function liveFlushMinIntervalMs(): number {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") {
    return 900;
  }
  if (isFileTreeScrollActive()) return 200;
  if (isWorkspacePriorityReliefActive()) return 195;
  if (isSidePanelPriorityReliefActive()) return 180;
  return 100;
}

let liveFlushRaf: number | null = null;
let liveFlushTimer: ReturnType<typeof setTimeout> | null = null;
let lastLiveFlushAt = 0;
let deferFlushWhileHidden = false;
let visibilityFlushHookAttached = false;

function attachVisibilityFlushHook(): void {
  if (visibilityFlushHookAttached || typeof document === "undefined") return;
  visibilityFlushHookAttached = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !deferFlushWhileHidden) return;
    deferFlushWhileHidden = false;
    scheduleLiveListenerFlush();
  });
}

function queueSessionLiveNotification(sessionId: string): void {
  pendingSessionLiveIds.add(sessionId);
}

function flushLiveListeners(): void {
  liveFlushRaf = null;
  if (liveFlushTimer !== null) {
    clearTimeout(liveFlushTimer);
    liveFlushTimer = null;
  }
  lastLiveFlushAt = typeof performance !== "undefined" ? performance.now() : 0;
  const sessionIds = [...pendingSessionLiveIds];
  pendingSessionLiveIds.clear();
  startTransition(() => {
    for (const listener of liveListeners) {
      listener();
    }
    for (const sessionId of sessionIds) {
      const listeners = sessionLiveListeners.get(sessionId);
      if (!listeners?.size) continue;
      for (const listener of listeners) {
        listener();
      }
    }
  });
}

function scheduleLiveListenerFlush(): void {
  if (liveListeners.size === 0 && sessionLiveListeners.size === 0) {
    pendingSessionLiveIds.clear();
    return;
  }
  if (pendingSessionLiveIds.size === 0 && liveListeners.size === 0) {
    return;
  }

  const runFlush = () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      deferFlushWhileHidden = true;
      attachVisibilityFlushHook();
      return;
    }
    deferFlushWhileHidden = false;
    if (isClaudeScrollInteractionActive()) {
      scheduleAfterScrollInteractionIdle(flushLiveListeners);
      return;
    }
    flushLiveListeners();
  };

  if (typeof window === "undefined") {
    runFlush();
    return;
  }

  const now = performance.now();
  const minInterval = liveFlushMinIntervalMs();
  const elapsed = now - lastLiveFlushAt;
  if (elapsed >= minInterval) {
    if (liveFlushRaf !== null) return;
    liveFlushRaf = window.requestAnimationFrame(runFlush);
    return;
  }

  if (liveFlushTimer !== null || liveFlushRaf !== null) return;
  liveFlushTimer = setTimeout(runFlush, minInterval - elapsed);
}

export function getClaudeSessionsSnapshot(): ClaudeSession[] {
  return sessionsSnapshot;
}

export function getClaudeSessionsStructureKey(): string {
  return structureKey;
}

export function publishClaudeSessions(next: ClaudeSession[]): void {
  const prev = sessionsSnapshot;
  sessionsSnapshot = next;

  const prevById = new Map(prev.map((session) => [session.id, session]));
  for (const session of next) {
    if (prevById.get(session.id) !== session) {
      queueSessionLiveNotification(session.id);
    }
  }

  if (liveListeners.size > 0 || sessionLiveListeners.size > 0 || pendingSessionLiveIds.size > 0) {
    scheduleLiveListenerFlush();
  }
  const nextStructureKey = sessionsReactiveStructureKey(next);
  if (nextStructureKey === structureKey) return;
  structureKey = nextStructureKey;
  for (const listener of structureListeners) {
    listener();
  }
}

export function subscribeClaudeSessionLive(sessionId: string, onStoreChange: () => void): () => void {
  let listeners = sessionLiveListeners.get(sessionId);
  if (!listeners) {
    listeners = new Set();
    sessionLiveListeners.set(sessionId, listeners);
  }
  listeners.add(onStoreChange);
  return () => {
    listeners!.delete(onStoreChange);
    if (listeners!.size === 0) {
      sessionLiveListeners.delete(sessionId);
    }
  };
}

export function getClaudeSessionSnapshot(sessionId: string): ClaudeSession | null {
  return sessionsSnapshot.find((session) => session.id === sessionId) ?? null;
}

export function subscribeClaudeSessionsLive(onStoreChange: () => void): () => void {
  liveListeners.add(onStoreChange);
  return () => {
    liveListeners.delete(onStoreChange);
  };
}

export function subscribeClaudeSessionsStructure(onStoreChange: () => void): () => void {
  structureListeners.add(onStoreChange);
  return () => {
    structureListeners.delete(onStoreChange);
  };
}

/** 聊天区 / 监控 transcript：`enabled` 为 false 时不订阅流式更新（只读当前快照）。 */
export function useClaudeSessionsLiveSnapshot(enabled = true): ClaudeSession[] {
  return useSyncExternalStore(
    (onStoreChange) => (enabled ? subscribeClaudeSessionsLive(onStoreChange) : () => {}),
    getClaudeSessionsSnapshot,
    getClaudeSessionsSnapshot,
  );
}

/** 单会话 live：其它会话流式时不触发本组件 reconcile。 */
export function useClaudeSessionLiveSnapshot(
  sessionId: string | null | undefined,
  enabled = true,
): ClaudeSession | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (!enabled || !sessionId) return () => {};
      return subscribeClaudeSessionLive(sessionId, onStoreChange);
    },
    () => (sessionId ? getClaudeSessionSnapshot(sessionId) : null),
    () => null,
  );
}

/** App 壳层：仅会话结构变化时更新。 */
export function useClaudeSessionsStructureKey(): string {
  return useSyncExternalStore(
    subscribeClaudeSessionsStructure,
    getClaudeSessionsStructureKey,
    getClaudeSessionsStructureKey,
  );
}
