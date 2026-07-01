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

/**
 * 后台压缩结束后的节流窗口（ms）。取值参考既有
 * `POST_CLAUDE_IDLE_PENDING_DISPATCH_DELAY_MS = 500`（src/components/ClaudeSessions/ClaudeChat.tsx:140），
 * 留 3× 余量以覆盖慢机器 + transcript 重载耗时。
 */
export const COMPACT_GRACE_WINDOW_MS = 1500;

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
    recentlyFinishedAt.set(key, Date.now());
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
  return nowMs - finishedAt <= COMPACT_GRACE_WINDOW_MS;
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
