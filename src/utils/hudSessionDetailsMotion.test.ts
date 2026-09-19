import { describe, expect, test } from "bun:test";
import {
  HUD_SESSION_DETAILS_LEAVE_MS,
  hudSessionDetailsLeaveDurationMs,
  shouldRenderHudSessionDetails,
} from "./hudSessionDetailsMotion";

describe("hudSessionDetailsLeaveDurationMs", () => {
  test("keeps the close animation when motion is allowed", () => {
    expect(hudSessionDetailsLeaveDurationMs(false)).toBe(HUD_SESSION_DETAILS_LEAVE_MS);
  });

  test("skips the close animation when the user prefers reduced motion", () => {
    expect(hudSessionDetailsLeaveDurationMs(true)).toBe(0);
  });
});

describe("shouldRenderHudSessionDetails", () => {
  test("keeps the panel mounted while it is leaving", () => {
    expect(shouldRenderHudSessionDetails(true, false)).toBe(true);
    expect(shouldRenderHudSessionDetails(false, true)).toBe(true);
    expect(shouldRenderHudSessionDetails(false, false)).toBe(false);
  });
});
