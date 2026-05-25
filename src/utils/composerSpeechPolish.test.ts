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

  test("sanitizePolishedSpeechOutput unwraps fences and quotes", () => {
    expect(sanitizePolishedSpeechOutput("```\n帮我修一下\n```", "fallback")).toBe("帮我修一下");
    expect(sanitizePolishedSpeechOutput("「整理后的句子」", "fallback")).toBe("整理后的句子");
  });

  test("sanitizePolishedSpeechOutput falls back on empty or runaway output", () => {
    expect(sanitizePolishedSpeechOutput("", "原文")).toBe("原文");
    expect(sanitizePolishedSpeechOutput("x".repeat(5000), "短句")).toBe("短句");
  });
});
