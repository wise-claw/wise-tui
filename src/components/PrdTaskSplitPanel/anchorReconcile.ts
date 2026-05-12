import type { SplitResult, TaskAnchorPosition } from "../../types";
import { sameTaskAnchorPositions } from "../../utils/anchorStability";

export type TaskAnchorRangeMap = Record<string, { from: number; to: number }>;

/**
 * Merge editor-reported anchor ranges into the active split result.
 *
 * Returns `null` when there is nothing to apply (no valid ranges, all ranges
 * resolved to existing positions, etc.). When non-null, the returned value is
 * a new SplitResult ready to replace `prev` and should also be persisted.
 *
 * Behavior preservation (matches the inline callback that used to live in
 * `PrdTaskSplitPanel/index.tsx`):
 * - Drops ranges whose taskId is not present on the active result.
 * - Drops ranges with non-finite numbers or non-positive width.
 * - Floors `from`/`to` to integers.
 * - Merges incrementally on top of existing `taskAnchorPositions` so a
 *   transient incomplete callback does not erase known positions.
 * - Returns `null` when the merged positions are structurally identical to
 *   the current positions.
 */
export function reconcileResolvedAnchorRanges(
  prev: SplitResult,
  ranges: TaskAnchorRangeMap,
): SplitResult | null {
  const taskIds = new Set(prev.splitTasks.map((task) => task.id));
  const resolvedNow: Record<string, TaskAnchorPosition> = {};
  for (const [taskId, range] of Object.entries(ranges)) {
    if (!taskIds.has(taskId)) continue;
    const from = Number(range.from);
    const to = Number(range.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
    resolvedNow[taskId] = { from: Math.floor(from), to: Math.floor(to) };
  }
  if (Object.keys(resolvedNow).length === 0) return null;

  const current = prev.taskAnchorPositions ?? {};
  const mergedPositions: Record<string, TaskAnchorPosition> = {};
  for (const [taskId, pos] of Object.entries({ ...current, ...resolvedNow })) {
    if (!taskIds.has(taskId)) continue;
    mergedPositions[taskId] = pos;
  }
  const nextPositions = Object.keys(mergedPositions).length > 0 ? mergedPositions : undefined;
  if (sameTaskAnchorPositions(prev.taskAnchorPositions, nextPositions)) return null;

  return { ...prev, taskAnchorPositions: nextPositions };
}
