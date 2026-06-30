import type { ComposerSpeechSendMode } from "../constants/composerSpeechPreferences";

export interface ManualSegmentIdleDecision {
  /** 是否应启动/重置 1s 段尾空闲计时器 */
  shouldArm: boolean;
  /** 计时器到期时是否应触发 finalize（false = 该重置已被忽略或模式已切走） */
  shouldFire: boolean;
}

export interface ManualSegmentIdleContext {
  sendMode: ComposerSpeechSendMode;
  trimmed: string;
  lastSeenText: string;
  segmentTriggerActed: boolean;
  listening: boolean;
  idleMs: number;
  now: number;
  armedAt: number | null;
}

/**
 * manual 模式"段尾 1s"计时器状态机。
 *
 * 触发条件：
 * 1. sendMode === "manual"
 * 2. 当前文本非空且与上次记录不同（避免 ASR cumulative 重灌导致反复重启）
 * 3. 当前段没被收尾词触发过
 *
 * 触发动作：启动 idleMs 计时器；到期时若仍 listening 则 finalize 一次（continueListening: true）。
 */
export function evaluateManualSegmentIdle(ctx: ManualSegmentIdleContext): ManualSegmentIdleDecision {
  if (ctx.sendMode !== "manual") {
    return { shouldArm: false, shouldFire: false };
  }
  if (!ctx.trimmed) {
    return { shouldArm: false, shouldFire: false };
  }
  if (ctx.trimmed === ctx.lastSeenText) {
    return { shouldArm: false, shouldFire: false };
  }
  if (ctx.segmentTriggerActed) {
    return { shouldArm: false, shouldFire: false };
  }
  // arming 阶段：返回 shouldArm=true 让调用方启动/重置计时器
  if (ctx.armedAt == null) {
    return { shouldArm: true, shouldFire: false };
  }
  if (ctx.now - ctx.armedAt >= ctx.idleMs) {
    return {
      shouldArm: false,
      shouldFire: ctx.listening && !ctx.segmentTriggerActed,
    };
  }
  return { shouldArm: true, shouldFire: false };
}