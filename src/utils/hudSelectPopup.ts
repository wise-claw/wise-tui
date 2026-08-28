/** HUD 仓库 Select：强制向上弹出，禁止 rc-trigger 因空间不足自动翻到下方。 */
export const HUD_SELECT_OPEN_DELAY_MS = 120;

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

/** HUD 上下文浮层：点在分页/搜索/列表内时不应关闭。 */
export const HUD_CONTEXT_PICKER_ROOT_SELECTOR =
  ".app-hud-context-popover, .app-hud-context-panel";

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
