import { useSyncExternalStore } from "react";

const inFlightSessionIds = new Set<string>();
/**
 * 后台压缩（auto-compact / 手动 /compact）刚结束的时间戳（ms）。
 * `setBackgroundContextCompactInFlight(_, false)` 时同步落点；
 * `isWithinBackgroundCompactGraceWindow` 在
 * `nowMs - recentlyFinishedAt <= COMPACT_GRACE_WINDOW_MS` 内返回 true。
 *
 * 这是一个**节流信号**，专门给"压缩刚结束那一帧内"的队列 flush 收敛用——
 * 详见 src/components/ClaudeSessions/ClaudeChat.tsx 的
 * `flushPendingLaneDispatches`。grace 窗结束后行为完全沿用历史并行出队语义。
 */
const recentlyFinishedAt = new Map<string, number>();
const listeners = new Set<() => void>();
const MAX_RECENTLY_FINISHED_SESSIONS = 128;

/**
 * 后台压缩结束后的节流窗口（ms）。取值参考既有
 * `POST_CLAUDE_IDLE_PENDING_DISPATCH_DELAY_MS = 500`（src/components/ClaudeSessions/ClaudeChat.tsx:140），
 * 留 3× 余量以覆盖慢机器 + transcript 重载耗时。
 */
export const COMPACT_GRACE_WINDOW_MS = 1500;

function rememberRecentlyFinished(sessionId: string, at: number): void {
  recentlyFinishedAt.delete(sessionId);
  recentlyFinishedAt.set(sessionId, at);
  while (recentlyFinishedAt.size > MAX_RECENTLY_FINISHED_SESSIONS) {
    const oldest = recentlyFinishedAt.keys().next().value;
    if (oldest === undefined) break;
    recentlyFinishedAt.delete(oldest);
  }
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function setBackgroundContextCompactInFlight(sessionId: string, active: boolean): void {
  const key = sessionId.trim();
  if (!key) return;
  if (active) {
    if (inFlightSessionIds.has(key)) return;
    inFlightSessionIds.add(key);
    // 重新进入压缩 turn 时清掉旧的结束时间戳，避免跨 turn 的 grace 干扰。
    recentlyFinishedAt.delete(key);
  } else {
    if (!inFlightSessionIds.delete(key)) return;
    // 记录压缩刚结束的锚点，供 flush 节流使用（不触发额外 React 订阅）。
    rememberRecentlyFinished(key, Date.now());
  }
  emit();
}

export function isBackgroundContextCompactInFlight(sessionId: string): boolean {
  const key = sessionId.trim();
  return key.length > 0 && inFlightSessionIds.has(key);
}

/**
 * 后台压缩刚结束后的 grace window 内返回 true。
 * 调用者负责决定如何收敛出队并发：典型用法是 main lane 只派 head1、
 * 跨 lane 并行行为保留。nowMs 仅用于测试，生产环境省参走 Date.now()。
 */
export function isWithinBackgroundCompactGraceWindow(
  sessionId: string,
  nowMs: number = Date.now(),
): boolean {
  const key = sessionId.trim();
  if (!key) return false;
  const finishedAt = recentlyFinishedAt.get(key);
  if (finishedAt == null) return false;
  const elapsed = nowMs - finishedAt;
  // 系统时钟回拨时重新锚定，避免负 elapsed 让历史会话永久留在 grace window。
  if (elapsed < 0) {
    rememberRecentlyFinished(key, nowMs);
    return true;
  }
  if (elapsed <= COMPACT_GRACE_WINDOW_MS) return true;
  recentlyFinishedAt.delete(key);
  return false;
}

/** 会话关闭/裁剪时同步清理压缩信号，避免历史 tab id 常驻内存。 */
export function pruneBackgroundContextCompactSessions(liveSessionIds: ReadonlySet<string>): boolean {
  let changed = false;
  for (const key of inFlightSessionIds) {
    if (liveSessionIds.has(key)) continue;
    inFlightSessionIds.delete(key);
    changed = true;
  }
  for (const key of recentlyFinishedAt.keys()) {
    if (liveSessionIds.has(key)) continue;
    recentlyFinishedAt.delete(key);
    changed = true;
  }
  if (changed) emit();
  return changed;
}

export function useBackgroundContextCompactInFlight(sessionId: string): boolean {
  const key = sessionId.trim();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (key.length > 0 ? inFlightSessionIds.has(key) : false),
    () => false,
  );
}

/** @internal test helper */
export function resetBackgroundContextCompactStoreForTests(): void {
  inFlightSessionIds.clear();
  recentlyFinishedAt.clear();
  emit();
}
