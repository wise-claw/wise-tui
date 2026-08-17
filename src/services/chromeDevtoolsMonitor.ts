import { invoke } from "@tauri-apps/api/core";
import {
  collectRunLogIssues,
  summarizeRunLogIssueKinds,
  isRunLogIgnorableNoise,
} from "../utils/repositoryRunCommand";

export type ChromeDevtoolsIssueKind =
  | "page-error"
  | "console-error"
  | "console-warning"
  | "network-http"
  | "network-failed"
  | "page-crash"
  | "page-vitals"
  | "long-task"
  | "slow-request";

export type ChromeDevtoolsIssue = {
  sessionId: string;
  kind: ChromeDevtoolsIssueKind | string;
  message: string;
  url?: string | null;
  method?: string | null;
  status?: number | null;
  /** Web Vitals 指标名：lcp | cls | inp | fcp | ttfb */
  metric?: string | null;
  /** Web Vitals / 长任务数值（CLS 为比值，其余为毫秒） */
  value?: number | null;
  /** 慢请求 / 长任务耗时（毫秒） */
  durationMs?: number | null;
  /** CDP 资源类型：XHR / Fetch / Image / Script / Stylesheet / Font 等 */
  resourceType?: string | null;
};

/** 诊断类问题：仅展示，不触发 AI 自动修复（性能 / 耗时类指标）。 */
const PAGE_MONITOR_DIAGNOSTIC_KINDS = new Set(["page-vitals", "long-task", "slow-request"]);

export function isPageMonitorDiagnosticKind(kind: string | null | undefined): boolean {
  return PAGE_MONITOR_DIAGNOSTIC_KINDS.has(String(kind ?? "").trim().toLowerCase());
}

/** XHR/fetch 之外的资源类型前缀（静态资源失败更醒目）。 */
const API_RESOURCE_TYPES = new Set(["xhr", "fetch", "document", "websocket", "eventsource"]);

function resourceTypeTag(resourceType?: string | null): string {
  const type = String(resourceType ?? "").trim();
  if (!type) return "";
  return API_RESOURCE_TYPES.has(type.toLowerCase()) ? "" : `[${type}] `;
}

/** `launch` = 独立窗口；`attach` = 附着调试口；`extension` = Chrome 扩展。 */
export type PageMonitorChromeMode = "launch" | "attach" | "extension";

export const DEFAULT_PAGE_MONITOR_DEBUG_PORT = 9222;
export const DEFAULT_PAGE_MONITOR_BRIDGE_PORT = 17321;

/**
 * 页面监控是否应忽略该问题行（热更新、HMR、良性噪音）。
 * 复用运行日志噪声过滤器，保证两端一致。
 */
export function isPageMonitorIgnorableNoise(text: string): boolean {
  return isRunLogIgnorableNoise(text);
}

/**
 * 将 CDP 问题格式化为可被问题检测正则识别的日志行。
 * - page/console error → 含 error 关键词
 * - console warning → 含 warning
 * - network-http → `METHOD url status`（4xx/5xx）
 * - network-failed → 含 failed / 网络错误码
 */
export function formatChromeDevtoolsIssueLine(issue: ChromeDevtoolsIssue): string {
  const kind = (issue.kind ?? "").trim().toLowerCase();
  const message = (issue.message ?? "").trim();
  const url = (issue.url ?? "").trim();
  const method = (issue.method ?? "GET").trim() || "GET";
  const status = issue.status;

  switch (kind) {
    case "network-http": {
      const tag = resourceTypeTag(issue.resourceType);
      if (url && status != null) return `${tag}${method} ${url} ${status}`;
      if (message) return message;
      return `${tag}GET ${url || "/"} ${status ?? 500}`;
    }
    case "network-failed": {
      const tag = resourceTypeTag(issue.resourceType);
      const detail = message || "failed";
      return url
        ? `${tag}Chrome network failed: ${detail} ${url}`
        : `${tag}Chrome network failed: ${detail}`;
    }
    case "console-warning":
      return `Chrome console warning: ${message || "warning"}`;
    case "console-error":
      return `Chrome console error: ${message || "error"}`;
    case "page-crash":
      return `Chrome page crash: ${message || "page crashed"}`;
    case "page-vitals": {
      const metric = (issue.metric ?? "").trim().toUpperCase();
      const value = issue.value;
      if (metric && value != null) {
        const formatted = metric === "CLS" ? String(value) : `${Math.round(value)}ms`;
        return `Chrome vitals ${metric}: ${formatted}`;
      }
      return `Chrome vitals: ${message || "performance metric"}`;
    }
    case "long-task": {
      const duration = Math.round(issue.value ?? issue.durationMs ?? 0);
      return `Chrome long task: ${duration}ms`;
    }
    case "slow-request": {
      if (issue.durationMs != null && url) {
        const statusPart = issue.status != null ? ` ${issue.status}` : "";
        return `${method} ${url}${statusPart} in ${issue.durationMs}ms`;
      }
      return `Chrome slow request: ${message || "slow request"}`;
    }
    case "page-error":
    default:
      return `Chrome page error: ${message || "error"}`;
  }
}

