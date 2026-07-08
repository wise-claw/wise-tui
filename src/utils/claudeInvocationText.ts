import { extractResultErrorMessageFromStreamLine } from "../services/claudeStreamParser";
import { humanizeClaudeError } from "./humanizeClaudeError";

function safeJsonParse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function extractTextFromAssistantMessage(payload: Record<string, unknown>): string[] {
  const message = payload.message;
  if (!isRecord(message)) return [];
  const content = message.content;
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const item of content) {
    if (!isRecord(item)) continue;
    if (item.type !== "text") continue;
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (text) texts.push(text);
  }
  return texts;
}

/**
 * 从 Claude Code 事件流文本中提取“最终可用正文”，过滤 hook/init/thinking 等 JSON 噪音。
 */
export function extractClaudeInvocationFinalText(lines: string[]): string {
  const fallbackPlain = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("{") && !line.startsWith("["))
    .join("\n")
    .trim();

  let resultText = "";
  const assistantTexts: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const parsed = safeJsonParse(line);
    if (!isRecord(parsed)) continue;

    const type = typeof parsed.type === "string" ? parsed.type : "";
    if (type === "result") {
      const result = typeof parsed.result === "string" ? parsed.result.trim() : "";
      if (result) resultText = result;
    } else if (type === "assistant") {
      assistantTexts.push(...extractTextFromAssistantMessage(parsed));
    }
  }

  if (resultText) return resultText;
  if (assistantTexts.length > 0) return assistantTexts.join("\n").trim();
  return fallbackPlain;
}

/** Claude Code 流式 stdout 末尾常见的结果包络（对人无信息量的 JSON 一行） */
export function looksLikeClaudeStreamResultJsonLine(line: string): boolean {
  const t = line.trimStart();
  if (!t.startsWith("{")) return false;
  if (t.startsWith('{"type":"result"')) return true;
  if (t.startsWith('{"type": "result"')) return true;
  const parsed = safeJsonParse(t);
  if (!isRecord(parsed)) return false;
  return typeof parsed.type === "string" && parsed.type === "result";
}

/**
 * 直连批量 OMC 子进程列表预览：优先从整段 stdout 提取可读正文，避免用最后一行 JSON 包络。
 */
function truncatePreviewChars(text: string, maxChars: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t.length > maxChars ? `${t.slice(0, maxChars)}…` : t;
}

/** 与 `extractSystemErrorMessageFromStreamLine` 对齐；避免 utils 依赖 services。 */
function isIgnorableClaudeStreamSystemErrorDetail(detail: string): boolean {
  const normalized = detail.trim().toLowerCase();
  return normalized === "unknown" || normalized === "undefined";
}

function extractStreamSystemErrorPreview(line: string): string | null {
  try {
    const json = JSON.parse(line) as Record<string, unknown>;
    const type = typeof json.type === "string" ? json.type : "";
    const subtype = typeof json.subtype === "string" ? json.subtype : "";
    if (type !== "system") return null;

    if (subtype === "hook_response") {
      const outcome = typeof json.outcome === "string" ? json.outcome : "";
      if (outcome !== "error") return null;
      const output = typeof json.output === "string" ? json.output.trim() : "";
      const stderr = typeof json.stderr === "string" ? json.stderr.trim() : "";
      const message = output || stderr || "Claude Hook 执行失败";
      return `Claude Hook 错误: ${message}`;
    }

    const msg =
      typeof json.message === "string"
        ? json.message.trim()
        : typeof json.error === "string"
          ? json.error.trim()
          : "";
    if (msg && !isIgnorableClaudeStreamSystemErrorDetail(msg)) {
      return `Claude 系统错误: ${humanizeClaudeError(msg)}`;
    }
    return null;
  } catch {
    return null;
  }
}

