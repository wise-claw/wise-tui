/** Claude / Codex 流式文本偶发 Unicode 行分隔符，解析器无法识别为换行。 */
export function normalizeMarkdownLineBreaks(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u2028/g, "\n")
    .replace(/\u2029/g, "\n\n")
    .replace(/\u0085/g, "\n");
}

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

const NUMBERED_STEP_RE = /^\d+\.\s/;

function htmlHeadingToMarkdown(level: number, rawBody: string): string {
  const text = stripInlineHtml(rawBody);
  if (!text) return "";
  if (NUMBERED_STEP_RE.test(text)) return `\n${text}\n`;
  const depth = Math.min(6, Math.max(1, level));
  const mdLevel = Math.min(depth, 3);
  return `\n\n${"#".repeat(mdLevel)} ${text}\n\n`;
}

/** 误将 `# 2. xxx`（HTML h1 步骤）当标题时，还原为有序列表行。 */
export function demoteNumberedMarkdownHeadings(text: string): string {
  return text.replace(/^#\s+(\d+\.\s)/gm, "$1");
}

const BARE_SHELL_LINE_RE =
  /^(?:claude\s+(?:mcp|code)?|npm\s+|bun\s+|pnpm\s+|yarn\s+|npx\s+|git\s+|curl\s+|sudo\s+)/i;

/** 独立行的 shell 命令自动包进 bash 围栏（模型常省略 ```）。跳过已在围栏内的行。 */
export function wrapBareShellCommandLines(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inFence = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      out.push(line);
      i += 1;
      continue;
    }

    if (inFence) {
      out.push(line);
      i += 1;
      continue;
    }

    if (!trimmed || !BARE_SHELL_LINE_RE.test(trimmed)) {
      out.push(line);
      i += 1;
      continue;
    }

    const block: string[] = [trimmed];
    i += 1;
    while (i < lines.length) {
      const next = lines[i]!.trim();
      if (!next || next.startsWith("```")) break;
      if (!BARE_SHELL_LINE_RE.test(next) && !/^(?:claude\s+|npx\s+-y\s+)/i.test(next)) break;
      block.push(next);
      i += 1;
    }
    out.push("```bash", ...block, "```");
  }

  return out.join("\n");
}

/** 行内混入的 `## 标题` / `` ```bash `` 前补空行。 */
function breakInlineMarkdownHeadings(text: string): string {
  return text.replace(/([^\n#])(#{1,6}\s)/g, "$1\n\n$2");
}

function breakInlineCodeFences(text: string): string {
  let s = text.replace(/([^\n`])(```[a-z]*)/gi, "$1\n\n$2");
  s = s.replace(/(```)\s+([^\n`])/g, "$1\n\n$2");
  return s;
}

const PIPE_ROW_ON_LINE_RE = /\|[^|\n]*(?:\|[^|\n]*)+\|/;

function breakPrefixBeforeInlinePipeTable(line: string): string {
  const firstPipe = line.indexOf("|");
  if (firstPipe <= 0) return line;
  const prefix = line.slice(0, firstPipe).trimEnd();
  const tablePart = line.slice(firstPipe).trim();
  if (!prefix || !PIPE_ROW_ON_LINE_RE.test(tablePart)) return line;
  return `${prefix}\n\n${tablePart}`;
}

function splitInlinePipeRowsOnLine(line: string): string {
  if (!line.includes("|")) return line;
  const withRowBreaks = /\|\s+\|/.test(line) ? line.replace(/\|\s+\|/g, "|\n|") : line;
  return breakPrefixBeforeInlinePipeTable(withRowBreaks);
}

/** 表格行尾粘连 `## 标题` 时拆开。 */
function splitTrailingContentAfterTableRow(line: string): string {
  return line.replace(/(\|(?:[^|\n]|\|[-:\s|]+)*\|)\s*(#{1,6}\s)/g, "$1\n\n$2");
}

/** Claude 助手消息：拆行内标题、表格、代码围栏后再解析。 */
export function normalizeInlineMarkdownStructures(text: string): string {
  let s = breakInlineMarkdownHeadings(text);
  s = breakInlineCodeFences(s);
  return s
    .split("\n")
    .map((line) => splitTrailingContentAfterTableRow(splitInlinePipeRowsOnLine(line)))
    .join("\n");
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
      const title = stripInlineHtml(body);
      return title ? htmlHeadingToMarkdown(Number(level), title) : "";
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
    .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_full, code: string) => {
      const body = stripInlineHtml(code);
      return body ? `\n\n\`\`\`bash\n${body}\n\`\`\`\n\n` : "";
    })
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_full, code: string) => {
      const body = stripInlineHtml(code);
      return body ? `\n\n\`\`\`\n${body}\n\`\`\`\n\n` : "";
    })
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_full, level: string, body: string) =>
      htmlHeadingToMarkdown(Number(level), body),
    )
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

