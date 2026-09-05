/** HUD 仓库 Select：强制向上弹出，禁止 rc-trigger 因空间不足自动翻到下方。 */
export const HUD_SELECT_OPEN_DELAY_MS = 120;

/** mousedown 已开始打开时，click 再调度会把浮层拖晚，窗口先撑高却没有内容。 */
export function shouldScheduleHudOverlayOpen(
  alreadyOpen: boolean,
  hasPendingTimer: boolean,
): boolean {
  return !alreadyOpen && !hasPendingTimer;
}

const HUD_TOP_OVERFLOW = {
  adjustX: true,
  adjustY: false,
  shiftY: false,
} as const;

export const HUD_SELECT_POPUP_ALIGN = {
  overflow: HUD_TOP_OVERFLOW,
};

export const HUD_SELECT_BUILTIN_PLACEMENTS = {
  topLeft: {
    points: ["bl", "tl"] as [string, string],
    offset: [0, -6],
    overflow: HUD_TOP_OVERFLOW,
    htmlRegion: "visible" as const,
  },
  topRight: {
    points: ["br", "tr"] as [string, string],
    offset: [0, -6],
    overflow: HUD_TOP_OVERFLOW,
    htmlRegion: "visible" as const,
  },
  bottomLeft: {
    points: ["tl", "bl"] as [string, string],
    offset: [0, 6],
    overflow: HUD_TOP_OVERFLOW,
    htmlRegion: "visible" as const,
  },
  bottomRight: {
    points: ["tr", "br"] as [string, string],
    offset: [0, 6],
    overflow: HUD_TOP_OVERFLOW,
    htmlRegion: "visible" as const,
  },
};

export function hudSelectPopupContainer(_node: HTMLElement): HTMLElement {
  return document.body;
}

/** HUD 上下文浮层：触发钮与浮层内点击都不应被误判为「点外关闭」。 */
export const HUD_CONTEXT_PICKER_ROOT_SELECTOR =
  ".app-hud-context-popover, .app-hud-context-panel, .app-hud-context-anchor";

/** 点胶囊内按钮时抑制把焦点抢回编辑器，避免窗口 resize 把胶囊闪一下。 */
export const HUD_CHROME_CONTROL_SELECTOR = [
  ".app-hud-new-session-btn",
  ".app-hud-quick-actions-btn",
  ".app-hud-quick-actions-anchor",
  ".app-hud-run-chip",
  ".app-hud-git-actions",
  ".app-hud-context-anchor",
  ".app-hud-context-pill",
  ".app-hud-exit-btn",
  ".app-hud-stop-btn",
  ".app-hud-repo-anchor",
].join(", ");

export const HUD_CHROME_FOCUS_SUPPRESS_MS = HUD_SELECT_OPEN_DELAY_MS + 280;

export function isHudChromeControl(target: EventTarget | null): boolean {
  return Boolean(asClosestHost(target)?.closest(HUD_CHROME_CONTROL_SELECTOR));
}

function asClosestHost(
  target: EventTarget | null,
): { closest: (selector: string) => { className?: string } | null } | null {
  if (target == null || typeof target !== "object") return null;
  const node = target as { closest?: unknown; parentElement?: EventTarget | null };
  if (typeof node.closest === "function") {
    return node as unknown as {
      closest: (selector: string) => { className?: string } | null;
    };
  }
  return asClosestHost(node.parentElement ?? null);
}

export function isInsideHudContextPicker(target: EventTarget | null): boolean {
  return Boolean(asClosestHost(target)?.closest(HUD_CONTEXT_PICKER_ROOT_SELECTOR));
}

/** HUD 快捷操作：触发钮与浮层内点击都不应被误判为「点外关闭」。 */
export const HUD_QUICK_ACTIONS_PICKER_ROOT_SELECTOR =
  ".app-hud-quick-actions-popover, .app-hud-quick-actions-panel, .app-hud-quick-actions-anchor";

export function isInsideHudQuickActionsPicker(target: EventTarget | null): boolean {
  return Boolean(asClosestHost(target)?.closest(HUD_QUICK_ACTIONS_PICKER_ROOT_SELECTOR));
}