function extractResultLineErrorMessage(line: string): string | null {
  const primary = extractResultErrorMessageFromStreamLine(line);
  if (primary) return humanizeClaudeError(primary);
  try {
    const p = JSON.parse(line) as Record<string, unknown>;
    if (p.type !== "result") return null;
    const sub = typeof p.subtype === "string" ? p.subtype : "";
    if (sub.includes("error")) {
      const r = typeof p.result === "string" ? p.result.trim() : "";
      if (r) return humanizeClaudeError(r);
    }
  } catch {
    return null;
  }
  return null;
}

export function computeOmcDirectBatchPreviewLine(
  stdoutLines: string[],
  stderrLines: string[],
  maxChars: number,
): string | undefined {
  const fromExtract = extractClaudeInvocationFinalText(stdoutLines).trim();
  if (fromExtract.length > 0) {
    return fromExtract.length > maxChars ? `${fromExtract.slice(0, maxChars)}…` : fromExtract;
  }
  for (let i = stdoutLines.length - 1; i >= 0; i -= 1) {
    const line = (stdoutLines[i] ?? "").trim();
    if (!line) continue;
    if (looksLikeClaudeStreamResultJsonLine(line)) continue;
    return line.length > maxChars ? `${line.slice(0, maxChars)}…` : line;
  }
  const errTail = stderrLines.length > 0 ? stderrLines[stderrLines.length - 1]!.trim() : "";
  if (errTail.length > 0) {
    return errTail.length > maxChars ? `${errTail.slice(0, maxChars)}…` : errTail;
  }
  return undefined;
}

const FAILURE_STDOUT_SCAN_MAX_LINES = 480;

/**
 * 直连批量失败时列表摘要：优先 stderr / 系统与 result 错误 / OMC_RESULT，避免误用助手自然语言当「失败原因」。
 */
export function computeOmcDirectBatchFailurePreviewLine(
  stdoutLines: string[],
  stderrLines: string[],
  maxChars: number,
): string | undefined {
  const stderrNonEmpty = stderrLines.map((l) => l.trim()).filter(Boolean);
  if (stderrNonEmpty.length > 0) {
    const joined = stderrNonEmpty.slice(-16).join(" · ");
    const t = truncatePreviewChars(joined, maxChars);
    return t || undefined;
  }

  const scanFrom = Math.max(0, stdoutLines.length - FAILURE_STDOUT_SCAN_MAX_LINES);
  for (let i = stdoutLines.length - 1; i >= scanFrom; i -= 1) {
    const raw = stdoutLines[i] ?? "";
    const line = raw.trim();
    if (!line) continue;

    const sysErr = extractStreamSystemErrorPreview(raw);
    if (sysErr) return truncatePreviewChars(sysErr, maxChars) || undefined;

    if (/OMC_RESULT:\s*(failed|blocked)/i.test(line)) {
      return truncatePreviewChars(line, maxChars) || undefined;
    }

    const resultErr = line.startsWith("{") ? extractResultLineErrorMessage(line) : null;
    if (resultErr) return truncatePreviewChars(resultErr, maxChars) || undefined;

    if (line.includes("Invocation timeout after")) {
      return truncatePreviewChars(line, maxChars) || undefined;
    }
  }

  for (let i = stdoutLines.length - 1; i >= scanFrom; i -= 1) {
    const line = (stdoutLines[i] ?? "").trim();
    if (!line || line.startsWith("{")) continue;
    if (looksLikeClaudeStreamResultJsonLine(line)) continue;
    if (/^(error|fatal|panic)\b/i.test(line) || /\b(Error|ERROR):\s*\S/.test(line)) {
      return truncatePreviewChars(line, maxChars) || undefined;
    }
  }

  const fallback = truncatePreviewChars("执行失败（未解析到具体错误摘要，请打开详情查看输出）", maxChars);
  return fallback || undefined;
}

/** 侧栏 OMC 历史列表等：隐藏结果包络 JSON（兼容旧持久化里的 previewLine） */
export function sanitizeOmcDirectBatchPreviewLineForList(raw: string | undefined | null): string | undefined {
  if (raw == null) return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  if (looksLikeClaudeStreamResultJsonLine(s)) return undefined;
  return s;
}
