import { describe, expect, it } from "vitest";
import {
  HUD_WINDOW_LABEL,
  PRIMARY_MAIN_WINDOW_LABEL,
  isHudWindowLabel,
  isMainWorkspaceWindowLabel,
} from "./mainWindow";

describe("window labels", () => {
  it("treats hud as exclusive from the main workspace", () => {
    expect(isHudWindowLabel(HUD_WINDOW_LABEL)).toBe(true);
    expect(isHudWindowLabel(PRIMARY_MAIN_WINDOW_LABEL)).toBe(false);
    expect(isMainWorkspaceWindowLabel(HUD_WINDOW_LABEL)).toBe(false);
  });
});
