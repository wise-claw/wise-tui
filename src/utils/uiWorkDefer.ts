import { isComposerInteractionActive } from "../stores/composerInteractionGate";
import { isMainThreadCongested } from "../stores/mainThreadCongestionStore";

/** 输入框活跃或主线程拥塞：推迟非关键 UI 工作（Monaco 挂载、上下文环等）。 */
export function shouldDeferNonCriticalUiWork(): boolean {
  return isMainThreadCongested() || isComposerInteractionActive();
}

export function resolveMonacoIdleDeferTimeoutMs(baseMs: number): number {
  if (isMainThreadCongested()) return Math.max(baseMs, 360);
  if (isComposerInteractionActive()) return Math.max(baseMs, 200);
  return baseMs;
}
