/** 与 `.app-hud-session-details--leaving` 动画时长保持一致。 */
export const HUD_SESSION_DETAILS_LEAVE_MS = 240;

export function hudSessionDetailsLeaveDurationMs(reduceMotion: boolean): number {
  return reduceMotion ? 0 : HUD_SESSION_DETAILS_LEAVE_MS;
}

/** 关闭动画播放期间仍渲染详情，避免白卡片瞬间消失。 */
export function shouldRenderHudSessionDetails(visible: boolean, leaving: boolean): boolean {
  return visible || leaving;
}

export function prefersHudReducedMotion(): boolean {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}
