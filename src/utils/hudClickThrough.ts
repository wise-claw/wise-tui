/** 这些区域要接鼠标；其余透明区穿透到后面的桌面。 */
export const HUD_HIT_TARGET_SELECTOR = [
  ".app-hud-bar",
  ".app-hud-session-details",
  ".app-hud-toasts",
  ".app-hud-image-float",
  ".app-hud-context-popover",
  ".app-hud-quick-actions-popover",
  ".ant-popover",
  ".ant-select-dropdown",
  ".app-claude-slash-popover",
  ".semi-portal",
].join(", ");

export function hudPointShouldClickThrough(target: EventTarget | null): boolean {
  if (target == null || typeof target !== "object") return true;
  const node = target as { closest?: (selector: string) => unknown };
  if (typeof node.closest !== "function") return true;
  return node.closest(HUD_HIT_TARGET_SELECTOR) == null;
}
