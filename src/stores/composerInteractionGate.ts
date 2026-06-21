/** 会话输入框聚焦/输入活跃：流式与其它侧栏刷新让路，减轻 Tiptap 卡顿。 */
let interactionActive = false;
let interactionUntilMs = 0;
let holdTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const INTERACTION_HOLD_MS = 420;

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function markComposerInteraction(): void {
  interactionUntilMs = performance.now() + INTERACTION_HOLD_MS;
  if (!interactionActive) {
    interactionActive = true;
    notify();
  }
  if (holdTimer) clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    holdTimer = null;
    if (performance.now() >= interactionUntilMs) {
      if (interactionActive) {
        interactionActive = false;
        notify();
      }
    }
  }, INTERACTION_HOLD_MS);
}

export function clearComposerInteraction(): void {
  interactionUntilMs = 0;
  if (interactionActive) {
    interactionActive = false;
    notify();
  }
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}

export function isComposerInteractionActive(): boolean {
  if (!interactionActive) return false;
  if (performance.now() >= interactionUntilMs) {
    interactionActive = false;
    notify();
    return false;
  }
  return true;
}

export function subscribeComposerInteraction(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/** 测试专用。 */
export function resetComposerInteractionGateForTests(): void {
  clearComposerInteraction();
  listeners.clear();
}
