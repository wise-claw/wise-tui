import { useSyncExternalStore } from "react";

/**
 * 分钟级心跳：让侧栏「6m / 1d」这类相对时间自行走动，而不必等外部数据变更触发重渲染。
 * 全应用共用一个 interval；窗口不可见时停表，回到前台立即补一次。
 */
export const MINUTE_TICK_INTERVAL_MS = 60_000;

const listeners = new Set<() => void>();
let tick = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function documentRef(): Document | null {
  return typeof document === "undefined" ? null : document;
}

function isHidden(): boolean {
  const doc = documentRef();
  return doc != null && doc.visibilityState !== "visible";
}

function emit(): void {
  tick += 1;
  for (const listener of [...listeners]) listener();
}

function startTimer(): void {
  if (timer != null || isHidden()) return;
  timer = setInterval(() => {
    if (!isHidden()) emit();
  }, MINUTE_TICK_INTERVAL_MS);
}

function stopTimer(): void {
  if (timer == null) return;
  clearInterval(timer);
  timer = null;
}

function handleVisibilityChange(): void {
  if (isHidden()) {
    stopTimer();
    return;
  }
  emit();
  startTimer();
}

/** 外部订阅契约（React 之外也可直接用）。 */
export function subscribeMinuteTick(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    startTimer();
    documentRef()?.addEventListener("visibilitychange", handleVisibilityChange);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopTimer();
      documentRef()?.removeEventListener("visibilitychange", handleVisibilityChange);
    }
  };
}

export function getMinuteTick(): number {
  return tick;
}

/** 订阅分钟级心跳；返回值仅用于触发重渲染，无业务含义。 */
export function useMinuteTick(): number {
  return useSyncExternalStore(subscribeMinuteTick, getMinuteTick, getMinuteTick);
}

/** 仅测试使用：探测是否仍有活动定时器（防回归：无订阅者时不应空转）。 */
export function isMinuteTickTimerActiveForTests(): boolean {
  return timer != null;
}

/** 仅测试使用：重置模块级状态。 */
export function resetMinuteTickStoreForTests(): void {
  listeners.clear();
  stopTimer();
  tick = 0;
  documentRef()?.removeEventListener("visibilitychange", handleVisibilityChange);
}