/** 构造页面监控命中后交给 Claude 的自动修复提示。 */
export function buildPageMonitorAutoFixPrompt(input: {
  url: string;
  issuesText: string;
}): string {
  const issues = collectRunLogIssues(input.issuesText);
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
    "请根据以下浏览器页面监控（Chrome DevTools / CDP）捕获的问题定位根因并直接给出修复方案，然后在仓库内执行修复。",
    `问题类型：${kindSummary}`,
    `监控地址：${input.url.trim() || "(未记录)"}`,
    sampleLines ? `命中摘要：\n${sampleLines}` : null,
    "最近问题：",
    input.issuesText.trim() || "(无)",
    "说明：你完成后系统会自动刷新监控页面以验证修复，无需在回复中要求用户手动刷新。",
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

export function normalizePageMonitorChromeMode(raw: unknown): PageMonitorChromeMode {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (value === "attach" || value === "existing" || value === "reuse") return "attach";
  if (value === "extension" || value === "ext" || value === "plugin") return "extension";
  return "launch";
}

export function normalizePageMonitorDebugPort(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n)) return DEFAULT_PAGE_MONITOR_DEBUG_PORT;
  const port = Math.floor(n);
  if (port < 1 || port > 65535) return DEFAULT_PAGE_MONITOR_DEBUG_PORT;
  return port;
}

export async function startChromeDevtoolsMonitor(input: {
  sessionId: string;
  url: string;
  mode?: PageMonitorChromeMode;
  debugPort?: number;
}): Promise<void> {
  const sessionId = input.sessionId.trim();
  const url = input.url.trim();
  if (!sessionId || !url) return;
  const mode = normalizePageMonitorChromeMode(input.mode);
  const payload: {
    sessionId: string;
    url: string;
    mode: PageMonitorChromeMode;
    debugPort?: number;
  } = { sessionId, url, mode };
  if (mode === "attach") {
    payload.debugPort = normalizePageMonitorDebugPort(input.debugPort);
  }
  await invoke("chrome_devtools_monitor_start", payload);
}

export async function getChromePageMonitorBridgeStatus(): Promise<{
  active: boolean;
  sessionId?: string | null;
  url?: string | null;
  port: number;
  service: string;
}> {
  return invoke("chrome_page_monitor_bridge_status");
}

export async function getChromePageMonitorExtensionDir(): Promise<string> {
  return invoke("chrome_page_monitor_extension_dir");
}

/** Copy the app-bundled extension into Downloads and reveal that folder. */
export async function downloadChromePageMonitorExtension(): Promise<string> {
  return invoke("chrome_page_monitor_download_extension");
}

/** @deprecated Prefer {@link downloadChromePageMonitorExtension}. */
export async function openChromePageMonitorExtensionDir(): Promise<void> {
  await downloadChromePageMonitorExtension();
}

export async function stopChromeDevtoolsMonitor(sessionId: string): Promise<void> {
  const id = sessionId.trim();
  if (!id) return;
  await invoke("chrome_devtools_monitor_stop", { sessionId: id });
}

/** Reload the monitored page after AI auto-fix completes. */
export async function reloadChromeDevtoolsMonitor(sessionId: string): Promise<void> {
  const id = sessionId.trim();
  if (!id) return;
  await invoke("chrome_devtools_monitor_reload", { sessionId: id });
}
