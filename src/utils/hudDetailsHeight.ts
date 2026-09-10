import { HUD_RESTING_OVERLAY_HEIGHT } from "./hudOverlayHeight";

/** 详情展开后的 HUD 窗口高度；底部输入条占用约 54px。 */
export const HUD_DETAILS_HEIGHT_MIN = 140;
// 原生 HUD 窗口 maxHeight 为 800；保留 shell 阴影/边距后使用 780。
// 高于原生上限会造成拖动数值变化但窗口不动的“空行程”。
export const HUD_DETAILS_HEIGHT_MAX = 780;
export const HUD_DETAILS_HEIGHT_DEFAULT = HUD_RESTING_OVERLAY_HEIGHT;

export function clampHudDetailsHeight(value: number): number {
  if (!Number.isFinite(value)) return HUD_DETAILS_HEIGHT_DEFAULT;
  return Math.round(Math.min(HUD_DETAILS_HEIGHT_MAX, Math.max(HUD_DETAILS_HEIGHT_MIN, value)));
}

export function hudDetailsHeightFromDrag(
  startHeight: number,
  startScreenY: number,
  currentScreenY: number,
): number {
  return clampHudDetailsHeight(startHeight + startScreenY - currentScreenY);
}
