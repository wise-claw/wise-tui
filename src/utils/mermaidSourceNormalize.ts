const QUOTED_LABEL_PAIRS: Array<[string, string]> = [
  ['["', '"]'],
  ['[("', '")]'],
  ['(("', '"))'],
  ['("', '")'],
];

const CIRCLED_NUMBER_RE = /[\u2460-\u2473]/g;

function sanitizeLabelContent(text: string): string {
  return text
    .replace(/-->/g, "→")
    .replace(/->/g, "→")
    .replace(CIRCLED_NUMBER_RE, (char) => {
      const code = char.charCodeAt(0) - 0x2460 + 1;
      return `(${code})`;
    });
}

/** 将节点 / subgraph 标签内的真实换行转为 Mermaid 支持的 <br/>。 */
function normalizeMultilineQuotedLabels(source: string): string {
  let out = "";
  let i = 0;

  while (i < source.length) {
    const matched = QUOTED_LABEL_PAIRS.find(([open]) => source.startsWith(open, i));
    if (matched) {
      const [open, close] = matched;
      out += open;
      i += open.length;
      let label = "";
      let closed = false;
      while (i < source.length) {
        if (source.startsWith(close, i)) {
          out += sanitizeLabelContent(label);
          out += close;
          i += close.length;
          closed = true;
          break;
        }
        const ch = source[i] ?? "";
        if (ch === "\r") {
          i += 1;
          continue;
        }
        if (ch === "\n") {
          label += "<br/>";
          i += 1;
          continue;
        }
        label += ch;
        i += 1;
      }
      if (!closed) {
        out += sanitizeLabelContent(label);
      }
      continue;
    }

    out += source[i] ?? "";
    i += 1;
  }

  return out;
}

/** 补全行内未闭合的 ["... 标签。 */
function repairDanglingQuotedLabels(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      const trimmed = line.trimEnd();
      if (/\["/.test(trimmed) && !/"\]/.test(trimmed) && trimmed.endsWith('"')) {
        return `${line}]`;
      }
      const opens = (line.match(/\["/g) ?? []).length;
      const closes = (line.match(/"\]/g) ?? []).length;
      if (opens > closes) {
        return `${line}${'"]'.repeat(opens - closes)}`;
      }
      return line;
    })
    .join("\n");
}

/** 补全缺失的 subgraph `end`，避免模型输出截断导致解析失败。 */
function balanceSubgraphEnds(source: string): string {
  const lines = source.split("\n");
  let depth = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^subgraph\b/i.test(trimmed)) depth += 1;
    else if (/^end\b/i.test(trimmed)) depth = Math.max(0, depth - 1);
  }
  if (depth <= 0) return source;
  return `${source}\n${"end\n".repeat(depth)}`.trimEnd();
}

function decodeBasicHtmlEntities(text: string): string {
  return text
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripZeroWidthChars(text: string): string {
  return text.replace(/[\u200b-\u200d\ufeff]/g, "");
}

const IMPLICIT_CONNECTION_LINE_KEYWORDS = new Set([
  "flowchart",
  "graph",
  "subgraph",
  "end",
  "class",
  "classdef",
  "style",
  "direction",
  "linkstyle",
  "click",
]);

/** 将 `LOOP  CTX` 这类缺箭头的连接补为 `LOOP --> CTX`。 */
function repairImplicitConnections(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("%%")) return line;
      const firstToken = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";
      if (IMPLICIT_CONNECTION_LINE_KEYWORDS.has(firstToken)) return line;
      if (/(-->|---|==>|\.->|<-->|&|::|\[|\]|\"|\(|\)|\{|\}|\/)/.test(trimmed)) {
        return line;
      }
      const match = trimmed.match(/^([A-Za-z_][\w]*)\s+([A-Za-z_][\w]*)$/);
      if (!match) return line;
      const indent = line.match(/^\s*/)?.[0] ?? "";
      return `${indent}${match[1]} --> ${match[2]}`;
    })
    .join("\n");
}

export type MermaidNormalizeOptions = {
  /** 去掉 <br/>，适合 htmlLabels=false 渲染。 */
  plainLabels?: boolean;
  /** 更激进的兼容性修复。 */
  aggressive?: boolean;
};

/** 渲染前修正模型常见 Mermaid 语法问题。 */
export function normalizeMermaidSourceForRender(
  source: string,
  opts?: MermaidNormalizeOptions,
): string {
  let normalized = stripZeroWidthChars(decodeBasicHtmlEntities(source))
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u00a0/g, " ")
    .replace(/\t/g, "  ")
    .replace(/\r\n/g, "\n");

  normalized = normalizeMultilineQuotedLabels(normalized);
  normalized = repairDanglingQuotedLabels(normalized);
  normalized = repairImplicitConnections(normalized);
  normalized = balanceSubgraphEnds(normalized);

  if (opts?.aggressive) {
    normalized = normalized
      .replace(/^\s*direction\s+(?:TB|TD|BT|RL|LR)\s*$/gim, "")
      .replace(/\n{3,}/g, "\n\n");
  }

  if (opts?.plainLabels) {
    normalized = normalized.replace(/<br\s*\/?>/gi, " / ");
  }

  return normalized.trim();
}

export type MermaidRenderAttempt = {
  source: string;
  htmlLabels: boolean;
  securityLevel: "loose" | "sandbox";
};

/** 生成多级渲染回退序列（优先 SVG 文本标签，避开 htmlLabels + DOMPurify 路径）。 */
export function buildMermaidRenderAttempts(rawSource: string): MermaidRenderAttempt[] {
  const variants = [
    normalizeMermaidSourceForRender(rawSource, { plainLabels: true }),
    normalizeMermaidSourceForRender(rawSource, { plainLabels: true, aggressive: true }),
    normalizeMermaidSourceForRender(rawSource),
    normalizeMermaidSourceForRender(rawSource, { aggressive: true }),
  ];

  const uniqueSources: string[] = [];
  const seen = new Set<string>();
  for (const source of variants) {
    if (!source || seen.has(source)) continue;
    seen.add(source);
    uniqueSources.push(source);
  }

  const attempts: MermaidRenderAttempt[] = [];
  for (const source of uniqueSources) {
    attempts.push({ source, htmlLabels: false, securityLevel: "loose" });
    attempts.push({ source, htmlLabels: true, securityLevel: "loose" });
  }
  const fallbackSource = uniqueSources[0];
  if (fallbackSource) {
    attempts.push({ source: fallbackSource, htmlLabels: false, securityLevel: "sandbox" });
  }
  return attempts;
}

/** @deprecated 使用 {@link buildMermaidRenderAttempts} */
export function buildMermaidRenderCandidates(rawSource: string): string[] {
  return buildMermaidRenderAttempts(rawSource).map((item) => item.source);
}