function splitPipeRowCells(row: string): string[] {
  const trimmed = row.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return [];
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function buildPipeRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

/** 数据行列数多于表头时，将溢出列合并进最后一列，避免 remark-gfm 丢弃内容。 */
export function alignPipeTableDataRowsToHeader(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!PIPE_TABLE_ROW_RE.test(line.trim())) {
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

    const sepIdx = block.findIndex((row) => PIPE_TABLE_SEPARATOR_RE.test(row));
    const headerRow = sepIdx > 0 ? block[0] : sepIdx === -1 && block.length >= 2 ? block[0] : "";
    const headerCols = headerRow && !PIPE_TABLE_SEPARATOR_RE.test(headerRow) ? countPipeColumns(headerRow) : 0;

    if (headerCols >= 2) {
      out.push(
        ...block.map((row, idx) => {
          if (PIPE_TABLE_SEPARATOR_RE.test(row)) return row;
          if (idx === 0 && sepIdx === 1) return row;
          const cells = splitPipeRowCells(row);
          if (cells.length <= headerCols) return row;
          const kept = cells.slice(0, headerCols - 1);
          const merged = cells.slice(headerCols - 1).join(", ");
          return buildPipeRow([...kept, merged]);
        }),
      );
      continue;
    }

    out.push(...block);
  }

  return out.join("\n");
}

/** 表格分隔行 `|---|------|` 规范为 `| --- | --- |`（remark-gfm 要求空格）。 */
export function normalizeTableSeparatorRows(text: string): string {
  const lines = normalizePipeChars(text).split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!PIPE_TABLE_SEPARATOR_RE.test(trimmed)) {
      out.push(line);
      continue;
    }
    const needsSpaces = /^\|[\s:|\-]+\|$/.test(trimmed) && !/\|\s+[-:]{3,}\s+\|/.test(trimmed);
    if (!needsSpaces) {
      out.push(line);
      continue;
    }

    let cols = 0;
    for (let j = i - 1; j >= 0; j--) {
      const prev = lines[j]!.trim();
      if (!prev) continue;
      if (PIPE_TABLE_SEPARATOR_RE.test(prev)) continue;
      if (PIPE_TABLE_ROW_RE.test(prev)) {
        cols = countPipeColumns(prev);
        break;
      }
      break;
    }
    if (cols < 2) {
      cols = trimmed.split("|").filter((cell) => cell.trim().length > 0).length;
    }
    out.push(cols >= 2 ? buildSeparatorRow(cols) : line);
  }

  return out.join("\n");
}

/** 删除仅含单个 `|` 的孤立行，避免破坏后续 GFM 表格块。 */
export function removeOrphanPipeLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*\|\s*$/.test(line))
    .join("\n");
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

/** 确保 GFM 表格块前有空行，避免被解析器吸进段落或列表项。 */
function ensureBlankLineBeforePipeTables(text: string): string {
  return text
    .replace(/(^|\n)([^\n|][^\n]*)\n(\|[^\n]+\|)/g, (match, prefix, before, row) => {
      if (before.trim().startsWith("|")) return match;
      return `${prefix}${before}\n\n${row}`;
    })
    .replace(/(^|\n)([^\n|][^\n]*)(\|[^|\n]+\|)/g, (match, prefix, before, row) => {
      if (before.trim().endsWith("|")) return match;
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
  markdown = normalizeMarkdownLineBreaks(markdown);
  markdown = normalizeInlineMarkdownStructures(markdown);
  markdown = demoteNumberedMarkdownHeadings(markdown);
  markdown = wrapBareShellCommandLines(markdown);
  markdown = ensureBlankLineBeforePipeTables(markdown);
  markdown = removeOrphanPipeLines(markdown);
  markdown = normalizeTableSeparatorRows(markdown);
  markdown = alignPipeTableDataRowsToHeader(markdown);
  return normalizePipeTables(markdown);
}
