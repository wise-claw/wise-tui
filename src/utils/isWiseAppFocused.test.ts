import { afterEach, describe, expect, test } from "bun:test";
import { setWiseHudModeActive } from "../stores/wiseHudModeStore";
import { isWiseAppFocused, shouldAcceptBackgroundClaudeStream } from "./isWiseAppFocused";

describe("isWiseAppFocused", () => {
  afterEach(() => {
    setWiseHudModeActive(false);
    if (typeof document !== "undefined") {
      document.body.removeAttribute("tabindex");
    }
  });

  test("returns true when document has focus", () => {
    if (typeof document === "undefined") return;
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
    expect(isWiseAppFocused()).toBe(true);
  });

  test("accepts background Claude stream while HUD mode is active", () => {
    setWiseHudModeActive(true);
    expect(shouldAcceptBackgroundClaudeStream()).toBe(true);
  });
});
