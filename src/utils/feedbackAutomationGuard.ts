import type { FeedbackConfigPatch } from "./sessionFeedbackConfigPatch";

/**
 * 反馈神经网自动化护栏（纯函数，不依赖 React / IPC / 持久化）。
 *
 * 三项自动化（自动写入 / 自动调整 / 自动优化）已具备执行能力，本模块为其提供
 * 「防失控」守卫：单轮应用上限、连续回滚熔断、跨轮次幂等去重。所有判定均为纯函数，
 * 状态由调用方（hook）以 ref 持有，便于在闭环各阶段同步。
 */

/** 单轮自动应用补丁数量上限，避免一次 worker 响应落盘过多变更。 */
export const MAX_AUTO_APPLY_PATCHES_PER_CYCLE = 3;

/** 连续回滚达到该次数后熔断自动应用，直至一次无回滚的完成或手动重置。 */
export const AUTO_APPLY_ROLLBACK_CIRCUIT_BREAKER = 2;

/** 学习用的最低有效样本数，低于此数不参考历史效果（避免小样本噪音）。 */
export const PATCH_EFFECTIVENESS_MIN_SAMPLES = 2;

/** 历史平均会话分低于该值且样本足够时，视为该 kind「表现不佳」。 */
export const PATCH_EFFECTIVENESS_UNDERPERFORM_SCORE = 50;

/** 历史平均会话分不低于该值且样本足够时，视为该 kind「高表现」，候选上采样（正向加权）。 */
export const PATCH_EFFECTIVENESS_HIGH_PERFORM_SCORE = 65;

/** 评分回归阈值：最终分低于历史基线超过该值时，触发本轮补丁自动回滚。 */
export const FEEDBACK_LOOP_REGRESSION_THRESHOLD = 5;

/** 近期回滚键冷却时长：仅该窗口内的 auto_rollback 计入跨轮去重，过期后允许重试。 */
export const ROLLBACK_KEY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type FeedbackPatchDedupeKey = string;

/** 补丁去重键：kind | action | path | section。与候选去重保持一致。 */
export function feedbackPatchDedupeKey(
  patch: Pick<FeedbackConfigPatch, "kind" | "action" | "path" | "section">,
): FeedbackPatchDedupeKey {
  return [patch.kind, patch.action, patch.path, patch.section ?? ""].join("|");
}

export interface FeedbackAutomationGuardState {
  /** 本轮已自动应用的补丁数量。 */
  appliedThisCycle: number;
  /** 连续回滚计数（跨 run 累积，无回滚完成或手动重置时清零）。 */
  consecutiveRollbacks: number;
  /** 本轮已自动应用的补丁 dedupe key 集合（防同轮重复）。 */
  appliedKeysThisCycle: Set<FeedbackPatchDedupeKey>;
  /** 近期被自动回滚的补丁 dedupe key 集合（防跨轮反复改写，来自审计日志）。 */
  recentlyRolledBackKeys: Set<FeedbackPatchDedupeKey>;
}

export function createInitialAutomationGuardState(): FeedbackAutomationGuardState {
  return {
    appliedThisCycle: 0,
    consecutiveRollbacks: 0,
    appliedKeysThisCycle: new Set(),
    recentlyRolledBackKeys: new Set(),
  };
}

/** 轮次开始时重置本轮瞬时态（保留跨轮的熔断计数与近期回滚键）。 */
export function resetAutomationGuardForCycle(
  state: FeedbackAutomationGuardState,
): FeedbackAutomationGuardState {
  return {
    ...state,
    appliedThisCycle: 0,
    appliedKeysThisCycle: new Set(),
  };
}

export interface AutomationGuardDecision {
  allowed: boolean;
  reason?: string;
}

export function isAutomationCircuitBreakerTripped(
  state: FeedbackAutomationGuardState,
): boolean {
  return state.consecutiveRollbacks >= AUTO_APPLY_ROLLBACK_CIRCUIT_BREAKER;
}

/**
 * 判定单条补丁是否可被自动应用（护栏统一守卫）。
 * 依次检查：熔断 → 单轮上限 → 同轮重复 → 近期回滚。
 */
export function canAutoApplyPatch(
  patch: FeedbackConfigPatch,
  guard: FeedbackAutomationGuardState,
): AutomationGuardDecision {
  if (isAutomationCircuitBreakerTripped(guard)) {
    return {
      allowed: false,
      reason: `连续回滚 ${guard.consecutiveRollbacks} 次已触发熔断，自动应用已暂停`,
    };
  }
  if (guard.appliedThisCycle >= MAX_AUTO_APPLY_PATCHES_PER_CYCLE) {
    return {
      allowed: false,
      reason: `本轮已自动应用 ${guard.appliedThisCycle} 条，达单轮上限 ${MAX_AUTO_APPLY_PATCHES_PER_CYCLE}`,
    };
  }
  const key = feedbackPatchDedupeKey(patch);
  if (guard.appliedKeysThisCycle.has(key)) {
    return { allowed: false, reason: "本轮已应用过相同补丁" };
  }
  if (guard.recentlyRolledBackKeys.has(key)) {
    return { allowed: false, reason: "该补丁近期已被自动回滚，跳过避免反复改写" };
  }
  return { allowed: true };
}

/** 记录一条补丁已自动应用，更新护栏本轮计数与去重集合。 */
export function markPatchAutoApplied(
  guard: FeedbackAutomationGuardState,
  patch: FeedbackConfigPatch,
): FeedbackAutomationGuardState {
  const key = feedbackPatchDedupeKey(patch);
  guard.appliedKeysThisCycle.add(key);
  guard.appliedThisCycle += 1;
  return guard;
}

