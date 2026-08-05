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
  isChromeScrollReliefActive,
  scheduleAfterChromeScrollIdle,
} from "./chromePanelHoverStore";
import {
  isComposerInteractionActive,
  isComposerTypingActive,
  scheduleAfterComposerInteractionIdle,
} from "./composerInteractionGate";
import { isMainThreadCongested } from "./mainThreadCongestionStore";
import { getClaudeChatUserPausedFollow } from "./claudeChatMessageScrollBridge";

let sessionsSnapshot: ClaudeSession[] = [];
let structureKey = "";
/** id → session 索引：供 getClaudeSessionSnapshot O(1) 查询。流式期间每个聊天标签的 live host
 *  每帧经 useSyncExternalStore 调 getSnapshot，原 find 为 O(n)，多标签时累积成持续主线程开销。
 *  仅索引 id；claudeSessionId 查询少见，仍走 find 兜底，行为不变。 */
let sessionById = new Map<string, ClaudeSession>();

const liveListeners = new Set<() => void>();
const structureListeners = new Set<() => void>();
const sessionLiveListeners = new Map<string, Set<() => void>>();
const pendingSessionLiveIds = new Set<string>();

/** live 订阅合并上限：侧栏 hover 时略降优先级，为 hit-test 让路。 */
function liveFlushMinIntervalMs(): number {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") {
    return 900;
  }
  if (isMainThreadCongested()) return 800;
  // 正在输入：硬推迟窗之外仍拉长合并；仅聚焦看流式则软节流。
  if (isComposerTypingActive()) return 640;
  if (isComposerInteractionActive()) return 220;
  // 滚动硬推迟之外的兜底合并窗。
  if (isFileTreeScrollActive()) return 320;
  if (isWorkspacePriorityReliefActive()) return 280;
  if (isSidePanelPriorityReliefActive()) return 240;
  // 多会话同时有 pending live 时拉长合并窗口，避免 N 路流式把主线程打满。
  const multiSessionLive = pendingSessionLiveIds.size > 1;
  // 消息列表正在贴底跟随时加快 flush，降低「字顿一下才出来」的体感延迟。
  if (!getClaudeChatUserPausedFollow()) {
    return multiSessionLive ? 96 : 48;
  }
  return multiSessionLive ? 160 : 100;
}

let liveFlushRaf: number | null = null;
let liveFlushTimer: ReturnType<typeof setTimeout> | null = null;
let lastLiveFlushAt = 0;
let deferFlushWhileHidden = false;
let visibilityFlushHookAttached = false;
let structureFlushRaf: number | null = null;

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
  // 后台会话流式时也会入队；若当前没有任何 live 订阅者，跳过 startTransition。
  let hasWork = liveListeners.size > 0;
  if (!hasWork) {
    for (const sessionId of sessionIds) {
      if (sessionLiveListeners.get(sessionId)?.size) {
        hasWork = true;
        break;
      }
    }
  }
  if (!hasWork) return;
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
    if (isComposerTypingActive()) {
      scheduleAfterComposerInteractionIdle(flushLiveListeners);
      return;
    }
    if (isChromeScrollReliefActive()) {
      scheduleAfterChromeScrollIdle(flushLiveListeners);
      return;
    }
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

function flushStructureListeners(): void {
  structureFlushRaf = null;
  for (const listener of structureListeners) {
    listener();
  }
}

function scheduleStructureListenerFlush(): void {
  if (structureListeners.size === 0) return;
  // 隐藏时 rAF 不触发，立即通知
  if (typeof document !== "undefined" && document.visibilityState !== "visible") {
    flushStructureListeners();
    return;
  }
  if (typeof window === "undefined") {
    flushStructureListeners();
    return;
  }
  if (structureFlushRaf !== null) return;
  structureFlushRaf = window.requestAnimationFrame(flushStructureListeners);
}

export function getClaudeSessionsSnapshot(): ClaudeSession[] {
  return sessionsSnapshot;
}

export function getClaudeSessionsStructureKey(): string {
  return structureKey;
}

export function publishClaudeSessions(next: ClaudeSession[]): void {
  sessionsSnapshot = next;

  // 复用上一轮 id 索引做 diff，避免每帧再扫一遍 prev 建 Map（多会话流式时 O(n) 翻倍）。
  const prevById = sessionById;
  const nextById = new Map<string, ClaudeSession>();
  for (const session of next) {
    nextById.set(session.id, session);
    if (prevById.get(session.id) !== session) {
      queueSessionLiveNotification(session.id);
    }
  }
  sessionById = nextById;

  if (liveListeners.size > 0 || sessionLiveListeners.size > 0 || pendingSessionLiveIds.size > 0) {
    scheduleLiveListenerFlush();
  }
  const nextStructureKey = sessionsReactiveStructureKey(next);
  if (nextStructureKey === structureKey) return;
  structureKey = nextStructureKey;
  scheduleStructureListenerFlush();
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
  const trimmed = sessionId.trim();
  if (!trimmed) return null;
  const byId = sessionById.get(trimmed);
  if (byId) return byId;
  return (
    sessionsSnapshot.find((session) => session.id === trimmed || session.claudeSessionId === trimmed) ??
    null
  );
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

const noopSubscribe = (): (() => void) => () => {};

/** 聊天区 / 监控 transcript：`enabled` 为 false 时不订阅流式更新（只读当前快照）。 */
export function useClaudeSessionsLiveSnapshot(enabled = true): ClaudeSession[] {
  return useSyncExternalStore(
    (onStoreChange) => (enabled ? subscribeClaudeSessionsLive(onStoreChange) : noopSubscribe),
    getClaudeSessionsSnapshot,
    getClaudeSessionsSnapshot,
  );
}

/**
 * 进程列表 / 运行面板列表：仅结构变化时刷新。
 * 流式正文不会 notify；勿用于需要逐 token 更新的 transcript。
 */
export function useClaudeSessionsStructureSnapshot(enabled = true): ClaudeSession[] {
  return useSyncExternalStore(
    (onStoreChange) => (enabled ? subscribeClaudeSessionsStructure(onStoreChange) : noopSubscribe),
    getClaudeSessionsSnapshot,
    getClaudeSessionsSnapshot,
  );
}

/** 单会话 live：其它会话流式时不触发本组件 reconcile。 */
export function useClaudeSessionLiveSnapshot(
  sessionId: string | null | undefined,
  enabled = true,
): ClaudeSession | null {
  const trimmed = sessionId?.trim() || "";
  // 即使 enabled=false 也解析当前快照（离屏冻结展示），只是不订阅后续 live。
  const resolved = trimmed ? getClaudeSessionSnapshot(trimmed) : null;
  const canonicalId = resolved?.id ?? trimmed;
  // 仅在「尚未解析到会话」且需要 live 时订 structure，等会话出现后再落到 per-session live。
  // 已知 tab id / 已解析别名时不订，避免任意会话结构变化打穿消息列表宿主。
  const awaitAppearance = Boolean(enabled && trimmed && !resolved);
  const structureKey = useSyncExternalStore(
    (onStoreChange) =>
      awaitAppearance ? subscribeClaudeSessionsStructure(onStoreChange) : noopSubscribe,
    getClaudeSessionsStructureKey,
    getClaudeSessionsStructureKey,
  );
  void structureKey;

  return useSyncExternalStore(
    (onStoreChange) => {
      if (!enabled || !canonicalId) return noopSubscribe;
      return subscribeClaudeSessionLive(canonicalId, onStoreChange);
    },
    () => (canonicalId ? getClaudeSessionSnapshot(canonicalId) : null),
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
