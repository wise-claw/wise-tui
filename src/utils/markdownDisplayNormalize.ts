/** Claude / Codex 流式文本偶发 Unicode 行分隔符，解析器无法识别为换行。 */
export function normalizeMarkdownLineBreaks(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u2028/g, "\n")
    .replace(/\u2029/g, "\n\n")
    .replace(/\u0085/g, "\n");
}

/**
 * 将内联 HTML 换行标签转为 Markdown 换行。
 * ReactMarkdown 默认转义内联 HTML；Codex / GLM 文档常混用 Markdown 与 `<br />`。
 */
export function normalizeInlineHtmlBreakTags(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&lt;br\s*\/?&gt;/gi, "\n");
}

/** 全角竖线 → ASCII，便于 GFM 表格解析。 */
function normalizePipeChars(text: string): string {
  return text.replace(/\uFF5C/g, "|");
}

/** 形如 `| a | b |` 的数据行（含首尾竖线）。 */
export const PIPE_TABLE_ROW_RE = /^\s*\|.+\|\s*$/;

/**
 * GFM 表格分隔行。允许 ASCII `+----+` 风格(用 `+` 而非 `|`)分隔段,
 * 配合 `breakCollapsedPipeTableOnLine` 把"塌成一行"的 pipe 表还原成多行。
 * 注意:塌行修复内部用 `/[-+]{3,}/` 做严格锚点,这里仅扩字符集。
 */
export const PIPE_TABLE_SEPARATOR_RE = /^\s*\|[\s:|\-+]+\|\s*$/;

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

/** 行首命令名（需后接子命令/参数才算命令行）。 */
const SHELL_COMMAND_HEAD_RE = /^(?:npm|bun|pnpm|yarn|npx|git|curl|sudo)\s+/i;

/**
 * `claude` 必须带子命令或参数才算命令行。
 *
 * 曾写作 `claude\s+(?:mcp|code)?`，子命令可选使整个分支退化成 `claude\s+`，
 * 于是「Claude 系统错误：请求频率超限…」这类中文说明被当成 shell 命令，
 * 在会话里被包成一个 Bash 代码块卡片（带语言徽标 / 换行 / 复制）。
 */
const CLAUDE_COMMAND_RE = /^claude\s+(?:mcp|code|-{1,2}[a-z])/i;

/**
 * CJK / 全角标点起头 → 中文说明文字，而非命令参数。
 * 含汉字、假名、CJK 标点（、。等）与全角符号，避免 `claude code、…` 被包成 Bash 卡片。
 */
const CJK_PROSE_HEAD_RE = /^[\u3400-\u9fff\u3040-\u30ff\u3000-\u303f\uff00-\uffef]/;

/**
 * 该行是否是「省略了围栏的裸 shell 命令」。
 *
 * 命令名后紧跟中文的一律不算：`git 状态读取失败`、`npm 安装失败` 是说明文字，
 * 而 `git commit -m "修复问题"` 参数里带中文仍是命令 —— 故只看命令名后首个字符。
 * `claude code` / `claude mcp` 同理：后接 CLI 参数才算命令，后接中文/中文标点不算。
 */
export function isBareShellCommandLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  const claudeMatch = CLAUDE_COMMAND_RE.exec(trimmed);
  if (claudeMatch) {
    const rest = trimmed.slice(claudeMatch[0].length).replace(/^\s+/, "");
    if (rest && CJK_PROSE_HEAD_RE.test(rest)) return false;
    return true;
  }

  const head = SHELL_COMMAND_HEAD_RE.exec(trimmed);
  if (!head) return false;
  return !CJK_PROSE_HEAD_RE.test(trimmed.slice(head[0].length));
}

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

    if (!isBareShellCommandLine(trimmed)) {
      out.push(line);
      i += 1;
      continue;
    }

    const block: string[] = [trimmed];
    i += 1;
    while (i < lines.length) {
      const next = lines[i]!.trim();
      if (!next || next.startsWith("```")) break;
      if (!isBareShellCommandLine(next)) break;
      block.push(next);
      i += 1;
    }
    out.push("```bash", ...block, "```");
  }

  return out.join("\n");
}

