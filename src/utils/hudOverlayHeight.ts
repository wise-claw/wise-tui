import { hudToastStackExtraHeight } from "./hudCompletionToast";

/** 胶囊可视高度（含 shell padding），不是窗口高度。 */
export const HUD_VISUAL_COMPACT_HEIGHT = 64;

/**
 * 空闲 / 菜单 / 详情共用窗口高度。
 * 点胶囊按钮时不再 64↔400 拉伸，避免 WKWebView 整页重绘闪一下。
 */
export const HUD_RESTING_OVERLAY_HEIGHT = 420;

export const HUD_IMAGE_OVERLAY_MAX = 780;

export type HudOverlayHeightMode = "none" | "images" | "menu" | "details";

export function overlayHeightForMode(mode: HudOverlayHeightMode): number {
  if (mode === "images") return HUD_IMAGE_OVERLAY_MAX;
  return HUD_RESTING_OVERLAY_HEIGHT;
}

export function overlayHeightFor(mode: HudOverlayHeightMode, toastCount: number): number {
  return Math.max(
    overlayHeightForMode(mode),
    HUD_VISUAL_COMPACT_HEIGHT + hudToastStackExtraHeight(toastCount),
  );
}
