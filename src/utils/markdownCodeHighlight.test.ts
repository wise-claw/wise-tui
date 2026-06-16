import { describe, expect, test } from "bun:test";
import { highlightMarkdownCode, normalizeMarkdownCodeLanguage, formatMarkdownCodeLanguageLabel } from "./markdownCodeHighlight";

describe("normalizeMarkdownCodeLanguage", () => {
  test("maps common aliases", () => {
    expect(normalizeMarkdownCodeLanguage("ts")).toBe("typescript");
    expect(normalizeMarkdownCodeLanguage("js")).toBe("javascript");
    expect(normalizeMarkdownCodeLanguage("sh")).toBe("bash");
    expect(normalizeMarkdownCodeLanguage("vue")).toBe("xml");
  });

  test("returns empty for plain text fences", () => {
    expect(normalizeMarkdownCodeLanguage("")).toBe("");
    expect(normalizeMarkdownCodeLanguage("plaintext")).toBe("");
  });
});

describe("formatMarkdownCodeLanguageLabel", () => {
  test("formats known languages", () => {
    expect(formatMarkdownCodeLanguageLabel("ts")).toBe("TypeScript");
    expect(formatMarkdownCodeLanguageLabel("javascript")).toBe("JavaScript");
    expect(formatMarkdownCodeLanguageLabel("")).toBe("");
  });
});

describe("highlightMarkdownCode", () => {
  test("highlights typescript fences", () => {
    const source = "const videoSources = ref<VideoSource[]>([]);";
    const { html, resolvedLang } = highlightMarkdownCode(source, "typescript");
    expect(resolvedLang).toBe("typescript");
    expect(html).toContain("hljs-keyword");
    expect(html).toContain("const");
  });

  test("auto-detects javascript when language tag is missing", () => {
    const source = "function hello() { return 'world'; }";
    const { html, resolvedLang } = highlightMarkdownCode(source, "");
    expect(resolvedLang).toBe("javascript");
    expect(html).toContain("hljs-title");
  });
});
