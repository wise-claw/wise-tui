import { describe, expect, test } from "bun:test";
import { normalizeSessionDisplayLanguage } from "../constants/sessionDisplayLanguage";
import {
  applySessionDisplayLanguageToPrompt,
  buildSessionDisplayLanguageSystemPromptBlock,
} from "./sessionDisplayLanguagePrompt";

describe("normalizeSessionDisplayLanguage", () => {
  test("accepts supported languages and trims", () => {
    expect(normalizeSessionDisplayLanguage("zh-CN")).toBe("zh-CN");
    expect(normalizeSessionDisplayLanguage(" en ")).toBe("en");
    expect(normalizeSessionDisplayLanguage("ja")).toBe("ja");
    expect(normalizeSessionDisplayLanguage("auto")).toBe("auto");
  });

  test("falls back to auto for dirty values", () => {
    expect(normalizeSessionDisplayLanguage(null)).toBe("auto");
    expect(normalizeSessionDisplayLanguage(undefined)).toBe("auto");
    expect(normalizeSessionDisplayLanguage("fr")).toBe("auto");
    expect(normalizeSessionDisplayLanguage(3)).toBe("auto");
  });
});

describe("buildSessionDisplayLanguageSystemPromptBlock", () => {
  test("auto injects nothing", () => {
    expect(buildSessionDisplayLanguageSystemPromptBlock("auto")).toBe("");
    expect(buildSessionDisplayLanguageSystemPromptBlock(null)).toBe("");
  });

  test("target language block keeps code untouched", () => {
    const block = buildSessionDisplayLanguageSystemPromptBlock("zh-CN");
    expect(block).toContain("简体中文");
    expect(block).toContain("代码");
    expect(buildSessionDisplayLanguageSystemPromptBlock("en")).toContain("English");
    expect(buildSessionDisplayLanguageSystemPromptBlock("ja")).toContain("日本語");
  });
});

describe("applySessionDisplayLanguageToPrompt", () => {
  test("auto keeps the original prompt", () => {
    expect(applySessionDisplayLanguageToPrompt("auto", "hello")).toBe("hello");
  });

  test("prepends the language requirement ahead of the user turn", () => {
    const composed = applySessionDisplayLanguageToPrompt("zh-CN", "帮我改一下 README");
    expect(composed.startsWith("【会话回复语言要求】")).toBe(true);
    expect(composed.endsWith("帮我改一下 README")).toBe(true);
    expect(composed).toContain("简体中文");
  });
});