/** 记录一次自动回滚发生，递增连续回滚计数并登记近期回滚键。 */
export function markPatchAutoRolledBack(
  guard: FeedbackAutomationGuardState,
  patch: FeedbackConfigPatch,
): FeedbackAutomationGuardState {
  const key = feedbackPatchDedupeKey(patch);
  guard.recentlyRolledBackKeys.add(key);
  guard.consecutiveRollbacks += 1;
  return guard;
}

/** 一次无回滚的完成：清零连续回滚计数（熔断自动解除）。 */
export function resetAutomationCircuitBreaker(
  guard: FeedbackAutomationGuardState,
): FeedbackAutomationGuardState {
  guard.consecutiveRollbacks = 0;
  return guard;
}

/**
 * 从审计日志条目构建「近期自动回滚补丁 key 集合」，供护栏跨轮去重使用。
 * 仅扫描最近 windowSize 条记录中的 auto_rollback 条目；
 * 若给定 maxAgeMs，则仅保留该时间窗口内的回滚键，过期后允许重试（避免永久拉黑）。
 */
export function collectRecentlyRolledBackKeys(
  entries: ReadonlyArray<{ action: string; patchKey?: string; at?: number }>,
  windowSize = 20,
  maxAgeMs?: number,
): Set<FeedbackPatchDedupeKey> {
  const out = new Set<FeedbackPatchDedupeKey>();
  const now = Date.now();
  let scanned = 0;
  for (const entry of entries) {
    if (scanned >= windowSize) break;
    scanned += 1;
    if (entry.action !== "auto_rollback" || !entry.patchKey) continue;
    if (maxAgeMs != null && entry.at != null && now - entry.at > maxAgeMs) continue;
    out.add(entry.patchKey);
  }
  return out;
}

/** 历史补丁效果摘要的最小同构接口（与 effectiveness 模块的 summary 对齐，避免循环依赖）。 */
export interface PatchKindEffectivenessHint {
  kind: FeedbackConfigPatch["kind"];
  count: number;
  avgSessionScore: number | null;
  avgRulesDelta: number | null;
  score: number;
}

/**
 * 闭环学习：从历史效果摘要中识别「表现不佳」的 artifact kind。
 * 判据：样本数 ≥ 最低门槛，且平均会话分低于基线。
 * 这些 kind 的候选将被降权（排到末尾），避免规则引擎反复产生已知无效补丁。
 */
export function identifyUnderperformingPatchKinds(
  hints: readonly PatchKindEffectivenessHint[] | null | undefined,
): Set<FeedbackConfigPatch["kind"]> {
  const out = new Set<FeedbackConfigPatch["kind"]>();
  if (!hints || hints.length === 0) return out;
  for (const hint of hints) {
    if (hint.count < PATCH_EFFECTIVENESS_MIN_SAMPLES) continue;
    if (
      hint.avgSessionScore != null &&
      hint.avgSessionScore < PATCH_EFFECTIVENESS_UNDERPERFORM_SCORE
    ) {
      out.add(hint.kind);
    }
  }
  return out;
}

/**
 * 闭环学习：从历史效果摘要中识别「高表现」的 artifact kind。
 * 判据：样本数 ≥ 最低门槛，且平均会话分不低于基线。
 * 这些 kind 的候选将被上采样（排到前面），让规则引擎优先复用已知有效补丁。
 * 与 identifyUnderperformingPatchKinds 阈值不重叠（< 50 vs ≥ 65），不会冲突。
 */
export function identifyHighPerformingPatchKinds(
  hints: readonly PatchKindEffectivenessHint[] | null | undefined,
): Set<FeedbackConfigPatch["kind"]> {
  const out = new Set<FeedbackConfigPatch["kind"]>();
  if (!hints || hints.length === 0) return out;
  for (const hint of hints) {
    if (hint.count < PATCH_EFFECTIVENESS_MIN_SAMPLES) continue;
    if (
      hint.avgSessionScore != null &&
      hint.avgSessionScore >= PATCH_EFFECTIVENESS_HIGH_PERFORM_SCORE
    ) {
      out.add(hint.kind);
    }
  }
  return out;
}

/** 历史基线比较结果的最小同构接口（与 historyStore 的 compareWithHistoryAverage 对齐）。 */
export interface RegressionBaseline {
  average: number | null;
  delta: number | null;
}

export interface RegressionAssessment {
  shouldRollback: boolean;
  delta: number | null;
  reason?: string;
}

/**
 * 自动调整：判定本轮最终分是否相对历史基线显著回归，应触发补丁回滚。
 * 纯函数化便于单元测试；delta = finalScore - baseline.average，delta ≤ -threshold 视为回归。
 */
export function assessRegression(input: {
  finalScore: number | null;
  baseline: RegressionBaseline;
  threshold?: number;
}): RegressionAssessment {
  const threshold = input.threshold ?? FEEDBACK_LOOP_REGRESSION_THRESHOLD;
  const { finalScore, baseline } = input;
  if (
    finalScore == null ||
    baseline.average == null ||
    baseline.delta == null
  ) {
    return { shouldRollback: false, delta: baseline.delta ?? null };
  }
  if (baseline.delta <= -threshold) {
    return {
      shouldRollback: true,
      delta: baseline.delta,
      reason: `评分低于基线 ${Math.abs(baseline.delta).toFixed(1)} 分，达回归阈值 ${threshold}`,
    };
  }
  return { shouldRollback: false, delta: baseline.delta };
}
