import { describe, expect, test } from "bun:test";
import {
  HUD_IMAGE_OVERLAY_MAX,
  HUD_RESTING_OVERLAY_HEIGHT,
  overlayHeightFor,
  overlayHeightForMode,
} from "./hudOverlayHeight";

describe("overlayHeightForMode", () => {
  test("keeps none/menu/details on the same height so picker clicks do not resize", () => {
    expect(overlayHeightForMode("none")).toBe(HUD_RESTING_OVERLAY_HEIGHT);
    expect(overlayHeightForMode("menu")).toBe(HUD_RESTING_OVERLAY_HEIGHT);
    expect(overlayHeightForMode("details")).toBe(HUD_RESTING_OVERLAY_HEIGHT);
    expect(overlayHeightForMode("images")).toBe(HUD_IMAGE_OVERLAY_MAX);
  });
});

describe("overlayHeightFor", () => {
  test("toast stack still fits inside the resting overlay height", () => {
    expect(overlayHeightFor("none", 3)).toBe(HUD_RESTING_OVERLAY_HEIGHT);
    expect(overlayHeightFor("menu", 0)).toBe(HUD_RESTING_OVERLAY_HEIGHT);
  });
});
