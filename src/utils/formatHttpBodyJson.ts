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
export function formatHttpBodyJsonForDisplay(raw: string): string {
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
