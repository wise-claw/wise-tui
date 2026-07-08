/**
 * 派发失败追踪器
 *
 * 为什么需要它
 * ------------
 * `dispatchPendingTask` 的 catch 路径原先直接 `addTask` 重新入队 + finally 微任务
 * flush：若 `onExecute` 持续抛错（执行环境异常 / spawn gate 逻辑 bug / IPC 静默丢失），
 * 会形成「派发 -> 失败 -> 重新入队 -> 微任务 flush -> 再派发」的紧循环，且每次循环
 * 都 `message.error` toast 刷屏，队列还会因「原 task 未 removeTask + addTask 新增」
 * 爆炸增长。
 *
 * 这个追踪器把失败计数 + 退避 + 上限收敛为纯函数：
 * - 首次失败：requeue，退避 `count * baseMs`。
 * - 累计达 `max` 次：drop（不再重新入队），并清零该 fingerprint。
 * - 派发成功：清除该 fingerprint 的计数。
 *
 * 与 `mainLaneDispatchGate` 一样：纯 ref 状态，`useRef.current` 读取总取最新值，
 * 绕开 React 重渲染闭包时序。退避通过调用方 setTimeout 延迟入队实现，不在队列里
 * 的任务不会被 `canDispatchHead` 判定 -> 无需改动 canDispatchHead / flush。
 *
 * 复用方式：`src/components/ClaudeSessions/ClaudeChat.tsx` 内 `useRef` 持有，
 * catch 路径调用 onFailure 决定 requeue/drop，success 路径调用 onSuccess 清零。
 */

const DEFAULT_MAX = 3;
const DEFAULT_BASE_MS = 2_000;

/** 失败后的处置动作。 */
export type DispatchFailureAction = "requeue" | "drop";

/** onFailure 的返回值，调用方据此决定退避重入队还是丢弃。 */
export interface DispatchFailureOutcome {
  action: DispatchFailureAction;
  /** action="requeue" 时的退避毫秒；action="drop" 时为 0。 */
  backoffMs: number;
  /** 累计失败次数（含本次），用于 toast 文案。 */
  count: number;
}

export interface CreateDispatchFailureTrackerOptions {
  /** 连续失败上限，达到即 drop。默认 3。 */
  max?: number;
  /** 退避基数：backoffMs = count * baseMs。默认 2000。 */
  baseMs?: number;
  /** 注入时间源（保留扩展位，当前未直接使用，便于未来接入 wall-clock 退避）。 */
  now?: () => number;
}

export interface DispatchFailureTracker {
  /**
   * 派发成功后调用：清除该 fingerprint 的计数，避免下次同任务失败时被旧计数误判。
   * 幂等，无该 fingerprint 时 no-op。
   */
  onSuccess(fingerprint: string): void;
  /**
   * 派发失败后调用：累加计数并决定 requeue/drop。
   * - count < max：返回 requeue + 退避，保留计数。
   * - count >= max：返回 drop，并内部清零该 fingerprint（drop 后不再追踪）。
   */
  onFailure(fingerprint: string): DispatchFailureOutcome;
  /** 会话切换时清空所有计数，避免跨会话残留导致新会话任务被误判 drop。 */
  clear(): void;
  /** 当前 fingerprint 的累计失败次数（仅测试/调试用）。无记录返回 0。 */
  peek(fingerprint: string): number;
}

export function createDispatchFailureTracker(
  options: CreateDispatchFailureTrackerOptions = {},
): DispatchFailureTracker {
  const max = options.max ?? DEFAULT_MAX;
  const baseMs = options.baseMs ?? DEFAULT_BASE_MS;
  const counts = new Map<string, number>();

  return {
    onSuccess(fingerprint: string) {
      counts.delete(fingerprint);
    },
    onFailure(fingerprint: string): DispatchFailureOutcome {
      const prev = counts.get(fingerprint) ?? 0;
      const count = prev + 1;
      if (count >= max) {
        // 达上限：丢弃该任务，清零指纹，后续同任务重新从 0 计数（若用户再次手动入队）。
        counts.delete(fingerprint);
        return { action: "drop", backoffMs: 0, count };
      }
      counts.set(fingerprint, count);
      return { action: "requeue", backoffMs: count * baseMs, count };
    },
    clear() {
      counts.clear();
    },
    peek(fingerprint: string): number {
      return counts.get(fingerprint) ?? 0;
    },
  };
}