/** 目录树分支行（含行内 `# 注释` 时不得拆成 Markdown 标题）。 */
const DIR_TREE_LINE_RE = /(?:├──|└──|│|┃|┣|┗)/;

/**
 * 行内混入的 `## 标题` 前补空行。
 * - 跳过 ASCII/Unicode 目录树行（`├── path/    # 注释`）
 * - 仅在「非 # 字符后最多一个空白」时拆分，避免把多空格对齐注释拆成标题
 */
function breakInlineMarkdownHeadings(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (DIR_TREE_LINE_RE.test(line)) return line;
      return line.replace(/([^#\s])([ \t]?)(#{1,6}[ \t])/g, "$1\n\n$3");
    })
    .join("\n");
}

/**
 * 行内 `# 标题 **重点内容** 后续正文` 后段会被 marked 整体吞进 `<h2>`，
 * 这里按行扫描，若标题行内出现 `**` / `__` 等块级段落标记，则在首个标记处拆分。
 * 保守实现：只处理单行、未被反引号包裹的强调 token，标题文字为空时不拆。
 */
function breakTrailingInlineAfterHeadings(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  const headingRe = /^(#{1,6})\s+(.*)$/;

  // 标识 rest 中每个 index 是否落在 inline code span `` `...` `` 或被 `\\` 转义的位置上。
  function buildMask(rest: string): boolean[] {
    const mask = new Array(rest.length).fill(false);
    let i = 0;
    while (i < rest.length) {
      const ch = rest[i]!;
      if (ch === "\\" && i + 1 < rest.length) {
        mask[i] = true;
        mask[i + 1] = true;
        i += 2;
        continue;
      }
      if (ch === "`") {
        const close = rest.indexOf("`", i + 1);
        const end = close === -1 ? rest.length : close + 1;
        for (let j = i; j < end; j++) mask[j] = true;
        i = end;
        continue;
      }
      i += 1;
    }
    return mask;
  }

  // 在 rest 中查找第一个未被 mask 标记、且后续字符能闭合的强调 token 起首。
  function firstEmphasisStart(rest: string, mask: boolean[]): number {
    for (let i = 0; i < rest.length - 1; i++) {
      if (mask[i]) continue;
      const ch = rest[i]!;
      const next = rest[i + 1]!;
      if (ch === "*" && next === "*") {
        const close = rest.indexOf("**", i + 2);
        if (close !== -1 && !mask[close]) return i;
        i += 1;
        continue;
      }
      if (ch === "_" && next === "_") {
        const close = rest.indexOf("__", i + 2);
        if (close !== -1 && !mask[close]) return i;
        i += 1;
        continue;
      }
    }
    return -1;
  }

  for (const line of lines) {
    const match = headingRe.exec(line);
    if (!match) {
      out.push(line);
      continue;
    }
    const hashes = match[1] ?? "";
    const rest = match[2] ?? "";
    if (!rest.trim()) {
      out.push(line);
      continue;
    }

    const mask = buildMask(rest);
    const splitAt = firstEmphasisStart(rest, mask);
    if (splitAt === -1) {
      out.push(line);
      continue;
    }

    const titleText = rest.slice(0, splitAt).trimEnd();
    if (!titleText) {
      out.push(line);
      continue;
    }
    const tail = rest.slice(splitAt);
    if (!tail.trim()) {
      out.push(line);
      continue;
    }

    const head = `${hashes} ${titleText}`.trimEnd();
    out.push(head);
    out.push("");
    out.push(tail);
  }

  return out.join("\n");
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

/**
 * ASCII 分隔簇(≥3 个连续 `-` 或 `+`)——用于"塌成一行"的 pipe table 锚点。
 * 比 `PIPE_TABLE_SEPARATOR_RE` 更严,避免 `| foo + bar |` 这种 C++ / shell
 * 注释式短行被误判。
 */
const COLLAPSED_PIPE_TABLE_ANCHOR_RE = /[-+]{3,}/;

/**
 * 检测并拆开"整段塌成一行"的 pipe table:表头行 + ASCII `+----+` 分隔行 +
 * 数据行全部紧贴在一起,中间无 `\n`,导致 marked-gfm 无法识别成表格。
 *
 * 拆法:以第一个 ASCII 分隔簇为锚点,把行切成 headerChunk / sepCluster /
 * dataChunk,给 dataChunk 补前导 `|`,并按表头列数对齐数据行(溢出列合并到末列),
 * 输出规范的「表头 + 分隔行 + 数据」三行 GFM 表格,让 marked-gfm 正确识别。
 *
 * 失败回退:不满足任一前置条件时原样返回输入,不做修改。
 */
export function breakCollapsedPipeTableOnLine(line: string): string {
  if (!line.includes("|")) return line;
  if (!COLLAPSED_PIPE_TABLE_ANCHOR_RE.test(line)) return line;
  if (!line.trim().startsWith("|")) return line;

  const anchorMatch = COLLAPSED_PIPE_TABLE_ANCHOR_RE.exec(line);
  if (!anchorMatch) return line;
  const anchorIndex = anchorMatch.index;

  // headerChunk 保留到锚点开始处;trim 掉尾部空格
  let headerChunk = line.slice(0, anchorIndex).trimEnd();
  let dataChunk = line.slice(anchorIndex + anchorMatch[0].length);
  // 表头常以裸文本结尾（模型漏了末 `|`），给 headerChunk 补末 `|`，让 marked
  // 能正确把表头识别为 header row 并按 cell 数对齐分隔行。
  if (headerChunk && !headerChunk.endsWith("|")) {
    headerChunk = `${headerChunk} |`;
  }
  // 数据行常以裸数字/文字起首（模型漏了 `|`），给 dataChunk 补前导 `|`。
  if (dataChunk) {
    dataChunk = dataChunk.trimStart();
    if (!dataChunk.startsWith("|")) {
      dataChunk = `| ${dataChunk}`;
    }
  }

  const headerCols = countPipeColumns(headerChunk);
  const dataCols = countPipeColumns(dataChunk);
  if (headerCols < 2 && dataCols < 2) return line;

  // 防误伤：纯分隔行（`| --- | --- | --- |`）虽然命中 [-+]{3,} 簇，但锚点
  // 前只有 `| ` / ` ---` 等纯分隔片段，headerCols 计算虽 ≥2 却全是 `---` /
  // `+++` 的占位、不是真实表头文本。需要锚点前存在「非 `-` / `+` 字符」的
  // 真表头内容，才走拆行；否则原样返回让其他 pass（如 normalizeTableSeparatorRows）处理。
  const headerBeforeAnchor = line.slice(0, anchorIndex);
  const hasRealHeaderText = /[^\s|:\-+]/.test(headerBeforeAnchor);
  if (!hasRealHeaderText) return line;

  // 列宽以表头为准（GFM 要求 sep 列数 = header 列数），表头常见漏末 `|`，
  // 所以 headerCols 经常比数据少；数据行若多出列，把溢出列合并到末列。
  const columns = headerCols >= 2 ? headerCols : dataCols;
  const sepRow = buildSeparatorRow(columns);

  let dataRow = dataChunk;
  if (dataCols > columns) {
    const cells = dataChunk
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    const kept = cells.slice(0, columns - 1);
    const merged = cells.slice(columns - 1).join(", ");
    dataRow = `| ${[...kept, merged].join(" | ")} |`;
  } else if (!dataRow.endsWith("|")) {
    // 数据行通常漏掉末 `|`,这里补上,让 marked 把整行识别为单行 pipe row。
    dataRow = `${dataRow.trimEnd()} |`;
  }

  return `${headerChunk}\n${sepRow}\n${dataRow}`.trimEnd();
}

function splitInlinePipeRowsOnLine(line: string): string {
  if (!line.includes("|")) return line;
  // 分隔行（`---` / `+++` / `---:` 之类的列对齐线）不参与行内切分，
  // 否则 `| --- | --- |` 内部的 `|\s+\|` 会被替换成多行，破坏表格结构。
  if (PIPE_TABLE_SEPARATOR_RE.test(line.trim())) return line;
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
  s = breakTrailingInlineAfterHeadings(s);
  s = breakInlineCodeFences(s);
  return s
    .split("\n")
    .map((line) => breakCollapsedPipeTableOnLine(line))
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
 * 把「pipe 表头行 + 1 行非 pipe 短文本 + 多行 pipe 数据行」中的非 pipe 短文本
 * 移出表格块，前后补空行，让 GFM 能正常识别为完整表格。
 *
 * 典型来源：模型把 PR 编号 / 备注等纯文本塞在表头与数据行之间，导致整段
 * 被 GFM 当作段落渲染、`|` 原文裸显。
 */
export function recoverSplitPipeTableBlocks(text: string): string {
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

    // 先收集「紧跟表头之后」的连续 pipe 行（含空行）
    const headBlock: string[] = [line];
    let j = i + 1;
    while (j < lines.length) {
      const current = lines[j]!.trim();
      if (!current) {
        const peek = j + 1;
        if (peek < lines.length && PIPE_TABLE_ROW_RE.test(lines[peek]!.trim())) {
          headBlock.push(lines[j]!);
          j += 1;
          continue;
        }
        break;
      }
      if (PIPE_TABLE_ROW_RE.test(current)) {
        headBlock.push(current);
        j += 1;
        continue;
      }
      break;
    }

    // headBlock 至少要 ≥1 行 pipe 且 headBlock[0] 是表头
    if (headBlock.length === 0) {
      out.push(line);
      i += 1;
      continue;
    }

    // 表头只有 1 行：检查 j 之后是否紧跟「1 行非 pipe 短文本 + 多行 pipe 数据」
    if (headBlock.length === 1 && j < lines.length) {
      const middleRaw = lines[j]!;
      const middleTrim = middleRaw.trim();
      // 短文本判定：≤80 字符、不含 `|`、不含 ```、不含 # 标题前缀
      const looksLikeShortInterruption =
        middleTrim.length > 0 &&
        middleTrim.length <= 80 &&
        !middleTrim.includes("|") &&
        !middleTrim.startsWith("```") &&
        !/^#{1,6}\s/.test(middleTrim) &&
        !PIPE_TABLE_SEPARATOR_RE.test(middleTrim);
      if (looksLikeShortInterruption) {
        const tailStart = j + 1;
        // tail 必须有 ≥1 行 pipe 数据
        let k = tailStart;
        let tailPipeCount = 0;
        while (k < lines.length) {
          const cur = lines[k]!.trim();
          if (!cur) {
            const peek = k + 1;
            if (peek < lines.length && PIPE_TABLE_ROW_RE.test(lines[peek]!.trim())) {
              k = peek;
              continue;
            }
            break;
          }
          if (PIPE_TABLE_ROW_RE.test(cur)) {
            tailPipeCount += 1;
            k += 1;
            continue;
          }
          break;
        }
        if (tailPipeCount >= 1) {
          // 表头 + 分隔行 + tail 数据连续（让 GFM 识别成完整表格），
          // 短文本作为表格下方 caption，前后空行隔开。
          const headerCols = countPipeColumns(headBlock[0]!);
          out.push(headBlock[0]!);
          if (headerCols >= 2 && !PIPE_TABLE_SEPARATOR_RE.test(headBlock[0]!)) {
            out.push(buildSeparatorRow(headerCols));
          } else {
            out.push(...headBlock.slice(1));
          }
          // tail 数据
          for (let t = tailStart; t < k; t += 1) {
            out.push(lines[t]!);
          }
          // 短文本作为 caption，前后空行
          out.push("");
          out.push(middleRaw);
          i = k;
          continue;
        }
      }
    }

    // 默认：原样写出 headBlock，i 推进
    out.push(...headBlock);
    i = j;
  }

  return out.join("\n");
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

/**
 * 缺前导 `|` 的 pipe 行：`**chat** | 默认主屏：… |`
 * 模型常这样写数据行；若直接交给 ensureBlankLineBeforePipeTables，会把首格拆成段落、
 * 其余 `| … |` 裸显，整表崩坏。
 */
function isLoosePipeRow(trimmed: string): boolean {
  if (!trimmed || trimmed.startsWith("|") || trimmed.startsWith("```")) return false;
  if (!trimmed.endsWith("|")) return false;
  // 至少两格：text|text|
  return trimmed.slice(0, -1).includes("|");
}

/**
 * 裸分隔行：`--------------|` / `--------------` / `---|---|---`（无完整首尾 `|`）。
 * 已是 `| --- | --- |` 形态的交给 normalizeTableSeparatorRows。
 */
function isBareSeparatorLine(trimmed: string): boolean {
  if (!trimmed) return false;
  if (PIPE_TABLE_SEPARATOR_RE.test(trimmed)) return false;
  if (/^:?-{3,}\|?$/.test(trimmed)) return true;
  return /^:?-{3,}(?:\s*\|\s*:?-{3,})+\|?$/.test(trimmed) && !trimmed.startsWith("|");
}

function peekNonEmptyLine(lines: readonly string[], from: number, dir: -1 | 1): string | null {
  let i = from + dir;
  while (i >= 0 && i < lines.length) {
    const trimmed = lines[i]!.trim();
    if (trimmed) return trimmed;
    i += dir;
  }
  return null;
}

function isPipeTableBoundaryLine(trimmed: string): boolean {
  return (
    PIPE_TABLE_ROW_RE.test(trimmed)
    || PIPE_TABLE_SEPARATOR_RE.test(trimmed)
    || isBareSeparatorLine(trimmed)
    || isLoosePipeRow(trimmed)
  );
}

function isInPipeTableContext(lines: readonly string[], index: number): boolean {
  const prev = peekNonEmptyLine(lines, index, -1);
  const next = peekNonEmptyLine(lines, index, 1);
  return Boolean(
    (prev && isPipeTableBoundaryLine(prev)) || (next && isPipeTableBoundaryLine(next)),
  );
}

function countLooseOrPipeColumns(row: string): number {
  const trimmed = row.trim();
  if (PIPE_TABLE_ROW_RE.test(trimmed)) return countPipeColumns(trimmed);
  if (isLoosePipeRow(trimmed)) return countPipeColumns(`| ${trimmed}`);
  return 0;
}

function findPrecedingHeaderCols(lines: readonly string[], sepIndex: number): number {
  for (let j = sepIndex - 1; j >= 0; j -= 1) {
    const prev = lines[j]!.trim();
    if (!prev) continue;
    if (PIPE_TABLE_SEPARATOR_RE.test(prev) || isBareSeparatorLine(prev)) continue;
    const cols = countLooseOrPipeColumns(prev);
    if (cols >= 2) return cols;
    break;
  }
  return 0;
}

/**
 * 修复 LLM 常见的残缺 pipe 表语法，须在 ensureBlankLineBeforePipeTables 之前运行：
 * 1. `--------------|` → `| --- | --- |`（按表头列数）
 * 2. `**chat** | 说明 |` → `| **chat** | 说明 |`
 */
export function repairLoosePipeTableSyntax(text: string): string {
  const lines = normalizePipeChars(text).split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (isBareSeparatorLine(trimmed)) {
      const headerCols = findPrecedingHeaderCols(lines, i);
      if (headerCols >= 2) {
        out.push(buildSeparatorRow(headerCols));
        continue;
      }
    }

    if (isLoosePipeRow(trimmed) && isInPipeTableContext(lines, i)) {
      out.push(`| ${trimmed}`);
      continue;
    }

    out.push(line);
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
  // 先补全缺前导 `|` 的数据行 / 裸分隔行，再插入表前空行——否则
  // ensureBlankLineBeforePipeTables 会把 `**chat** | 说明 |` 拆成段落 + 裸 `|`。
  markdown = repairLoosePipeTableSyntax(markdown);
  markdown = ensureBlankLineBeforePipeTables(markdown);
  markdown = removeOrphanPipeLines(markdown);
  markdown = recoverSplitPipeTableBlocks(markdown);
  markdown = normalizeTableSeparatorRows(markdown);
  markdown = alignPipeTableDataRowsToHeader(markdown);
  markdown = normalizePipeTables(markdown);
  return normalizeInlineHtmlBreakTags(markdown);
}
