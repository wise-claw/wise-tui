import { describe, expect, test } from "bun:test";
import { clampMonacoSelectionToolbarPosition } from "./clampMonacoSelectionToolbarPosition";

describe("clampMonacoSelectionToolbarPosition", () => {
  test("keeps position inside viewport", () => {
    const clamped = clampMonacoSelectionToolbarPosition(
      { top: 9999, left: 9999 },
      { viewportWidth: 800, viewportHeight: 600, toolbarWidth: 160, toolbarHeight: 32, margin: 8 },
    );
    expect(clamped.top).toBeLessThan(600);
    expect(clamped.left).toBeLessThan(800);
    expect(clamped.top).toBeGreaterThanOrEqual(8);
    expect(clamped.left).toBeGreaterThanOrEqual(8);
  });
});
