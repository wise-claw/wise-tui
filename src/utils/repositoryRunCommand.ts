export const REPOSITORY_RUNNER_TERMINAL_ID = "topbar-runner";

/** 仅从终端输出识别本机 dev 地址：localhost / 127.0.0.1 / 0.0.0.0 / IPv4 / 方括号 IPv6，不匹配任意域名。 */
const RUN_LOG_URL_REGEX =
  /(https?:\/\/(?:(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?|\[[0-9a-fA-F:]+\](?::\d+)?|(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?)(?:\/[^\s]*)?)/i;
const RUN_LOG_HOST_PORT_REGEX =
  /\b(localhost|127\.0\.0\.1|0\.0\.0\.0|(?:\d{1,3}\.){3}\d{1,3}):(\d{2,5})(\/[^\s]*)?\b/i;
const RUN_LOG_IPV6_BRACKET_PORT_REGEX = /\[([0-9a-fA-F:]+)\]:(\d{2,5})(\/[^\s]*)?\b/i;

/**
 * AI 报错监控识别的问题类型：
 * - `error`：编译/运行时错误、异常、panic、失败
 * - `warning`：告警、警告、deprecation（仍可能影响运行）
 * - `http`：接口 / HTTP 4xx·5xx 请求失败
 */
export type RunLogIssueKind = "error" | "warning" | "http";

export type RunLogIssue = {
  kind: RunLogIssueKind;
  /** 命中的原始行（trim 后） */
  line: string;
};

/** @deprecated 请改用 `lineHasRunLogIssue` / `detectRunLogIssue`；保留供旧调用兼容。 */
export const RUN_ERROR_REGEX =
  /(error|failed|exception|traceback|npm err|build failed|编译失败|报错|panic)/i;

/** 运行错误 / 异常（不含单纯 warn，避免把全部告警都标成 error 级）。 */
const RUN_LOG_ERROR_REGEX =
  /(?:^|[\s\[\]\(\){}:：;；,.，。|/\\'"-])(?:error|err!|fatal|critical|exception|traceback|panic|failed|failure|npm\s*err|build\s*failed|compile\s*error|compilation\s*error|typeerror|referenceerror|syntaxerror|rangeerror|urierror|aggregateerror)(?:$|[\s\[\]\(\){}:：;；,.，。|/\\'"-])/i;
const RUN_LOG_ERROR_CJK_REGEX = /(?:编译失败|构建失败|报错|(?:^|[^\u4e00-\u9fff])失败(?:$|[^\u4e00-\u9fff]))/;

/** Next.js / Vite 等终端符号 + 中英文告警词。 */
const RUN_LOG_WARNING_REGEX =
  /(?:^|[\s\[\]\(\){}:：;；,.，。|/\\'"-])(?:warn(?:ing)?|deprecated|deprecation)(?:$|[\s\[\]\(\){}:：;；,.，。|/\\'"-])/i;
const RUN_LOG_WARNING_MARK_REGEX = /(?:^|\s)(?:⚠|⚠️)/;
const RUN_LOG_WARNING_CJK_REGEX = /告警|警告/;

/** Next.js 运行时错误前缀 `⨯`（U+2A2F）。 */
const RUN_LOG_NEXT_ERROR_MARK_REGEX = /(?:^|\s)[⨯×]\s*(?:error|failed|warn|warning)?/i;

/**
 * HTTP / API 请求失败：
 * - `GET /api/foo 500`
 * - `POST /x 404 in 12ms`
 * - `HTTP 502` / `status: 500` / `502 Bad Gateway`
 * - fetch / ECONNREFUSED 等网络层失败
 */
const RUN_LOG_HTTP_METHOD_STATUS_REGEX =
  /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+\s+([45]\d{2})\b/;
/** 成功访问日志（2xx/3xx）：整行跳过，避免路径段含 error 等字样误报。 */
const RUN_LOG_HTTP_SUCCESS_REGEX =
  /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+\s+([123]\d{2})\b/;
const RUN_LOG_HTTP_STATUS_TEXT_REGEX =
  /\b(?:HTTP[/ ]?)?([45]\d{2})\s+(?:Bad Request|Unauthorized|Forbidden|Not Found|Method Not Allowed|Conflict|Gone|Unprocessable|Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)\b/i;
const RUN_LOG_HTTP_STATUS_FIELD_REGEX =
  /\b(?:status(?:Code)?|code)\s*[:=]\s*([45]\d{2})\b/i;
const RUN_LOG_NETWORK_ERROR_REGEX =
  /\b(?:ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EPIPE|EHOSTUNREACH|ERR_CONNECTION|ERR_NETWORK|fetch failed|network error|socket hang up|connect\s+econnrefused|api\s*(?:error|failed))\b/i;
const RUN_LOG_NETWORK_CJK_REGEX = /请求失败|接口(?:请求)?(?:失败|错误|超时)/;

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

function normalizeLogLines(text: string): string[] {
  return stripAnsi(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * 判定单行日志是否属于需监控的问题，并返回类型。
 * 优先级：http > error > warning（同一行可同时像 error+http 时归 http，便于接口类修复）。
 */
export function detectRunLogIssue(line: string): RunLogIssue | null {
  const text = stripAnsi(line).trim();
  if (!text) return null;

  // 先识别成功请求日志并跳过，避免 `/auth/error` 这类路径触发 error 词误报。
  if (RUN_LOG_HTTP_SUCCESS_REGEX.test(text)) {
    return null;
  }

  if (
    RUN_LOG_HTTP_METHOD_STATUS_REGEX.test(text) ||
    RUN_LOG_HTTP_STATUS_TEXT_REGEX.test(text) ||
    RUN_LOG_HTTP_STATUS_FIELD_REGEX.test(text) ||
    RUN_LOG_NETWORK_ERROR_REGEX.test(text) ||
    RUN_LOG_NETWORK_CJK_REGEX.test(text)
  ) {
    return { kind: "http", line: text };
  }

  if (
    RUN_LOG_NEXT_ERROR_MARK_REGEX.test(text) ||
    RUN_LOG_ERROR_REGEX.test(text) ||
    RUN_LOG_ERROR_CJK_REGEX.test(text)
  ) {
    return { kind: "error", line: text };
  }

  if (
    RUN_LOG_WARNING_MARK_REGEX.test(text) ||
    RUN_LOG_WARNING_REGEX.test(text) ||
    RUN_LOG_WARNING_CJK_REGEX.test(text)
  ) {
    return { kind: "warning", line: text };
  }

  return null;
}

export function lineHasRunLogIssue(line: string): boolean {
  return detectRunLogIssue(line) != null;
}

/** 从一段（可能多行）输出中收集问题；同文去重，保序。 */
export function collectRunLogIssues(text: string): RunLogIssue[] {
  const seen = new Set<string>();
  const issues: RunLogIssue[] = [];
  for (const line of normalizeLogLines(text)) {
    const issue = detectRunLogIssue(line);
    if (!issue) continue;
    const key = `${issue.kind}|${issue.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
  }
  return issues;
}

export function summarizeRunLogIssueKinds(issues: readonly RunLogIssue[]): string {
  const kinds = new Set(issues.map((issue) => issue.kind));
  const labels: string[] = [];
  if (kinds.has("error")) labels.push("错误");
  if (kinds.has("warning")) labels.push("告警");
  if (kinds.has("http")) labels.push("接口请求错误");
  return labels.length > 0 ? labels.join("、") : "未知问题";
}

/**
 * 从运行报错日志尾提取稳定指纹，用于识别"同一报错在循环出现"。
 *
 * 取命中问题关键词的行，剥离 ANSI 控制序列、时间戳、内存地址，并将所有数字
 * 归一为 N（行号 / 端口 / 循环序号 / 错误码每次都可能不同），压缩空白后取末尾若干行。
 * 这样循环报错（仅时间戳 / 行号 / 序号每次不同）会被归一到同一指纹。
 */
export function buildRunErrorFingerprint(tailText: string): string {
  const errorLines = normalizeLogLines(tailText)
    .filter((line) => lineHasRunLogIssue(line))
    .map((line) =>
      line
        .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?Z?\b/g, "")
        .replace(/\b\d{2}:\d{2}:\d{2}\b/g, "")
        .replace(/\b0x[0-9a-fA-F]+\b/g, "")
        .replace(/\d+/g, "N")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean)
    .slice(-5);
  return errorLines.join(" | ");
}

/** 两枚指纹是否代表同一报错。空指纹不判定为同一（避免误判为循环）。 */
export function isSameRunErrorFingerprint(a: string | null, b: string): boolean {
  if (!a || !b) return false;
  return a === b;
}

export type RunErrorMonitorDecision =
  | { action: "arm-dispatch" }
  | { action: "report-loop"; loopCount: number }
  | { action: "report-new-after-dispatch" };

/**
 * 判定某段报错输出在 AI 报错监控状态机中应触发何种动作（同一错误只派发一次）。
 *
 * - 未派发过：排程首次派发。
 * - 已派发且指纹匹配：同一报错循环，仅递增计数并提示，不再派发。
 * - 已派发但指纹不同：本次运行 AI 已介入，仅提示，不再派发。
 */
export function decideRunErrorMonitorStep(input: {
  autoFixSent: boolean;
  dispatchedFingerprint: string | null;
  fingerprint: string;
  loopCount: number;
}): RunErrorMonitorDecision {
  if (!input.autoFixSent) {
    return { action: "arm-dispatch" };
  }
  if (isSameRunErrorFingerprint(input.dispatchedFingerprint, input.fingerprint)) {
    return { action: "report-loop", loopCount: input.loopCount + 1 };
  }
  return { action: "report-new-after-dispatch" };
}

/**
 * 构造交给 Claude 的自动修复提示：标明问题类型（错误 / 告警 / 接口请求错误）。
 */
export function buildRunErrorAutoFixPrompt(input: {
  command: string;
  tailText: string;
}): string {
  const issues = collectRunLogIssues(input.tailText);
  const kindSummary = summarizeRunLogIssueKinds(issues);
  const sampleLines = issues
    .slice(-8)
    .map((issue) => {
      const tag =
        issue.kind === "http" ? "接口" : issue.kind === "warning" ? "告警" : "错误";
      return `- [${tag}] ${issue.line}`;
    })
    .join("\n");

  return [
    "请根据以下运行日志中的问题定位根因并直接给出修复方案，然后在仓库内执行修复。",
    `问题类型：${kindSummary}`,
    `运行命令：${input.command.trim() || "(未记录)"}`,
    sampleLines ? `命中摘要：\n${sampleLines}` : null,
    "最近日志：",
    input.tailText.trim() || "(无)",
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

const RUN_ERROR_MONITOR_DEDUP_WINDOW_MS = 60_000;
const runErrorMonitorSentAtByKey = new Map<string, number>();

export function buildRunErrorMonitorDedupKey(runCwd: string, command: string, tailText: string): string {
  const normalizedTail = stripAnsi(tailText)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(-800);
  return `${runCwd.trim().toLowerCase()}|${command.trim().toLowerCase()}|${normalizedTail}`;
}

export function shouldSkipRunErrorMonitorSend(dedupKey: string, now: number): boolean {
  const lastAt = runErrorMonitorSentAtByKey.get(dedupKey);
  if (lastAt && now - lastAt < RUN_ERROR_MONITOR_DEDUP_WINDOW_MS) {
    return true;
  }
  runErrorMonitorSentAtByKey.set(dedupKey, now);
  if (runErrorMonitorSentAtByKey.size > 200) {
    const expireBefore = now - RUN_ERROR_MONITOR_DEDUP_WINDOW_MS;
    for (const [key, sentAt] of runErrorMonitorSentAtByKey.entries()) {
      if (sentAt < expireBefore) {
        runErrorMonitorSentAtByKey.delete(key);
      }
    }
  }
  return false;
}

export function detectRunUrlFromLogText(text: string): string | null {
  const plain = stripAnsi(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const direct = plain.match(RUN_LOG_URL_REGEX)?.[1];
  if (direct) {
    return direct.replace("0.0.0.0", "localhost").replace("127.0.0.1", "localhost");
  }
  const hostPort = plain.match(RUN_LOG_HOST_PORT_REGEX);
  if (hostPort?.[1] && hostPort?.[2]) {
    const host = hostPort[1].replace("0.0.0.0", "localhost").replace("127.0.0.1", "localhost");
    const suffix = hostPort[3] ?? "";
    return `http://${host}:${hostPort[2]}${suffix}`;
  }
  const v6 = plain.match(RUN_LOG_IPV6_BRACKET_PORT_REGEX);
  if (v6?.[1] && v6?.[2]) {
    const suffix = v6[3] ?? "";
    return `http://[${v6[1]}]:${v6[2]}${suffix}`;
  }
  return null;
}

export function normalizeRunOpenUrl(raw: string): string | null {
  const input = raw.trim();
  if (!input) return null;
  if (
    input.startsWith("/") ||
    input.startsWith("./") ||
    input.startsWith("../") ||
    input.startsWith("~")
  ) {
    return null;
  }
  const withProtocol = /^https?:\/\//i.test(input) ? input : `http://${input}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.replace("0.0.0.0", "localhost").replace("127.0.0.1", "localhost");
    const pathname = url.pathname === "/" ? "" : url.pathname;
    return `${url.protocol}//${host}${url.port ? `:${url.port}` : ""}${pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function readRunAutoOpenPageEnabled(storageKey: string | null): boolean {
  if (!storageKey) return true;
  const raw = window.localStorage.getItem(storageKey);
  if (raw === null) return true;
  return raw === "1" || raw === "true";
}

export function repositoryRunCommandStorageKeys(runCwd: string) {
  const trimmed = runCwd.trim();
  if (!trimmed) {
    return { runKey: null, runUrlKey: null, runAutoOpenKey: null, terminalRunKey: null };
  }
  return {
    runKey: `wise.topbar.run-command:${trimmed}`,
    runUrlKey: `wise.topbar.run-open-url:${trimmed}`,
    runAutoOpenKey: `wise.topbar.run-auto-open:${trimmed}`,
    // 外部终端按钮的运行指令独立存储，与「运行」按钮分开配置，互不影响。
    terminalRunKey: `wise.topbar.terminal-run-command:${trimmed}`,
  };
}
