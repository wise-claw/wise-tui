/** 会话输入框聚焦/输入活跃：流式与其它侧栏刷新让路，减轻 Tiptap 卡顿。 */
let composerFocused = false;
let interactionActive = false;
let interactionUntilMs = 0;
let holdTimer: ReturnType<typeof setTimeout> | null = null;
let deferDrainRaf: number | null = null;
let deferPollTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const pendingDeferredRuns: Array<() => void> = [];

/** 按键后短暂保持「正在输入」硬推迟窗。 */
const INTERACTION_HOLD_MS = 480;

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function setInteractionActive(next: boolean): void {
  if (interactionActive === next) return;
  interactionActive = next;
  notify();
}

function syncActiveFromClocks(): void {
  const next = composerFocused || performance.now() < interactionUntilMs;
  setInteractionActive(next);
}

export function markComposerFocused(focused: boolean): void {
  if (composerFocused === focused) return;
  composerFocused = focused;
  syncActiveFromClocks();
  if (!focused) {
    ensureDeferredDrainScheduled();
  }
}

export function markComposerInteraction(): void {
  interactionUntilMs = performance.now() + INTERACTION_HOLD_MS;
  setInteractionActive(true);
  if (holdTimer) clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    holdTimer = null;
    syncActiveFromClocks();
    if (!isComposerTypingActive()) {
      ensureDeferredDrainScheduled();
    }
  }, INTERACTION_HOLD_MS);
}

export function clearComposerInteraction(): void {
  composerFocused = false;
  interactionUntilMs = 0;
  setInteractionActive(false);
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
  ensureDeferredDrainScheduled();
}

/** 纯查询：不在 getter 里 notify，避免 live flush 调度路径触发订阅风暴。 */
export function isComposerInteractionActive(): boolean {
  if (composerFocused) return true;
  return isComposerTypingActive();
}

/** 最近按键/输入的硬推迟窗（不含「仅聚焦看流式」）。 */
export function isComposerTypingActive(): boolean {
  return performance.now() < interactionUntilMs;
}

export function subscribeComposerInteraction(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function drainDeferredRuns(): void {
  deferDrainRaf = null;
  if (isComposerTypingActive()) {
    if (deferPollTimer !== null) return;
    deferPollTimer = setTimeout(() => {
      deferPollTimer = null;
      ensureDeferredDrainScheduled();
    }, 40);
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
}

function ensureDeferredDrainScheduled(): void {
  if (deferDrainRaf !== null || deferPollTimer !== null) return;
  if (pendingDeferredRuns.length === 0) return;
  if (typeof requestAnimationFrame === "undefined") {
    drainDeferredRuns();
    return;
  }
  deferDrainRaf = requestAnimationFrame(drainDeferredRuns);
}

/**
 * 正在输入时推迟 live flush，空闲后再补一帧，避免与 Tiptap 抢主线程。
 * 「仅聚焦」不走硬推迟——用户盯着流式时仍要更新，改由合并间隔软节流。
 */
export function scheduleAfterComposerInteractionIdle(run: () => void): void {
  if (!isComposerTypingActive()) {
    run();
    return;
  }
  pendingDeferredRuns.push(run);
  if (holdTimer === null) {
    const remaining = Math.max(16, interactionUntilMs - performance.now());
    holdTimer = setTimeout(() => {
      holdTimer = null;
      syncActiveFromClocks();
      ensureDeferredDrainScheduled();
    }, remaining);
  }
  ensureDeferredDrainScheduled();
}

/** 测试专用。 */
export function resetComposerInteractionGateForTests(): void {
  clearComposerInteraction();
  pendingDeferredRuns.length = 0;
  if (deferDrainRaf !== null && typeof cancelAnimationFrame !== "undefined") {
    cancelAnimationFrame(deferDrainRaf);
    deferDrainRaf = null;
  }
  if (deferPollTimer !== null) {
    clearTimeout(deferPollTimer);
    deferPollTimer = null;
  }
  listeners.clear();
}
