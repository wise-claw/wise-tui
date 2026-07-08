/**
 * Composer 「正在执行」判定收敛点
 *
 * 为什么需要它
 * ------------
 * 旧逻辑只在 `composer-region.tsx` 内联写：
 *   isSessionBusy = (status === 'running' || status === 'connecting') && !backgroundContextCompactInFlight
 *
 * 这条表达式覆盖不到两个真实场景：
 * 1. 后台压缩 turn 结束时，`setBackgroundContextCompactInFlight(_, false)` 在 `run() finally`
 *    中先翻 false，但 rust 端 `session.status` 翻成 idle 之前存在瞬时窗口，按钮会消失。
 * 2. 队首接力跑前：`pendingExecutionTaskCount > 0` 但 `session.status=idle`，按钮消失。
 *
 * 这里把判断收敛为纯函数，方便 bun test 覆盖；hook 层再叠加 store 订阅与 sticky 防抖。
 *
 * 注：曾用 `streamingResident`（claudeSessionId 非空）覆盖「complete 后子进程仍存活」窗口，
 * 但 claudeSessionId 永不清空会让 busy 永久 true、独立「结束」按钮不消失，已移除。
 * 另：AIChatInput 的 generating 不能绑 isSessionBusy--Semi handleSend 在 generating=true 时
 * 拦截 Enter，running/pending 期间无法入队；generating 固定 false，停止由独立按钮承担。
 */

/** 「正在执行」信号来源，按命中优先级排序（首个命中即返回）。 */
export type ComposerBusySource =
  /** `session.status === "running" | "connecting"` */
  | "status"
  /** 后台压缩 turn 仍在跑（独立进程占用主会话） */
  | "compact"
  /** 待执行队列里有任务即将接力 */
  | "pending"
  /** 全部空闲 */
  | "none";

/** 纯函数入参：来自 store / props 的所有信号。 */
export interface ComposerExecutionBusyInput {
  sessionStatus: string | undefined;
  backgroundContextCompactInFlight: boolean;
  pendingExecutionTaskCount: number;
}

/** 纯函数返回值；保留 source 便于诊断与 UI 调试。 */
export interface ComposerBusyResult {
  isBusy: boolean;
  source: ComposerBusySource;
}

/** 命中优先级：status > compact > pending > none。 */
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
  return { isBusy: false, source: "none" };
}

/** 按钮守卫：只有在真正忙且父组件传了 onCancel 时才显示「结束」按钮。 */
export function shouldShowStopButton(
  busy: ComposerBusyResult,
  hasOnCancel: boolean,
): boolean {
  return busy.isBusy && hasOnCancel;
}