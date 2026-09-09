import { HUD_RESTING_OVERLAY_HEIGHT } from "./hudOverlayHeight";

/** 详情展开后的 HUD 窗口高度；底部输入条占用约 54px。 */
export const HUD_DETAILS_HEIGHT_MIN = 140;
export const HUD_DETAILS_HEIGHT_MAX = 960;
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
