/** 聊天消息区滚动活跃窗口：流式 live 刷新让路。仅 ClaudeChatMessagesPane 应触发。 */
let scrollDeferUntilMs = 0;
let deferTimer: ReturnType<typeof setTimeout> | null = null;
let deferDrainRaf: number | null = null;
const deferListeners = new Set<() => void>();
const pendingDeferredRuns: Array<() => void> = [];

const SCROLL_INTERACTION_HOLD_MS = 280;

export function markClaudeScrollInteraction(): void {
  scrollDeferUntilMs = performance.now() + SCROLL_INTERACTION_HOLD_MS;
}

export function isClaudeScrollInteractionActive(): boolean {
  return performance.now() < scrollDeferUntilMs;
}

export function subscribeClaudeScrollInteractionDefer(onStoreChange: () => void): () => void {
  deferListeners.add(onStoreChange);
  return () => {
    deferListeners.delete(onStoreChange);
  };
}

function drainDeferredRuns(): void {
  deferDrainRaf = null;
  if (isClaudeScrollInteractionActive()) {
    deferTimer = setTimeout(() => {
      deferTimer = null;
      ensureDeferredDrainScheduled();
    }, 32);
    return;
  }
  const next = pendingDeferredRuns.shift();
  if (next) {
    next();
  }
  if (pendingDeferredRuns.length > 0) {
    deferDrainRaf = requestAnimationFrame(drainDeferredRuns);
    return;
  }
  for (const listener of deferListeners) {
    listener();
  }
}

function ensureDeferredDrainScheduled(): void {
  if (deferDrainRaf !== null || deferTimer !== null) return;
  if (pendingDeferredRuns.length === 0 && deferListeners.size === 0) return;
  deferDrainRaf = requestAnimationFrame(drainDeferredRuns);
}

export function scheduleAfterScrollInteractionIdle(run: () => void): void {
  if (!isClaudeScrollInteractionActive()) {
    run();
    return;
  }
  pendingDeferredRuns.push(run);
  if (deferTimer !== null) return;
  deferTimer = setTimeout(() => {
    deferTimer = null;
    ensureDeferredDrainScheduled();
  }, SCROLL_INTERACTION_HOLD_MS);
}
