import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dart from "highlight.js/lib/languages/dart";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
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
  "c++": "cpp",
  cxx: "cpp",
  cc: "cpp",
  hpp: "cpp",
  h: "cpp",
  "c#": "csharp",
  cs: "csharp",
  rb: "ruby",
  kt: "kotlin",
  kts: "kotlin",
  toml: "ini",
  docker: "dockerfile",
  make: "makefile",
  gql: "graphql",
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
  "c",
  "cpp",
  "csharp",
  "ruby",
  "php",
  "dockerfile",
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
  hljs.registerLanguage("c", c);
  hljs.registerLanguage("cpp", cpp);
  hljs.registerLanguage("csharp", csharp);
  hljs.registerLanguage("ruby", ruby);
  hljs.registerLanguage("php", php);
  hljs.registerLanguage("kotlin", kotlin);
  hljs.registerLanguage("swift", swift);
  hljs.registerLanguage("dart", dart);
  hljs.registerLanguage("lua", lua);
  hljs.registerLanguage("scss", scss);
  hljs.registerLanguage("ini", ini);
  hljs.registerLanguage("makefile", makefile);
  hljs.registerLanguage("dockerfile", dockerfile);
  hljs.registerLanguage("diff", diff);
  hljs.registerLanguage("graphql", graphql);
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
  c: "C",
  cpp: "C++",
  csharp: "C#",
  ruby: "Ruby",
  php: "PHP",
  kotlin: "Kotlin",
  swift: "Swift",
  dart: "Dart",
  lua: "Lua",
  scss: "SCSS",
  ini: "INI",
  makefile: "Makefile",
  dockerfile: "Dockerfile",
  diff: "Diff",
  graphql: "GraphQL",
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
