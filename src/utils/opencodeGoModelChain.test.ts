import { describe, expect, test } from "bun:test";
import {
  buildOpencodeGoModelChain,
  buildOpencodeGoModelSelectOptions,
  fallbackModelsEqual,
  normalizeFallbackModels,
  parseOpencodeGoFallbackDraft,
} from "./opencodeGoModelChain";

describe("buildOpencodeGoModelChain", () => {
  test("dedupes and keeps primary first", () => {
    expect(
      buildOpencodeGoModelChain("qwen3.7-max", [
        "qwen3.7-plus",
        "qwen3.7-max",
        "kimi-k2.6",
      ]),
    ).toEqual(["qwen3.7-max", "qwen3.7-plus", "kimi-k2.6"]);
  });

  test("trims whitespace", () => {
    expect(buildOpencodeGoModelChain("  kimi-k2.6 ", [" minimax-m3 "])).toEqual([
      "kimi-k2.6",
      "minimax-m3",
    ]);
  });
});

describe("parseOpencodeGoFallbackDraft", () => {
  test("parses comma-separated models", () => {
    expect(parseOpencodeGoFallbackDraft("a, b ,c")).toEqual(["a", "b", "c"]);
  });
});

describe("normalizeFallbackModels", () => {
  test("dedupes and trims", () => {
    expect(normalizeFallbackModels([" kimi-k2.6 ", "kimi-k2.6", "glm-5"])).toEqual([
      "kimi-k2.6",
      "glm-5",
    ]);
  });
});

describe("fallbackModelsEqual", () => {
  test("compares normalized lists", () => {
    expect(fallbackModelsEqual(["a", "b"], ["a", "b"])).toBe(true);
    expect(fallbackModelsEqual(["b", "a"], ["a", "b"])).toBe(false);
  });
});

describe("buildOpencodeGoModelSelectOptions", () => {
  test("merges chain and presets without dupes", () => {
    expect(
      buildOpencodeGoModelSelectOptions(["kimi-k2.6"], ["kimi-k2.6", "glm-5"]),
    ).toEqual([
      { value: "kimi-k2.6", label: "kimi-k2.6" },
      { value: "glm-5", label: "glm-5" },
    ]);
  });
});
