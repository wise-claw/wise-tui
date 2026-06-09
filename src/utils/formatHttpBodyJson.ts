/** FCC trace / LLM 代理预览截断后缀（与 `fcc_traces.rs` 一致）。 */
export const HTTP_BODY_TRUNCATION_MARKER = "…[truncated]";

const TRUNCATION_NOTICE = "\n\n/* …预览已截断，完整内容见 trace 文件 */";

export function stripHttpBodyTruncationMarker(raw: string): {
  body: string;
  wasTruncated: boolean;
} {
  const idx = raw.indexOf(HTTP_BODY_TRUNCATION_MARKER);
  if (idx >= 0) {
    return { body: raw.slice(0, idx).trimEnd(), wasTruncated: true };
  }
  return { body: raw, wasTruncated: false };
}

function stringifyPretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function tryParseJsonValue(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** 解析成功则展开嵌套 JSON 字符串（如双重编码的 body）。 */
function normalizeParsedRoot(parsed: unknown): unknown {
  if (typeof parsed !== "string") return parsed;
  const inner = parsed.trim();
  if ((inner.startsWith("{") || inner.startsWith("[")) && inner.length >= 2) {
    const nested = tryParseJsonValue(inner);
    if (nested !== null) return nested;
  }
  return parsed;
}

function tryPrettyCompleteJson(body: string): string | null {
  const parsed = tryParseJsonValue(body);
  if (parsed === null) return null;
  return stringifyPretty(normalizeParsedRoot(parsed));
}

const PARTIAL_JSON_CLOSERS = [
  "",
  "}",
  "]}",
  '"}',
  '"]}',
  '"}]}',
  '""]}',
  "null]}",
  '"}]}}',
] as const;

/** 截断导致 JSON 不完整时，尝试补全括号后解析。 */
function tryPrettyPartialJson(body: string): string | null {
  let text = body.trimEnd();
  for (let attempt = 0; attempt < 64 && text.length > 1; attempt++) {
    for (const suffix of PARTIAL_JSON_CLOSERS) {
      const parsed = tryParseJsonValue(text + suffix);
      if (parsed !== null) {
        return stringifyPretty(normalizeParsedRoot(parsed));
      }
    }
    const trimmed = text.replace(/,\s*$/, "").trimEnd();
    if (trimmed === text) {
      text = text.slice(0, -1).trimEnd();
    } else {
      text = trimmed;
    }
  }
  return null;
}

function tryPrettyNdjsonLines(lines: readonly string[]): string | null {
  const pretties: string[] = [];
  for (const line of lines) {
    const pretty = tryPrettyCompleteJson(line);
    if (!pretty) return null;
    pretties.push(pretty);
  }
  return pretties.join("\n\n");
}

/**
 * 将 HTTP 请求/响应预览格式化为缩进 JSON；支持截断后缀与 NDJSON。
 */
export function formatHttpBodyJsonForDisplay(raw: string | null | undefined): string {
  if (raw == null) return "";
  const trimmed = raw.trim();
  if (!trimmed) return raw;

  const { body, wasTruncated } = stripHttpBodyTruncationMarker(trimmed);
  if (!body.trim()) return raw;

  const complete = tryPrettyCompleteJson(body);
  if (complete) {
    return wasTruncated ? complete + TRUNCATION_NOTICE : complete;
  }

  if (wasTruncated) {
    const partial = tryPrettyPartialJson(body);
    if (partial) return partial + TRUNCATION_NOTICE;
  }

  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    const nd = tryPrettyNdjsonLines(lines);
    if (nd) return wasTruncated ? nd + TRUNCATION_NOTICE : nd;
  }

  return raw;
}

export type HttpTraceBodySectionKind = "request" | "response" | "upstream";

export interface HttpTraceDetailSection {
  kind: "meta" | HttpTraceBodySectionKind;
  content: string;
}

const HTTP_TRACE_DETAIL_SPLIT = "\n\n---\n\n";
const HTTP_TRACE_BODY_SECTION_RE =
  /^(request|response|upstream):\s*\n?([\s\S]*)$/i;

/** 解析 `fccTraceHttpDetail` / `llmProxyHttpDetail` 拼接的详情文本。 */
export function parseHttpTraceDetailSections(detail: string): HttpTraceDetailSection[] {
  const trimmed = detail.trim();
  if (!trimmed) return [];

  return trimmed
    .split(HTTP_TRACE_DETAIL_SPLIT)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(HTTP_TRACE_BODY_SECTION_RE);
      if (!match) {
        return { kind: "meta" as const, content: part };
      }
      const kind = match[1]!.toLowerCase() as HttpTraceBodySectionKind;
      return { kind, content: (match[2] ?? "").trim() };
    });
}

/** 将 HTTP trace 详情中的 request/response/upstream 块格式化为缩进 JSON。 */
export function formatHttpTraceDetailForDisplay(detail: string): string {
  const sections = parseHttpTraceDetailSections(detail);
  if (sections.length === 0) return detail;

  return sections
    .map((sec) => {
      if (sec.kind === "meta") return sec.content;
      const pretty = formatHttpBodyJsonForDisplay(sec.content);
      return `${sec.kind}:\n${pretty}`;
    })
    .join(HTTP_TRACE_DETAIL_SPLIT);
}
