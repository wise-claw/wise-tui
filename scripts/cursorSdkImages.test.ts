import { describe, expect, test } from "bun:test";
import { bridgeImagesToSdkRefs, localImagePathToSdkUrl } from "./cursorSdkImages.ts";

describe("cursorSdkImages", () => {
  test("maps local path to file URL without reading bytes", () => {
    expect(localImagePathToSdkUrl("/tmp/a.png")).toBe("file:///tmp/a.png");
  });

  test("bridgeImagesToSdkRefs skips invalid entries", () => {
    expect(
      bridgeImagesToSdkRefs([
        { path: "/Users/me/x.png", mimeType: "image/png" },
        { path: "  " },
        null,
      ]),
    ).toEqual([{ url: "file:///Users/me/x.png" }]);
  });
});
