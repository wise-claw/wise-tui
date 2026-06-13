/** 全角竖线 → ASCII，便于 GFM 表格解析。 */
function normalizePipeChars(text: string): string {
  return text.replace(/\uFF5C/g, "|");
}

/** 形如 `| a | b |` 的数据行（含首尾竖线）。 */
const PIPE_TABLE_ROW_RE = /^\s*\|.+\|\s*$/;

/** GFM 表格分隔行。 */
const PIPE_TABLE_SEPARATOR_RE = /^\s*\|[\s:|\-]+\|\s*$/;

import { findHtmlDocumentStartIndex } from "./richMessageHtml";

export type MarkdownDisplayNormalizeOptions = {
  /** 流式输出：HTML 文档/片段可能未闭合，需剥掉 head 等壳层残留。 */
  streaming?: boolean;
};

/** GLM / Codex 等模型常返回的 HTML 片段（非完整 HTML 文档）。 */
const LLM_HTML_FRAGMENT_RE =
  /<\/?(?:p|h[1-6]|ol|ul|li|table|thead|tbody|tr|td|th|div|span|br|strong|em|b|i|blockquote|pre|code|a|img|hr)\b/i;

/** 流式阶段：更宽地识别需转换的 HTML 标记（含未闭合标签）。 */
const STREAMING_HTML_MARKUP_RE =
  /<(?:\/?(?:p|h[1-6]|ol|ul|li|table|thead|tbody|tr|td|th|div|span|br|strong|em|b|i|blockquote|pre|code|a|img|hr|head|body|meta|link|title)\b|!--)/i;

function countPipeColumns(row: string): number {
  const trimmed = row.trim();
  if (!trimmed.startsWith("|")) return 0;
  const cells = trimmed.split("|").filter((cell) => cell.trim().length > 0);
  return cells.length;
}

function buildSeparatorRow(columnCount: number): string {
  if (columnCount <= 0) return "";
  return `|${Array(columnCount).fill(" --- ").join("|")}|`;
}

function decodeBasicHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripInlineHtml(text: string): string {
  return decodeBasicHtmlEntities(text.replace(/<[^>]+>/g, "").trim());
}

export function looksLikeLlmHtmlFragment(text: string): boolean {
  const trimmed = text.trim();
  if (!LLM_HTML_FRAGMENT_RE.test(trimmed)) return false;
  if (/<!doctype\s+html\b|<html[\s>/]/i.test(trimmed)) return false;
  return true;
}

/** 流式输出中是否仍含需转换/剥离的 HTML 标记。 */
export function containsStreamingHtmlMarkup(text: string): boolean {
  return STREAMING_HTML_MARKUP_RE.test(text);
}

function shouldConvertHtmlFragment(text: string, opts?: MarkdownDisplayNormalizeOptions): boolean {
  if (looksLikeLlmHtmlFragment(text)) return true;
  return Boolean(opts?.streaming && containsStreamingHtmlMarkup(text));
}

/** 流式未闭合标签 → Markdown（标题/段落/链接/列表项）。 */
function convertPartialStreamingHtmlTags(text: string): string {
  return text
    .replace(/<h([1-6])[^>]*>([^<]*)$/gi, (_, level: string, body: string) => {
      const depth = Math.min(6, Math.max(1, Number(level)));
      const title = stripInlineHtml(body);
      return title ? `\n\n${"#".repeat(depth)} ${title}\n\n` : "";
    })
    .replace(/<p[^>]*>([^<]*)$/gi, (_, body: string) => {
      const content = stripInlineHtml(body);
      return content ? `\n\n${content}\n\n` : "";
    })
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([^<]*)$/gi, (_, href: string, label: string) => {
      const linkText = stripInlineHtml(label) || href;
      return `[${linkText}](${href})`;
    })
    .replace(/<li[^>]*>([^<]*)$/gi, (_, body: string) => {
      const item = stripInlineHtml(body);
      return item ? `\n- ${item}` : "";
    });
}

function convertHtmlTableBlockToMarkdown(
  tableHtml: string,
  opts?: MarkdownDisplayNormalizeOptions,
): string {
  const rows: string[][] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)(?:<\/tr>|$)/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(tableHtml)) !== null) {
    const cells: string[] = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)(?:<\/t[dh]>|$)/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1]!)) !== null) {
      const cell = stripInlineHtml(cellMatch[1]!);
      if (cell) cells.push(cell);
    }
    if (cells.length > 0) rows.push(cells);
  }
  if (rows.length === 0) {
    return opts?.streaming ? "" : tableHtml;
  }
  return rows.map((cells) => `| ${cells.join(" | ")} |`).join("\n");
}

/**
 * 将 GLM / 第三方模型返回的 HTML 片段还原为 Markdown 文本，
 * 避免 marked 原样保留 `<p>` / `<ol>` 而把 pipe 表格锁在段落里。
 */
