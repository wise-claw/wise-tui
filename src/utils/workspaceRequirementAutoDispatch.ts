import type { WorkspaceRequirementItem } from "../types/workspaceRequirements";

/** 一次轮询最多自动派发的条数（避免一次性刷爆执行环境队列）。 */
export const AUTO_DISPATCH_MAX_PER_SWEEP = 2;

/**
 * 自动派发候选判定：open 且（从未派发过 或 派发后又被编辑过）。
 * `updatedAt > lastDispatchedAt` 既覆盖新增，也覆盖「编辑后重新派发」。
 */
export function isRequirementAutoDispatchEligible(
  item: WorkspaceRequirementItem,
): boolean {
  if (item.status !== "open") return false;
  if (item.lastDispatchedAt == null) return true;
  return item.updatedAt > item.lastDispatchedAt;
}

/**
 * 本轮可派发槽位：并发上限减去当前正在运行的会话数（含 connecting）。
 * 运行会话 >= 并发时返回 0，暂停自动派发直到有空位。
 */
export function autoDispatchAvailableSlots(
  concurrency: number,
  runningSessions: number,
): number {
  const limit = Math.max(0, Math.round(concurrency));
  const running = Math.max(0, Math.round(runningSessions));
  return Math.max(0, limit - running);
}

/**
 * 选取本轮自动派发目标：先按派发/编辑时间升序（最旧优先，避免长期堆积），
 * 再截断到 `max` 条。
 */
export function selectAutoDispatchTargets(
  items: readonly WorkspaceRequirementItem[],
  max: number = AUTO_DISPATCH_MAX_PER_SWEEP,
): WorkspaceRequirementItem[] {
  return items
    .filter(isRequirementAutoDispatchEligible)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(0, Math.max(0, max));
}

/**
 * 规划一轮自动派发：并发槽位与单轮上限取小，避免一次把所有需求都丢给执行环境。
 * 并发数放开后尤其关键——并发设再大，单轮也最多派发 `AUTO_DISPATCH_MAX_PER_SWEEP` 条，
 * 其余留给后续轮次，保证会话按稳定节奏创建。
 */
export function planAutoDispatchSweep(
  concurrency: number,
  runningSessions: number,
  items: readonly WorkspaceRequirementItem[],
): WorkspaceRequirementItem[] {
  const slots = autoDispatchAvailableSlots(concurrency, runningSessions);
  if (slots <= 0) return [];
  return selectAutoDispatchTargets(items, Math.min(slots, AUTO_DISPATCH_MAX_PER_SWEEP));
}
