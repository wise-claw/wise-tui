import type { PaneCount, PaneSlot } from "../constants/mainLayoutWidths";

export function isPaneSlotEmpty(slot: PaneSlot): boolean {
  return !slot.sessionId?.trim();
}

export function countOccupiedExtraPanes(extraPanes: readonly PaneSlot[]): number {
  return extraPanes.filter((slot) => !isPaneSlotEmpty(slot)).length;
}

export function findFirstEmptyExtraPaneIndex(extraPanes: readonly PaneSlot[]): number | null {
  const index = extraPanes.findIndex((slot) => isPaneSlotEmpty(slot));
  return index >= 0 ? index : null;
}

/** 已有 occupied 个额外窗格内容时，满足网格布局所需的最小屏数。 */
export function minPaneCountForOccupiedExtras(occupiedExtraCount: number): PaneCount {
  const needTotal = Math.max(1, occupiedExtraCount + 1);
  if (needTotal <= 1) return 1;
  if (needTotal <= 2) return 2;
  if (needTotal <= 4) return 4;
  if (needTotal <= 6) return 6;
  return 8;
}

export interface PlanNextPaneSlotPlacementInput {
  paneCount: PaneCount;
  extraPanes: readonly PaneSlot[];
  createSlot: () => PaneSlot;
}

export interface PlanNextPaneSlotPlacementResult {
  nextPaneCount: PaneCount;
  nextExtraPanes: PaneSlot[];
  slotIndex: number;
}

/** 按行优先网格为下一窗格分配槽位（与多屏 2×2 等布局一致）。 */
export function planNextPaneSlotPlacement(
  input: PlanNextPaneSlotPlacementInput,
): PlanNextPaneSlotPlacementResult {
  const { extraPanes, createSlot } = input;
  const occupied = countOccupiedExtraPanes(extraPanes);
  const nextPaneCount = minPaneCountForOccupiedExtras(occupied + 1);
  const neededExtra = nextPaneCount - 1;
  const nextExtraPanes: PaneSlot[] = [];
  for (let i = 0; i < neededExtra; i += 1) {
    nextExtraPanes.push(extraPanes[i] ? { ...extraPanes[i] } : createSlot());
  }
  const slotIndex = findFirstEmptyExtraPaneIndex(nextExtraPanes) ?? 0;
  return { nextPaneCount, nextExtraPanes, slotIndex };
}
