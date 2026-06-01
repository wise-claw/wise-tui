import { describe, expect, test } from "bun:test";
import { CURSOR_SDK_DEFAULT_MODEL } from "../constants/cursorSdk";
import {
  buildCursorModelPickerOptions,
  formatCursorModelLabel,
  resolveCursorLocalModelId,
} from "./cursorModel";

describe("resolveCursorLocalModelId", () => {
  test("maps auto alias to default", () => {
    expect(resolveCursorLocalModelId("auto")).toBe("default");
    expect(resolveCursorLocalModelId(undefined)).toBe(CURSOR_SDK_DEFAULT_MODEL);
    expect(resolveCursorLocalModelId("composer-2.5")).toBe("composer-2.5");
  });
});

describe("formatCursorModelLabel", () => {
  test("prefers displayName", () => {
    expect(formatCursorModelLabel("default", "Auto")).toBe("Auto");
  });

  test("formats composer ids", () => {
    expect(formatCursorModelLabel("composer-2.5")).toBe("Composer 2.5");
  });
});

describe("buildCursorModelPickerOptions", () => {
  test("dedupes aliases and duplicate display names", () => {
    const opts = buildCursorModelPickerOptions([
      { id: "composer-2.5", displayName: "Composer 2.5", aliases: ["composer-2.5-fast"] },
      { id: "composer-2.5-fast", displayName: "Composer 2.5" },
      { id: "claude-opus-4-8", displayName: "Opus 4.8" },
    ]);
    expect(opts).toEqual([
      { value: "composer-2.5", label: "Composer 2.5" },
      { value: "claude-opus-4-8", label: "Opus 4.8" },
    ]);
  });
});
