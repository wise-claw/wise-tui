import { describe, expect, test } from "bun:test";
import { CURSOR_SDK_DEFAULT_MODEL } from "../constants/cursorSdk";
import {
  buildCursorModelPickerOptions,
  formatCursorModelLabel,
  isCursorSdkModelId,
  resolveCursorLocalModelId,
} from "./cursorModel";

describe("isCursorSdkModelId", () => {
  test("accepts auto/default and Cursor-native prefixes", () => {
    expect(isCursorSdkModelId("auto")).toBe(true);
    expect(isCursorSdkModelId("default")).toBe(true);
    expect(isCursorSdkModelId("composer-2.5")).toBe(true);
    expect(isCursorSdkModelId("claude-opus-4-8")).toBe(true);
    expect(isCursorSdkModelId("sonnet-4")).toBe(true);
    expect(isCursorSdkModelId("sonnet-4-thinking")).toBe(true);
    expect(isCursorSdkModelId("gpt-5.1")).toBe(true);
    expect(isCursorSdkModelId("gpt-5.5-medium")).toBe(true);
    expect(isCursorSdkModelId("kimi-k2.5")).toBe(true);
  });

  test("rejects third-party Claude proxy models", () => {
    expect(isCursorSdkModelId("glm-5.1")).toBe(false);
    expect(isCursorSdkModelId("qwen-max")).toBe(false);
    expect(isCursorSdkModelId("deepseek-chat")).toBe(false);
  });

  test("uses known model list when provided", () => {
    const known = [{ id: "composer-2.5", aliases: ["composer-2.5-fast"] }];
    expect(isCursorSdkModelId("composer-2.5-fast", known)).toBe(true);
    expect(isCursorSdkModelId("glm-5.1", known)).toBe(false);
  });
});

describe("resolveCursorLocalModelId", () => {
  test("maps auto alias to composer-2.5", () => {
    expect(resolveCursorLocalModelId("auto")).toBe("composer-2.5");
    expect(resolveCursorLocalModelId(undefined)).toBe(CURSOR_SDK_DEFAULT_MODEL);
    expect(resolveCursorLocalModelId("composer-2.5")).toBe("composer-2.5");
  });

  test("falls back to auto for invalid proxy models", () => {
    expect(resolveCursorLocalModelId("glm-5.1")).toBe(CURSOR_SDK_DEFAULT_MODEL);
    expect(resolveCursorLocalModelId("qwen3-max")).toBe(CURSOR_SDK_DEFAULT_MODEL);
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
