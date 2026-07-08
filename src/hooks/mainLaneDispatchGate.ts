/**
 * Main lane 派发握手门闸
 *
 * 为什么需要它
 * ------------
 * `dispatchPendingTask` 在 `onExecute` resolve 后立即释放
 * `pendingQueueDispatchInFlightLanesRef.delete("main")`，但 `session.status` 翻
 * running 是 store 同步翻 + React 异步重渲染：闭包里 `session.status` 仍是 idle。
 * gate 期间 `canDispatchHead(main)` 仍判定为可派发，下一个 microtask flush 把
 * 队列里剩余 main 任务一次性派完。
 *
 * 这个 gate 把 "已派发但 status 未翻 active" 的窗口显式记录：canDispatch 仅在
 * gate 释放（status 翻 active / 5s timeout 兜底 / 显式 cancel）后才返回 true。
 *
 * 与 `pendingQueueDispatchInFlightLanesRef` 的区别：
 * - 后者覆盖所有 lane（main / employee / team），在 finally 释放语义不变。
 * - gate 只针对 main lane，释放时机与 status 翻转绑定，绕开 React 重渲染 race。
 *
 * 复用方式：`src/components/ClaudeSessions/ClaudeChat.tsx` 内 `useRef` 持有，
 * 配合 status effect 与定时器 effect 使用。
 */

const DEFAULT_TTL_MS = 5_000;

/** main lane 派发记录。 */
export interface MainLaneDispatchRecord {
  taskId: string;
  dispatchedAt: number;
}

/** gate 行为接口。 */
export interface MainLaneDispatchGate {
  /**
   * 派发时打点：记录当前 main lane 处于「已派但 status 未翻 active」窗口。
   * 多次调用以 latest-wins 覆盖（防止前一条 task 异常未释放时新派发也卡住）。
   */
  markDispatched(taskId: string, now?: number): void;
  /**
   * 显式释放：例如 `started === false` 并发阻断路径在 `await` resolve 立即调用，
   * 避免 hold 死锁后续派发。幂等。
   */
  release(): MainLaneDispatchRecord | null;
  /**
   * `canDispatchHead(main)` 判定使用。gate 持有期间返回 false。
   */
  canDispatch(): boolean;
  /**
   * status effect 在 `!prev && active`（idle→running）时调用。
   * 仅在当前确实有 record 时释放；返回被释放的 record（用于打点/单测），无 record 时返回 null。
   */
  releaseIfMatchesActive(activeNow: boolean): MainLaneDispatchRecord | null;
  /**
   * timeout 兜底：定时器 effect 每隔 1s 调一次。`now - dispatchedAt >= ttlMs`
   * 时释放并返回 record；否则 no-op。
   */
  releaseIfExpired(now: number, ttlMs?: number): MainLaneDispatchRecord | null;
  /** 当前持有 record（仅测试/调试用）。 */
  peek(): MainLaneDispatchRecord | null;
}

export interface CreateMainLaneDispatchGateOptions {
  /** 注入时间源，便于单测。默认 `Date.now`。 */
  now?: () => number;
  /** 注入 TTL，便于单测覆盖极小值。默认 5000。 */
  ttlMs?: number;
}

export function createMainLaneDispatchGate(
  options: CreateMainLaneDispatchGateOptions = {},
): MainLaneDispatchGate {
  const now = options.now ?? Date.now;
  const defaultTtlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  let current: MainLaneDispatchRecord | null = null;

  function clearRecord(): MainLaneDispatchRecord | null {
    if (current === null) return null;
    const released = current;
    current = null;
    return released;
  }

  return {
    markDispatched(taskId: string, markAt?: number) {
      current = {
        taskId,
        dispatchedAt: typeof markAt === "number" ? markAt : now(),
      };
    },
    release() {
      return clearRecord();
    },
    canDispatch() {
      return current === null;
    },
    releaseIfMatchesActive(activeNow: boolean) {
      if (!activeNow) return null;
      return clearRecord();
    },
    releaseIfExpired(checkAt: number, ttlMs: number = defaultTtlMs) {
      if (current === null) return null;
      if (checkAt - current.dispatchedAt < ttlMs) return null;
      return clearRecord();
    },
    peek() {
      return current;
    },
  };
}
