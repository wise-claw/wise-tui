/**
 * Composer 「正在执行」判定收敛点
 *
 * 为什么需要它
 * ------------
 * 旧逻辑只在 `composer-region.tsx` 内联写：
 *   isSessionBusy = (status === 'running' || status === 'connecting') && !backgroundContextCompactInFlight
 *
 * 这条表达式覆盖不到三个真实场景：
 * 1. 后台压缩 turn 结束时，`setBackgroundContextCompactInFlight(_, false)` 在 `run() finally`
 *    中先翻 false，但 rust 端 `session.status` 翻成 idle 之前存在瞬时窗口，按钮会消失。
 * 2. 队首接力跑前：`pendingExecutionTaskCount > 0` 但 `session.status=idle`，按钮消失。
 * 3. streaming turn 完成到下一轮接力之间：`finalizeSessionAfterComplete` 在 success +
 *    streamingResident 路径把 status 落 idle，但 Claude 子进程仍存活。
 *
 * 这里把判断收敛为纯函数，方便 bun test 覆盖；hook 层再叠加 store 订阅与 sticky 防抖。
 */

/** 「正在执行」信号来源，按命中优先级排序（首个命中即返回）。 */
export type ComposerBusySource =
  /** `session.status === "running" | "connecting"` */
  | "status"
  /** 后台压缩 turn 仍在跑（独立进程占用主会话） */
  | "compact"
  /** 待执行队列里有任务即将接力 */
  | "pending"
  /** 子进程仍存活（长驻 streaming 或相似状态，session.status 已收敛到 idle） */
  | "resident"
  /** 全部空闲 */
  | "none";

/** 纯函数入参：来自 store / props 的所有信号。 */
export interface ComposerExecutionBusyInput {
  sessionStatus: string | undefined;
  backgroundContextCompactInFlight: boolean;
  pendingExecutionTaskCount: number;
  /** 长驻占位：true 表示子进程仍存活，session.status 即便收敛到 idle 也视为忙。
   *  留空/未提供视为 false（不触发 resident 分支）。 */
  streamingResident?: boolean;
}

/** 纯函数返回值；保留 source 便于诊断与 UI 调试。 */
export interface ComposerBusyResult {
  isBusy: boolean;
  source: ComposerBusySource;
}

/** 命中优先级：status > compact > pending > resident > none。 */
export function computeComposerExecutionBusy(
  input: ComposerExecutionBusyInput,
): ComposerBusyResult {
  const status = input.sessionStatus;
  if (status === "running" || status === "connecting") {
    return { isBusy: true, source: "status" };
  }
  if (input.backgroundContextCompactInFlight) {
    return { isBusy: true, source: "compact" };
  }
  if (input.pendingExecutionTaskCount > 0) {
    return { isBusy: true, source: "pending" };
  }
  if (input.streamingResident === true) {
    return { isBusy: true, source: "resident" };
  }
  return { isBusy: false, source: "none" };
}

/** 按钮守卫：只有在真正忙且父组件传了 onCancel 时才显示「结束」按钮。 */
export function shouldShowStopButton(
  busy: ComposerBusyResult,
  hasOnCancel: boolean,
): boolean {
  return busy.isBusy && hasOnCancel;
}