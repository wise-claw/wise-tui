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
  ensureLanguagesRegistered();
  const normalized = normalizeMarkdownCodeLanguage(lang);
  if (normalized && hljs.getLanguage(normalized)) {
    return {
      html: hljs.highlight(text, { language: normalized }).value,
      resolvedLang: normalized,
    };
  }
  const auto = hljs.highlightAuto(text, [...AUTO_DETECT_LANGUAGES]);
  return {
    html: auto.value,
    resolvedLang: auto.language ?? "",
  };
}
