export const REPOSITORY_RUNNER_TERMINAL_ID = "topbar-runner";

/** 仅从终端输出识别本机 dev 地址：localhost / 127.0.0.1 / 0.0.0.0 / IPv4 / 方括号 IPv6，不匹配任意域名。 */
const RUN_LOG_URL_REGEX =
  /(https?:\/\/(?:(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?|\[[0-9a-fA-F:]+\](?::\d+)?|(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?)(?:\/[^\s]*)?)/i;
const RUN_LOG_HOST_PORT_REGEX =
  /\b(localhost|127\.0\.0\.1|0\.0\.0\.0|(?:\d{1,3}\.){3}\d{1,3}):(\d{2,5})(\/[^\s]*)?\b/i;
const RUN_LOG_IPV6_BRACKET_PORT_REGEX = /\[([0-9a-fA-F:]+)\]:(\d{2,5})(\/[^\s]*)?\b/i;

export const RUN_ERROR_REGEX =
  /(error|failed|exception|traceback|npm err|build failed|编译失败|报错|panic)/i;

/**
 * 从运行报错日志尾提取稳定指纹，用于识别"同一报错在循环出现"。
 *
 * 取命中错误关键词的行，剥离 ANSI 控制序列、时间戳、内存地址，并将所有数字
 * 归一为 N（行号 / 端口 / 循环序号 / 错误码每次都可能不同），压缩空白后取末尾若干行。
 * 这样循环报错（仅时间戳 / 行号 / 序号每次不同）会被归一到同一指纹。
 */
export function buildRunErrorFingerprint(tailText: string): string {
  const plain = tailText
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const errorLines = plain
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => RUN_ERROR_REGEX.test(line))
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

const RUN_ERROR_MONITOR_DEDUP_WINDOW_MS = 60_000;
const runErrorMonitorSentAtByKey = new Map<string, number>();

export function buildRunErrorMonitorDedupKey(runCwd: string, command: string, tailText: string): string {
  const normalizedTail = tailText
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
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
  const plain = text
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
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
