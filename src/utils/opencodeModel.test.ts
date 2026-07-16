import { describe, expect, test } from "bun:test";
import {
  OPENCODE_DEFAULT_MODEL,
  buildOpencodeModelPickerOptions,
  formatOpencodeModelLabel,
  isOpencodeAutoModelId,
  matchesOpencodeModelPickerFilter,
  resolveOpencodeExecModelId,
} from "./opencodeModel";

describe("opencodeModel helpers", () => {
  test("treats auto/default/empty as Auto", () => {
    expect(isOpencodeAutoModelId("auto")).toBe(true);
    expect(isOpencodeAutoModelId("DEFAULT")).toBe(true);
    expect(isOpencodeAutoModelId("")).toBe(true);
    expect(isOpencodeAutoModelId("anthropic/claude-sonnet-4")).toBe(false);
  });

  test("formats labels and always includes Auto option", () => {
    expect(formatOpencodeModelLabel("auto")).toBe("Auto");
    expect(formatOpencodeModelLabel("anthropic/claude-sonnet-4")).toBe("claude-sonnet-4");
    expect(formatOpencodeModelLabel("opencode/deepseek-v4-flash", "opencode/deepseek-v4-flash")).toBe(
      "deepseek-v4-flash",
    );
    expect(formatOpencodeModelLabel("x", "Grok")).toBe("Grok");
    expect(buildOpencodeModelPickerOptions([{ id: "openai/gpt-5", displayName: "GPT-5" }])).toEqual([
      { value: OPENCODE_DEFAULT_MODEL, label: "Auto" },
      { value: "openai/gpt-5", label: "GPT-5" },
    ]);
  });

  test("filters model picker options by id or label", () => {
    const options = [
      { value: "opencode/deepseek-v4-flash", label: "deepseek-v4-flash" },
      { value: "opencode/gpt-5", label: "gpt-5" },
      { value: "auto", label: "Auto" },
    ];
    expect(options.filter((o) => matchesOpencodeModelPickerFilter("flash", o))).toEqual([
      options[0],
    ]);
    expect(options.filter((o) => matchesOpencodeModelPickerFilter("GPT", o))).toEqual([options[1]]);
    expect(options.filter((o) => matchesOpencodeModelPickerFilter("opencode/gpt", o))).toEqual([
      options[1],
    ]);
    expect(options.filter((o) => matchesOpencodeModelPickerFilter("  ", o))).toEqual(options);
  });
});

describe("resolveOpencodeExecModelId", () => {
  test("prefers session model in OpenCode context and ignores profile", () => {
    expect(
      resolveOpencodeExecModelId({
        sessionModel: "google/gemini-2.5-pro",
        contextExecutionEngine: "opencode",
        store: {
          profiles: [],
          activeProfileId: null,
          activeCodexProfileId: null,
          activeOpencodeProfileId: "oc-1",
          effectiveModel: null,
          effectiveCodexModel: null,
          effectiveOpencodeModel: "opencode/grok-code",
        },
      }),
    ).toBe("google/gemini-2.5-pro");
  });

  test("auto/empty session model does not pass -m", () => {
    expect(
      resolveOpencodeExecModelId({
        sessionModel: "auto",
        contextExecutionEngine: "opencode",
        diskModel: "anthropic/claude-haiku-4-5",
        store: {
          profiles: [],
          activeProfileId: null,
          activeCodexProfileId: null,
          activeOpencodeProfileId: "oc-1",
          effectiveModel: null,
          effectiveCodexModel: null,
          effectiveOpencodeModel: "opencode/grok-code",
        },
      }),
    ).toBeUndefined();
    expect(
      resolveOpencodeExecModelId({
        sessionModel: "",
        contextExecutionEngine: "opencode",
        store: null,
      }),
    ).toBeUndefined();
  });

  test("prefers session model even outside OpenCode context", () => {
    expect(
      resolveOpencodeExecModelId({
        sessionModel: "google/gemini-2.5-pro",
        contextExecutionEngine: "claude",
        store: null,
      }),
    ).toBe("google/gemini-2.5-pro");
    expect(
      resolveOpencodeExecModelId({
        sessionModel: "auto",
        contextExecutionEngine: "claude",
        store: {
          profiles: [],
          activeProfileId: null,
          activeCodexProfileId: null,
          activeOpencodeProfileId: "oc-1",
          effectiveModel: null,
          effectiveCodexModel: null,
          effectiveOpencodeModel: "opencode/grok-code",
        },
      }),
    ).toBe("opencode/grok-code");
  });
});
