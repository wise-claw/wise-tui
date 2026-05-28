export const REPOSITORY_RUNNER_TERMINAL_ID = "topbar-runner";

/** 仅从终端输出识别本机 dev 地址：localhost / 127.0.0.1 / 0.0.0.0 / IPv4 / 方括号 IPv6，不匹配任意域名。 */
const RUN_LOG_URL_REGEX =
  /(https?:\/\/(?:(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?|\[[0-9a-fA-F:]+\](?::\d+)?|(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?)(?:\/[^\s]*)?)/i;
const RUN_LOG_HOST_PORT_REGEX =
  /\b(localhost|127\.0\.0\.1|0\.0\.0\.0|(?:\d{1,3}\.){3}\d{1,3}):(\d{2,5})(\/[^\s]*)?\b/i;
const RUN_LOG_IPV6_BRACKET_PORT_REGEX = /\[([0-9a-fA-F:]+)\]:(\d{2,5})(\/[^\s]*)?\b/i;

export const RUN_ERROR_REGEX =
  /(error|failed|exception|traceback|npm err|build failed|编译失败|报错|panic)/i;

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
    return { runKey: null, runUrlKey: null, runAutoOpenKey: null };
  }
  return {
    runKey: `wise.topbar.run-command:${trimmed}`,
    runUrlKey: `wise.topbar.run-open-url:${trimmed}`,
    runAutoOpenKey: `wise.topbar.run-auto-open:${trimmed}`,
  };
}
