import { congestionCheckRef } from "../utils/adaptivePoll";

/** rAF 帧间隔探测：主线程卡顿时段落时略降非关键 UI 刷新优先级。 */
let congested = false;
let congestedUntilMs = 0;
let lastFrameAt = 0;
let probeRaf = 0;
let probeStarted = false;
const listeners = new Set<() => void>();

/** 单帧耗时超过此值视为卡顿（约 20fps）。 */
const SLOW_FRAME_MS = 48;
/** 最后一帧慢速后保持拥塞标记的时长。 */
const CONGESTION_HOLD_MS = 650;

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function setCongested(next: boolean): void {
  if (congested === next) return;
  congested = next;
  notify();
}

function probeFrame(now: number): void {
  if (lastFrameAt > 0) {
    const delta = now - lastFrameAt;
    if (delta > SLOW_FRAME_MS) {
      congestedUntilMs = now + CONGESTION_HOLD_MS;
      setCongested(true);
    } else if (congested && now >= congestedUntilMs) {
      setCongested(false);
    }
  }
  lastFrameAt = now;
  probeRaf = requestAnimationFrame(probeFrame);
}

congestionCheckRef.current = isMainThreadCongested;

/** 启动全局帧探测（幂等，首屏后调用一次即可）。 */
export function ensureMainThreadCongestionProbe(): void {
  if (probeStarted || typeof window === "undefined") return;
  probeStarted = true;
  probeRaf = requestAnimationFrame(probeFrame);
}

export function isMainThreadCongested(): boolean {
  return congested;
}

export function subscribeMainThreadCongestion(onStoreChange: () => void): () => void {
  ensureMainThreadCongestionProbe();
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/** 测试专用：重置探测状态。 */
export function resetMainThreadCongestionStoreForTests(): void {
  congested = false;
  congestedUntilMs = 0;
  lastFrameAt = 0;
  if (probeRaf) {
    cancelAnimationFrame(probeRaf);
    probeRaf = 0;
  }
  probeStarted = false;
  listeners.clear();
}
