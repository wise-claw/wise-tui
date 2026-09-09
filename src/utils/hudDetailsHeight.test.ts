import { describe, expect, it } from "bun:test";
import {
  HUD_DETAILS_HEIGHT_DEFAULT,
  HUD_DETAILS_HEIGHT_MAX,
  HUD_DETAILS_HEIGHT_MIN,
  clampHudDetailsHeight,
  hudDetailsHeightFromDrag,
} from "./hudDetailsHeight";

describe("HUD details height", () => {
  it("grows when the top edge is dragged upward", () => {
    expect(hudDetailsHeightFromDrag(420, 300, 220)).toBe(500);
  });

  it("shrinks when the top edge is dragged downward", () => {
    expect(hudDetailsHeightFromDrag(420, 300, 360)).toBe(360);
  });

  it("clamps persisted and dragged values", () => {
    expect(clampHudDetailsHeight(1)).toBe(HUD_DETAILS_HEIGHT_MIN);
    expect(clampHudDetailsHeight(10_000)).toBe(HUD_DETAILS_HEIGHT_MAX);
    expect(clampHudDetailsHeight(Number.NaN)).toBe(HUD_DETAILS_HEIGHT_DEFAULT);
  });
});
