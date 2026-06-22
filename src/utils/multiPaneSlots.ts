import type { PaneCount, PaneSlot } from "../constants/mainLayoutWidths";
import type { PaneRuntimeOverride } from "../types/paneRuntimeOverride";
import { companionPaneRuntimeFromPrimary } from "../types/paneRuntimeOverride";

export function extraPanesLayoutFingerprint(panes: readonly PaneSlot[]): string {
  return panes
    .map((pane) => `${pane.slotId}:${pane.sessionId ?? ""}:${pane.repositoryId ?? ""}`)
    .join("\n");
}

export function isPaneSlotEmpty(slot: PaneSlot): boolean {
  return !slot.sessionId?.trim();
}

/** 会话是否已被主窗格或其它额外窗格占用。 */
export function isSessionBoundInPanes(
  sessionId: string,
  activeSessionId: string | null | undefined,
  extraPanes: readonly PaneSlot[],
  exceptSlotIndex?: number,
): boolean {
  const id = sessionId.trim();
  if (!id) return false;
  if (activeSessionId?.trim() === id) return true;
  return extraPanes.some((slot, index) => {
    if (exceptSlotIndex != null && index === exceptSlotIndex) return false;
    return slot.sessionId?.trim() === id;
  });
}

/** 将 extraPanes 长度对齐到 paneCount - 1，不足补空槽、超出截断。 */
export function normalizeExtraPanesToPaneCount(
  paneCount: PaneCount,
  extraPanes: readonly PaneSlot[],
  createSlot: () => PaneSlot,
): PaneSlot[] {
  const needed = Math.max(0, paneCount - 1);
  if (extraPanes.length === needed) {
    return extraPanes as PaneSlot[];
  }
  if (extraPanes.length > needed) return extraPanes.slice(0, needed).map((slot) => ({ ...slot }));
  const next = extraPanes.map((slot) => ({ ...slot }));
  while (next.length < needed) {
    next.push(createSlot());
  }
  return next;
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

/** 额外窗格绑定隔离执行会话，并默认继承主窗格执行环境覆盖。 */
export function assignCompanionSessionToPaneSlot(
  slot: PaneSlot,
  sessionId: string,
  repositoryId: number | null,
  primaryPaneRuntime?: PaneRuntimeOverride | null,
): PaneSlot {
  const inherited = companionPaneRuntimeFromPrimary(primaryPaneRuntime);
  const next: PaneSlot = {
    slotId: slot.slotId,
    sessionId,
    repositoryId,
  };
  if (inherited.executionEngine) {
    next.executionEngine = inherited.executionEngine;
  }
  if (inherited.claudeProxyRoute) {
    next.claudeProxyRoute = inherited.claudeProxyRoute;
  }
  return next;
}

/** 已有会话的窗格新建/替换会话时，保留 slot 自身的执行环境覆盖，仅替换 sessionId/repositoryId（不继承主窗格）。 */
export function rebindPaneSlotPreservingRuntime(
  slot: PaneSlot,
  sessionId: string,
  repositoryId: number | null,
): PaneSlot {
  const next: PaneSlot = {
    slotId: slot.slotId,
    sessionId,
    repositoryId,
  };
  if (slot.executionEngine) {
    next.executionEngine = slot.executionEngine;
  }
  if (slot.claudeProxyRoute) {
    next.claudeProxyRoute = slot.claudeProxyRoute;
  }
  return next;
}

/** 在已对齐长度的 extraPanes 上写入 session，优先第一个空槽。 */
export function assignSessionToNormalizedExtraPanes(
  paneCount: PaneCount,
  extraPanes: readonly PaneSlot[],
  sessionId: string,
  createSlot: () => PaneSlot,
  fallbackSlotIndex: number,
  primaryPaneRuntime?: PaneRuntimeOverride | null,
): PaneSlot[] {
  const base = normalizeExtraPanesToPaneCount(paneCount, extraPanes, createSlot);
  const slotIndex =
    findFirstEmptyExtraPaneIndex(base) ?? Math.min(fallbackSlotIndex, Math.max(0, base.length - 1));
  const next = base.map((slot) => ({ ...slot }));
  if (next[slotIndex]) {
    next[slotIndex] = assignCompanionSessionToPaneSlot(
      next[slotIndex],
      sessionId,
      null,
      primaryPaneRuntime,
    );
  }
  return next;
}

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
