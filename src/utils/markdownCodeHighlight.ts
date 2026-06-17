import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const LANG_ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
  py: "python",
  rs: "rust",
  html: "xml",
  htm: "xml",
  vue: "xml",
  svg: "xml",
};

const AUTO_DETECT_LANGUAGES = [
  "typescript",
  "javascript",
  "json",
  "bash",
  "python",
  "rust",
  "go",
  "java",
  "css",
  "xml",
  "yaml",
  "sql",
  "markdown",
] as const;

let registered = false;

/** 已完成代码块高亮缓存；流式阶段应跳过 hljs，避免每 token 重复解析。 */
const HIGHLIGHT_CACHE_MAX = 384;
const highlightCache = new Map<string, { html: string; resolvedLang: string }>();

function highlightCacheKey(lang: string, text: string): string {
  return `${lang}\u0000${text}`;
}

function readHighlightCache(lang: string, text: string): { html: string; resolvedLang: string } | null {
  return highlightCache.get(highlightCacheKey(lang, text)) ?? null;
}

function writeHighlightCache(
  lang: string,
  text: string,
  value: { html: string; resolvedLang: string },
): void {
  const key = highlightCacheKey(lang, text);
  if (highlightCache.has(key)) {
    highlightCache.set(key, value);
    return;
  }
  if (highlightCache.size >= HIGHLIGHT_CACHE_MAX) {
    const oldest = highlightCache.keys().next().value;
    if (oldest) highlightCache.delete(oldest);
  }
  highlightCache.set(key, value);
}

export function clearMarkdownCodeHighlightCache(): void {
  highlightCache.clear();
}

function ensureLanguagesRegistered(): void {
  if (registered) return;
  hljs.registerLanguage("typescript", typescript);
  hljs.registerLanguage("javascript", javascript);
  hljs.registerLanguage("json", json);
  hljs.registerLanguage("bash", bash);
  hljs.registerLanguage("python", python);
  hljs.registerLanguage("rust", rust);
  hljs.registerLanguage("go", go);
  hljs.registerLanguage("java", java);
  hljs.registerLanguage("css", css);
  hljs.registerLanguage("xml", xml);
  hljs.registerLanguage("yaml", yaml);
  hljs.registerLanguage("sql", sql);
  hljs.registerLanguage("markdown", markdown);
  registered = true;
}

export function normalizeMarkdownCodeLanguage(lang: string): string {
  const trimmed = lang.trim().toLowerCase();
  if (!trimmed || trimmed === "text" || trimmed === "plaintext" || trimmed === "plain") {
    return "";
  }
  return LANG_ALIASES[trimmed] ?? trimmed;
}

const LANG_LABELS: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  json: "JSON",
  bash: "Bash",
  python: "Python",
  rust: "Rust",
  go: "Go",
  java: "Java",
  css: "CSS",
  xml: "XML",
  yaml: "YAML",
  sql: "SQL",
  markdown: "Markdown",
};

export function formatMarkdownCodeLanguageLabel(lang: string): string {
  const normalized = normalizeMarkdownCodeLanguage(lang);
  if (!normalized) return "";
  return LANG_LABELS[normalized] ?? normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function highlightMarkdownCode(
  text: string,
  lang: string,
): { html: string; resolvedLang: string } {
  if (!text) {
    return { html: "", resolvedLang: "" };
  }
  ensureLanguagesRegistered();
  const normalized = normalizeMarkdownCodeLanguage(lang);
  const cacheLang = normalized || lang.trim().toLowerCase();
  const cached = readHighlightCache(cacheLang, text);
  if (cached) return cached;

  let result: { html: string; resolvedLang: string };
  if (normalized && hljs.getLanguage(normalized)) {
    result = {
      html: hljs.highlight(text, { language: normalized }).value,
      resolvedLang: normalized,
    };
  } else {
    const auto = hljs.highlightAuto(text, [...AUTO_DETECT_LANGUAGES]);
    result = {
      html: auto.value,
      resolvedLang: auto.language ?? "",
    };
  }
  writeHighlightCache(cacheLang, text, result);
  return result;
}
