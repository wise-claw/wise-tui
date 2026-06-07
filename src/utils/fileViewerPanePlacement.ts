import type { PaneCount, PaneSlot } from "../constants/mainLayoutWidths";
import {
  findFirstEmptyExtraPaneIndex,
  normalizeExtraPanesToPaneCount,
  planNextPaneSlotPlacement,
} from "./multiPaneSlots";

export interface PlanFileViewerPaneIndexInput {
  paneCount: PaneCount;
  extraPanes: readonly PaneSlot[];
  createSlot: () => PaneSlot;
}

export interface PlanFileViewerPaneIndexResult {
  /** 0 = 主窗格，1+ = 额外窗格（与多屏网格顺序一致）。 */
  targetPaneIndex: number;
  nextPaneCount: PaneCount;
}

/** 为文件树「新开一屏」选择目标窗格；优先占用空额外窗格，否则扩容。 */
export function planFileViewerPaneIndex(
  input: PlanFileViewerPaneIndexInput,
): PlanFileViewerPaneIndexResult {
  const { paneCount, extraPanes, createSlot } = input;

  if (paneCount <= 1) {
    return { targetPaneIndex: 1, nextPaneCount: 2 };
  }

  const normalized = normalizeExtraPanesToPaneCount(paneCount, extraPanes, createSlot);
  const emptyIdx = findFirstEmptyExtraPaneIndex(normalized);
  if (emptyIdx != null) {
    return { targetPaneIndex: emptyIdx + 1, nextPaneCount: paneCount };
  }

  const plan = planNextPaneSlotPlacement({ paneCount, extraPanes, createSlot });
  return { targetPaneIndex: plan.slotIndex + 1, nextPaneCount: plan.nextPaneCount };
}
