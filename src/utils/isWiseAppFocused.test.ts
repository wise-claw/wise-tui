import { afterEach, describe, expect, test } from "bun:test";
import { isWiseAppFocused } from "./isWiseAppFocused";

describe("isWiseAppFocused", () => {
  afterEach(() => {
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
});
