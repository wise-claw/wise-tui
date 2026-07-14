import { describe, expect, test } from "bun:test";
import { dismissStuckAntOverlays } from "./dismissStuckOverlays";

describe("dismissStuckAntOverlays", () => {
  test("returns 0 when DOM has no ant overlays", () => {
    expect(dismissStuckAntOverlays()).toBe(0);
  });
});
