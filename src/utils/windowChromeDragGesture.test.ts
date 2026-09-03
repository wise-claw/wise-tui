import { describe, expect, test } from "bun:test";
import {
  WINDOW_CHROME_DRAG_THRESHOLD_PX,
  shouldStartWindowChromeDrag,
} from "./windowChromeDragGesture";

describe("shouldStartWindowChromeDrag", () => {
  test("单击不移动不启动", () => {
    expect(shouldStartWindowChromeDrag({ x: 10, y: 10 }, { x: 10, y: 10 }, false)).toBe(false);
  });

  test("小于阈值不启动", () => {
    expect(
      shouldStartWindowChromeDrag(
        { x: 0, y: 0 },
        { x: WINDOW_CHROME_DRAG_THRESHOLD_PX - 1, y: 0 },
        false,
      ),
    ).toBe(false);
  });

  test("达到阈值才启动", () => {
    expect(
      shouldStartWindowChromeDrag(
        { x: 0, y: 0 },
        { x: WINDOW_CHROME_DRAG_THRESHOLD_PX, y: 0 },
        false,
      ),
    ).toBe(true);
  });

  test("已经启动过不再重复", () => {
    expect(shouldStartWindowChromeDrag({ x: 0, y: 0 }, { x: 40, y: 40 }, true)).toBe(false);
  });
});
