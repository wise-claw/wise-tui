import { describe, expect, test } from "bun:test";
import { CURSOR_SDK_DEFAULT_MODEL } from "../constants/cursorSdk";
import {
  buildCursorModelPickerOptions,
  formatCursorModelLabel,
  isCursorSdkModelId,
  resolveCursorComposerModel,
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
    expect(isCursorSdkModelId("grok-4.6")).toBe(true);
    expect(isCursorSdkModelId("grok-4.6-fast")).toBe(true);
    expect(isCursorSdkModelId("fast")).toBe(true);
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
    expect(isCursorSdkModelId("grok-4.6", known)).toBe(true);
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

describe("resolveCursorComposerModel", () => {
  test("keeps the in-composer Grok selection even if session still says auto", () => {
    expect(
      resolveCursorComposerModel({
        currentModel: "grok-4.6",
        sessionModel: "auto",
        savedDefault: "composer-2.5",
      }),
    ).toBe("grok-4.6");
  });

  test("restores saved default when composer still has leftover Claude model", () => {
    expect(
      resolveCursorComposerModel({
        currentModel: "sonnet",
        sessionModel: "sonnet",
        savedDefault: "grok-4.6",
      }),
    ).toBe("grok-4.6");
  });

  test("keeps explicit Auto when that is the saved preference", () => {
    expect(
      resolveCursorComposerModel({
        currentModel: "auto",
        sessionModel: "auto",
        savedDefault: "auto",
      }),
    ).toBe("auto");
  });

  test("menu pick of Grok wins over stale Auto session/current values", () => {
    expect(
      resolveCursorComposerModel({
        pickedModel: "grok-4.6",
        currentModel: "auto",
        sessionModel: "auto",
        savedDefault: "auto",
      }),
    ).toBe("grok-4.6");
  });

  test("keeps CLI Fast alias instead of snapping to Auto", () => {
    expect(
      resolveCursorComposerModel({
        pickedModel: "fast",
        currentModel: "auto",
        sessionModel: "auto",
        savedDefault: "auto",
        knownModels: [{ id: "fast", aliases: [] }],
      }),
    ).toBe("fast");
  });
});

describe("formatCursorModelLabel", () => {
  test("prefers displayName", () => {
    expect(formatCursorModelLabel("grok-4.6-fast", "Grok 4.6 Fast")).toBe("Grok 4.6 Fast");
  });

  test("always labels auto as Auto even if CLI names the current model", () => {
    expect(formatCursorModelLabel("auto", "Grok 4.6 Fast (current, default)")).toBe("Auto");
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

  test("does not let Auto absorb Grok 4.6 Fast", () => {
    expect(
      buildCursorModelPickerOptions([
        { id: "auto", displayName: "Grok 4.6 Fast (current, default)" },
        { id: "fast", displayName: "Grok 4.6 Fast" },
        { id: "grok-4.6-fast", displayName: "Grok 4.6 Fast" },
      ]),
    ).toEqual([
      { value: "auto", label: "Auto" },
      { value: "fast", label: "Grok 4.6 Fast" },
    ]);
  });
});
