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
