import { describe, expect, test } from "bun:test";
import {
  applyLocalSpeechPolishFallback,
  buildComposerSpeechPolishPrompt,
  sanitizePolishedSpeechOutput,
} from "./composerSpeechPolish";

describe("composerSpeechPolish", () => {
  test("buildComposerSpeechPolishPrompt includes raw transcript", () => {
    const prompt = buildComposerSpeechPolishPrompt("嗯 帮我 修一下 bug");
    expect(prompt).toContain("嗯 帮我 修一下 bug");
    expect(prompt).toContain("只输出整理后的正文");
  });

  test("applyLocalSpeechPolishFallback strips fillers", () => {
    expect(applyLocalSpeechPolishFallback("嗯  帮我  修一下")).toBe("帮我 修一下");
  });

  test("applyLocalSpeechPolishFallback compresses repeated fillers", () => {
    expect(applyLocalSpeechPolishFallback("嗯嗯嗯 好的")).toBe("好的");
  });

  test("applyLocalSpeechPolishFallback strips a clause-leading hesitation phrase", () => {
    expect(applyLocalSpeechPolishFallback("那个，帮我修一下")).toBe("帮我修一下");
    expect(applyLocalSpeechPolishFallback("就是说，加个验证码")).toBe("加个验证码");
  });

  test("applyLocalSpeechPolishFallback keeps meaningful connectors (然后/就是这样)", () => {
    expect(applyLocalSpeechPolishFallback("然后提交代码")).toBe("然后提交代码");
    expect(applyLocalSpeechPolishFallback("就是这样")).toBe("就是这样");
  });

  test("applyLocalSpeechPolishFallback tidies spacing before CJK punctuation", () => {
    expect(applyLocalSpeechPolishFallback("帮我 改一下 ，好吗")).toBe("帮我 改一下，好吗");
  });

  test("applyLocalSpeechPolishFallback returns empty for blank input", () => {
    expect(applyLocalSpeechPolishFallback("   ")).toBe("");
  });

  test("sanitizePolishedSpeechOutput unwraps fences and quotes", () => {
    expect(sanitizePolishedSpeechOutput("```\n帮我修一下\n```", "fallback")).toBe("帮我修一下");
    expect(sanitizePolishedSpeechOutput("「整理后的句子」", "fallback")).toBe("整理后的句子");
  });

  test("sanitizePolishedSpeechOutput falls back on empty or runaway output", () => {
    expect(sanitizePolishedSpeechOutput("", "原文")).toBe("原文");
    expect(sanitizePolishedSpeechOutput("x".repeat(5000), "短句")).toBe("短句");
  });
});
