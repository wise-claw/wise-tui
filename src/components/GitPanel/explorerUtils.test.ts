import { describe, expect, test } from "bun:test";
import {
  clampExplorerMenuPosition,
  EXPLORER_CONTEXT_MENU_ESTIMATED_HEIGHT_PX,
  EXPLORER_CONTEXT_MENU_VIEWPORT_PAD_PX,
} from "./explorerUtils";

describe("clampExplorerMenuPosition", () => {
  test("keeps click point when menu fits in viewport", () => {
    expect(
      clampExplorerMenuPosition(100, 120, undefined, { width: 1200, height: 900 }),
    ).toEqual({ x: 100, y: 120 });
  });

  test("pulls menu up near the bottom edge", () => {
    const { y } = clampExplorerMenuPosition(
      40,
      580,
      { width: 200, height: 380 },
      { width: 1000, height: 600 },
    );
    expect(y).toBe(600 - 380 - EXPLORER_CONTEXT_MENU_VIEWPORT_PAD_PX);
    expect(y).toBeLessThan(580);
  });

  test("default estimate is tall enough for full explorer menu", () => {
    expect(EXPLORER_CONTEXT_MENU_ESTIMATED_HEIGHT_PX).toBeGreaterThanOrEqual(320);
  });
});
