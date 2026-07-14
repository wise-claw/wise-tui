import { OPERATION_STUCK_AFTER_MS } from "../utils/ipcTimeouts";
import { promiseWithTimeout } from "../utils/promiseWithTimeout";
import { dismissStuckAntOverlays } from "../utils/dismissStuckOverlays";

export interface TrackedOperation {
  id: string;
  label: string;
  startedAtMs: number;
  stuck: boolean;
}

type Listener = () => void;

const EMPTY_OPS: TrackedOperation[] = [];

let seq = 0;
const ops = new Map<string, TrackedOperation>();
const stuckTimers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<Listener>();

/** useSyncExternalStore 必须拿到引用稳定的 snapshot；禁止每次 get 都 new Array。 */
let trackedSnapshot: TrackedOperation[] = EMPTY_OPS;
let stuckSnapshot: TrackedOperation[] = EMPTY_OPS;

function rebuildSnapshots(): void {
  if (ops.size === 0) {
    trackedSnapshot = EMPTY_OPS;
    stuckSnapshot = EMPTY_OPS;
    return;
  }
  const next = [...ops.values()].sort((a, b) => a.startedAtMs - b.startedAtMs);
  trackedSnapshot = next;
  const nextStuck = next.filter((op) => op.stuck);
  stuckSnapshot = nextStuck.length === 0 ? EMPTY_OPS : nextStuck;
}

function notify(): void {
  rebuildSnapshots();
  for (const listener of listeners) {
    listener();
  }
}

export function beginTrackedOperation(label: string): string {
  const id = `op-${++seq}-${Date.now()}`;
  ops.set(id, {
    id,
    label,
    startedAtMs: Date.now(),
    stuck: false,
  });
  const timer = setTimeout(() => {
    const current = ops.get(id);
    if (!current || current.stuck) return;
    ops.set(id, { ...current, stuck: true });
    notify();
  }, OPERATION_STUCK_AFTER_MS);
  stuckTimers.set(id, timer);
  notify();
  return id;
}

export function endTrackedOperation(id: string): void {
  const timer = stuckTimers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    stuckTimers.delete(id);
  }
  if (!ops.delete(id)) return;
  notify();
}

/** 测试专用：立刻标记卡住。 */
export function markTrackedOperationStuckForTests(id: string): void {
  const current = ops.get(id);
  if (!current) return;
  const timer = stuckTimers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    stuckTimers.delete(id);
  }
  ops.set(id, { ...current, stuck: true });
  notify();
}

export function getTrackedOperationsSnapshot(): TrackedOperation[] {
  return trackedSnapshot;
}

export function getStuckOperationsSnapshot(): TrackedOperation[] {
  return stuckSnapshot;
}

export function subscribeTrackedOperations(onStoreChange: Listener): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/**
 * 用户主动解除：结束看门狗登记，并尽量关掉卡住的 Ant Design 遮罩。
 * 不会中断底层 Tauri invoke（IPC 无取消契约），但可恢复交互。
 */
export function dismissStuckOperations(): TrackedOperation[] {
  const stuck = stuckSnapshot;
  if (stuck.length === 0) {
    dismissStuckAntOverlays();
    return EMPTY_OPS;
  }
  const cleared = [...stuck];
  for (const op of cleared) {
    const timer = stuckTimers.get(op.id);
    if (timer !== undefined) {
      clearTimeout(timer);
      stuckTimers.delete(op.id);
    }
    ops.delete(op.id);
  }
  notify();
  dismissStuckAntOverlays();
  return cleared;
}

/** 登记并带超时跑任务；结束时自动注销（含超时/失败）。 */
export async function trackAsyncOperation<T>(
  label: string,
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const id = beginTrackedOperation(label);
  try {
    return await promiseWithTimeout(promise, timeoutMs, label);
  } finally {
    endTrackedOperation(id);
  }
}

/** 测试专用。 */
export function resetOperationWatchdogForTests(): void {
  for (const timer of stuckTimers.values()) {
    clearTimeout(timer);
  }
  stuckTimers.clear();
  ops.clear();
  seq = 0;
  trackedSnapshot = EMPTY_OPS;
  stuckSnapshot = EMPTY_OPS;
  for (const listener of listeners) {
    listener();
  }
}