export function llmHtmlFragmentToMarkdown(
  text: string,
  opts?: MarkdownDisplayNormalizeOptions,
): string {
  if (!shouldConvertHtmlFragment(text, opts)) return text;

  let s = text.trim();
  if (opts?.streaming) {
    s = convertPartialStreamingHtmlTags(s);
  }

  s = s.replace(/<table[^>]*>([\s\S]*?)(?:<\/table>|$)/gi, (_full, inner: string) => {
    const md = convertHtmlTableBlockToMarkdown(`<table>${inner}</table>`, opts);
    return md.includes("|") ? `\n\n${md}\n\n` : opts?.streaming ? "" : _full;
  });

  if (opts?.streaming && /<table[\s>]/i.test(s)) {
    const md = convertHtmlTableBlockToMarkdown(s, opts);
    if (md.includes("|")) {
      s = s.replace(/<table[\s\S]*$/i, `\n\n${md}\n\n`);
    }
  }

  s = s
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, body: string) => {
      const depth = Math.min(6, Math.max(1, Number(level)));
      return `\n\n${"#".repeat(depth)} ${stripInlineHtml(body)}\n\n`;
    })
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
      const linkText = stripInlineHtml(label) || href;
      return `[${linkText}](${href})`;
    })
    .replace(/<\/?(?:ol|ul)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<\/?(?:div|span|strong|em|b|i|blockquote|pre|code)[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "");

  return decodeBasicHtmlEntities(s)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 为缺少 `|---|---|` 的 pipe 表格补分隔行（GLM / Codex 等常省略）。
 * 仅处理连续 2 行及以上的 pipe 行块。
 */
export function normalizePipeTables(text: string): string {
  const lines = normalizePipeChars(text).split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!PIPE_TABLE_ROW_RE.test(line)) {
      out.push(line);
      i += 1;
      continue;
    }

    const block: string[] = [];
    while (i < lines.length) {
      const current = lines[i]!.trim();
      if (!current) {
        let j = i + 1;
        while (j < lines.length && !lines[j]!.trim()) j += 1;
        if (j < lines.length && PIPE_TABLE_ROW_RE.test(lines[j]!.trim())) {
          i = j;
          continue;
        }
        break;
      }
      if (PIPE_TABLE_ROW_RE.test(current)) {
        block.push(current);
        i += 1;
        continue;
      }
      break;
    }

    const hasSeparator = block.some((row) => PIPE_TABLE_SEPARATOR_RE.test(row));
    if (block.length >= 2 && !hasSeparator) {
      const columns = countPipeColumns(block[0]!);
      if (columns >= 2) {
        out.push(block[0]!);
        out.push(buildSeparatorRow(columns));
        out.push(...block.slice(1));
        continue;
      }
    }

    out.push(...block);
  }

  return out.join("\n");
}

/** 确保 GFM 表格块前有空行，避免被 marked 吸进列表项。 */
function ensureBlankLineBeforePipeTables(text: string): string {
  return text.replace(/(^|\n)([^\n|][^\n]*)\n(\|[^\n]+\|)/g, (match, prefix, before, row) => {
    if (before.trim().startsWith("|")) return match;
    return `${prefix}${before}\n\n${row}`;
  });
}

function extractHtmlBodyContent(html: string, opts?: MarkdownDisplayNormalizeOptions): string {
  const streaming = opts?.streaming ?? false;
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (bodyMatch?.[1]) return bodyMatch[1].trim();

  if (streaming) {
    const partialBody = /<body[^>]*>([\s\S]*)/i.exec(html);
    if (partialBody?.[1]) return partialBody[1].trim();
  }

  let stripped = html
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<\/?html[^>]*>/gi, "");

  if (streaming) {
    stripped = stripped.replace(/<head[\s\S]*/gi, "");
    const trailingBody = /<body[^>]*>([\s\S]*)/i.exec(stripped);
    if (trailingBody?.[1]) return trailingBody[1].trim();
    return stripped.replace(/<[^>\n]*>/g, "").trim();
  }

  stripped = stripped.replace(/<head[\s\S]*?<\/head>/gi, "");
  return stripped.trim();
}

/** 流式阶段若仍有未转换 HTML 标签，剥掉以免 marked 原样渲染 DOM。 */
function stripUnconvertedHtmlMarkup(text: string): string {
  return decodeBasicHtmlEntities(
    text
      .replace(/<\/?[a-z][^>]*>/gi, "")
      .replace(/<[^>\n]*$/g, ""),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 完整 HTML 文档（Codex 等）转为 Markdown 文本，供 marked 解析。 */
export function htmlDocumentToMarkdown(
  text: string,
  opts?: MarkdownDisplayNormalizeOptions,
): string {
  const trimmed = text.trim();
  if (!/<!doctype\s+html\b|<html[\s>/]/i.test(trimmed)) return text;
  const body = extractHtmlBodyContent(trimmed, opts);
  if (!body.trim()) return "";
  return llmHtmlFragmentToMarkdown(body, opts);
}

/** 渲染前统一规范化助手 Markdown（HTML 文档/片段、表格、全角符号等）。 */
export function normalizeMarkdownForDisplay(
  text: string,
  opts?: MarkdownDisplayNormalizeOptions,
): string {
  const docIdx = findHtmlDocumentStartIndex(text);
  let source = text;
  if (docIdx !== null) {
    const preamble = text.slice(0, docIdx).trimEnd();
    const htmlDoc = text.slice(docIdx).trim();
    const htmlAsMd = htmlDocumentToMarkdown(htmlDoc, opts);
    source = preamble ? `${preamble}\n\n${htmlAsMd}` : htmlAsMd;
  }
  let markdown = llmHtmlFragmentToMarkdown(source, opts);
  if (opts?.streaming && /<[a-z!/]/i.test(markdown)) {
    markdown = stripUnconvertedHtmlMarkup(markdown);
  }
  return normalizePipeTables(ensureBlankLineBeforePipeTables(markdown));
}
