import { describe, expect, test } from "bun:test";
import { isRepositoryMarkdownHref, resolveRepositoryMarkdownPath } from "./repositoryMarkdownLinks";

describe("repository markdown link resolution", () => {
  test("resolves relative links against the current file directory", () => {
    expect(resolveRepositoryMarkdownPath("README.md", "docs/i18n.md")).toBe("docs/i18n.md");
    expect(resolveRepositoryMarkdownPath("README.md", "./docs/i18n.md")).toBe("docs/i18n.md");
    expect(resolveRepositoryMarkdownPath("docs/guide.md", "../README.md")).toBe("README.md");
    expect(resolveRepositoryMarkdownPath("docs/guide.md", "api/reference.md")).toBe("docs/api/reference.md");
    expect(resolveRepositoryMarkdownPath("docs/guide.md", "./deep/../api/a.md")).toBe("docs/api/a.md");
  });

  test("treats leading slash as repository root", () => {
    expect(resolveRepositoryMarkdownPath("docs/guide.md", "/README.md")).toBe("README.md");
  });

  test("keeps file links but drops fragment and query", () => {
    expect(resolveRepositoryMarkdownPath("README.md", "docs/i18n.md#intro")).toBe("docs/i18n.md");
    expect(resolveRepositoryMarkdownPath("README.md", "docs/a.md?raw=1")).toBe("docs/a.md");
    expect(resolveRepositoryMarkdownPath("README.md", "docs/my%20file.md")).toBe("docs/my file.md");
  });

  test("ignores anchors, external and protocol-relative links", () => {
    expect(resolveRepositoryMarkdownPath("README.md", "#section")).toBe(null);
    expect(resolveRepositoryMarkdownPath("README.md", "https://example.com/x.md")).toBe(null);
    expect(resolveRepositoryMarkdownPath("README.md", "mailto:a@b.c")).toBe(null);
    expect(resolveRepositoryMarkdownPath("README.md", "//example.com/x.md")).toBe(null);
    expect(resolveRepositoryMarkdownPath("README.md", "wise://author/doc")).toBe(null);
    expect(resolveRepositoryMarkdownPath("README.md", "   ")).toBe(null);
  });

  test("refuses links escaping the repository root", () => {
    expect(resolveRepositoryMarkdownPath("README.md", "../outside.md")).toBe(null);
    expect(resolveRepositoryMarkdownPath("docs/guide.md", "../../outside.md")).toBe(null);
  });

  test("classifies repository links", () => {
    expect(isRepositoryMarkdownHref("docs/i18n.md")).toBe(true);
    expect(isRepositoryMarkdownHref("#anchor")).toBe(false);
    expect(isRepositoryMarkdownHref("https://example.com")).toBe(false);
    expect(isRepositoryMarkdownHref(undefined)).toBe(false);
  });
});
