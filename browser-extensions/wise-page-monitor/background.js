import { PAGE_INJECTION_SOURCE } from "./inject-vitals.js";

const DEFAULT_PORTS = [17321, 17322, 17323, 17324, 17325];
const POLL_ALARM = "wise-page-monitor-poll";
const WISE_BINDING_NAME = "__wiseMonitorReport";
const SLOW_REQUEST_REPORT_MS = 3000;
const LONG_TASK_REPORT_MS = 500;

/** @type {Map<number, { sessionId: string, url: string }>} */
const attachedTabs = new Map();
/** @type {{ sessionId: string, url: string, port: number } | null} */
let activeMonitor = null;
let bridgePort = 17321;
let lastReloadToken = 0;

function normalizeUrl(raw) {
  try {
    const u = new URL(String(raw || "").trim());
    u.hash = "";
    let href = u.href;
    if (href.endsWith("/")) href = href.slice(0, -1);
    return href;
  } catch {
    return String(raw || "")
      .trim()
      .replace(/#.*$/, "")
      .replace(/\/$/, "");
  }
}

function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function urlMatches(tabUrl, monitorUrl) {
  const tab = normalizeUrl(tabUrl);
  const want = normalizeUrl(monitorUrl);
  if (!tab || !want) return false;
  if (tab === want) return true;
  if (tab.startsWith(want) || want.startsWith(tab)) return true;
  return sameOrigin(tab, want);
}

async function discoverBridgePort() {
  for (const port of DEFAULT_PORTS) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { method: "GET" });
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.service === "wise-page-monitor" || data?.ok) {
        bridgePort = port;
        return port;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

async function fetchActiveMonitor() {
  const port = (await discoverBridgePort()) ?? bridgePort;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/active-monitor`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.active || !data.sessionId || !data.url) return null;
    bridgePort = data.port || port;
    return {
      sessionId: String(data.sessionId),
      url: String(data.url),
      port: bridgePort,
      reloadToken: Number(data.reloadToken || 0),
    };
  } catch {
    return null;
  }
}

async function reloadAttachedTabs() {
  const ids = [...attachedTabs.keys()];
  for (const tabId of ids) {
    try {
      await chrome.tabs.reload(tabId, { bypassCache: true });
    } catch (err) {
      console.warn("[wise-page-monitor] reload failed", tabId, err);
    }
  }
}

async function postIssue(issue) {
  try {
    await fetch(`http://127.0.0.1:${bridgePort}/v1/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(issue),
    });
  } catch {
    /* Wise may be closed */
  }
}

async function attachTab(tabId, sessionId, monitorUrl) {
  if (attachedTabs.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (err) {
    console.warn("[wise-page-monitor] attach failed", tabId, err);
    return;
  }
  attachedTabs.set(tabId, { sessionId, url: monitorUrl });
  const send = (method, params = {}) =>
    chrome.debugger.sendCommand({ tabId }, method, params).catch(() => undefined);
  await send("Network.enable");
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Log.enable");
  await send("Runtime.addBinding", { name: WISE_BINDING_NAME });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: PAGE_INJECTION_SOURCE });
  await send("Runtime.evaluate", { expression: PAGE_INJECTION_SOURCE });
}

async function detachTab(tabId) {
  if (!attachedTabs.has(tabId)) return;
  attachedTabs.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    /* already detached */
  }
}

async function detachAll() {
  const ids = [...attachedTabs.keys()];
  for (const id of ids) {
    await detachTab(id);
  }
}

async function syncAttachments(monitor) {
  if (!monitor) {
    await detachAll();
    return;
  }
  const tabs = await chrome.tabs.query({});
  const matching = tabs.filter((t) => t.id != null && t.url && urlMatches(t.url, monitor.url));
  const matchingIds = new Set(matching.map((t) => t.id));

  for (const tabId of [...attachedTabs.keys()]) {
    if (!matchingIds.has(tabId)) {
      await detachTab(tabId);
    }
  }
  for (const tab of matching) {
    await attachTab(tab.id, monitor.sessionId, monitor.url);
  }

  // No matching tab yet: open one for the monitor URL.
  if (matching.length === 0) {
    try {
      const created = await chrome.tabs.create({ url: monitor.url, active: false });
      if (created.id != null) {
        await attachTab(created.id, monitor.sessionId, monitor.url);
      }
    } catch (err) {
      console.warn("[wise-page-monitor] create tab failed", err);
    }
  }
}

async function pollOnce() {
  const next = await fetchActiveMonitor();
  const same =
    activeMonitor &&
    next &&
    activeMonitor.sessionId === next.sessionId &&
    activeMonitor.url === next.url;
  activeMonitor = next;
  if (!same) {
    await detachAll();
    lastReloadToken = 0;
  }
  await syncAttachments(activeMonitor);
  if (next?.reloadToken && next.reloadToken > lastReloadToken) {
    lastReloadToken = next.reloadToken;
    await reloadAttachedTabs();
  }
  await chrome.storage.local.set({
    wisePageMonitorStatus: activeMonitor
      ? {
          connected: true,
          sessionId: activeMonitor.sessionId,
          url: activeMonitor.url,
          port: activeMonitor.port,
          attachedTabs: attachedTabs.size,
        }
      : { connected: false, attachedTabs: 0, port: bridgePort },
  });
}

chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.05 }); // ~3s
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) void pollOnce();
});

chrome.runtime.onInstalled.addListener(() => {
  void pollOnce();
});
chrome.runtime.onStartup.addListener(() => {
  void pollOnce();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!activeMonitor) return;
  if (changeInfo.status === "complete" || changeInfo.url) {
    if (tab.url && urlMatches(tab.url, activeMonitor.url)) {
      void attachTab(tabId, activeMonitor.sessionId, activeMonitor.url);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId != null) attachedTabs.delete(source.tabId);
});

/** @type {Map<string, { method: string, url: string, timestamp: number }>} */
const requestMetaById = new Map();

chrome.debugger.onEvent.addListener((source, method, params) => {
  const meta = source.tabId != null ? attachedTabs.get(source.tabId) : null;
  if (!meta) return;
  const sessionId = meta.sessionId;

  if (method === "Runtime.exceptionThrown") {
    const details = params?.exceptionDetails || {};
    const text = details.text || "exception";
    const desc =
      details.exception?.description ||
      details.exception?.value ||
      "";
    const url = details.url || "";
    const line = details.lineNumber ?? 0;
    let message = desc ? `${text}: ${desc}` : String(text);
    if (url) message += ` at ${url}:${line}`;
    message = String(message).replace(/\n/g, " ").trim();
    if (!message) return;
    void postIssue({
      sessionId,
      kind: "page-error",
      message,
      url: url || null,
    });
    return;
  }

  if (method === "Runtime.consoleAPICalled") {
    const level = params?.type || "";
    if (level !== "error" && level !== "warning" && level !== "assert") return;
    const args = Array.isArray(params?.args) ? params.args : [];
    const parts = args.map((arg) => {
      if (arg?.description) return String(arg.description);
      if (arg?.value != null) return String(arg.value);
      return "";
    });
    const message = parts.join(" ").replace(/\n/g, " ").trim();
    if (!message) return;
    void postIssue({
      sessionId,
      kind: level === "warning" ? "console-warning" : "console-error",
      message,
    });
    return;
  }

  if (method === "Network.requestWillBeSent") {
    const requestId = params?.requestId;
    if (!requestId) return;
    requestMetaById.set(String(requestId), {
      method: String(params?.request?.method || "GET"),
      url: String(params?.request?.url || ""),
      timestamp: Number(params?.timestamp || 0),
    });
    return;
  }

  if (method === "Runtime.bindingCalled") {
    if (params?.name !== WISE_BINDING_NAME) return;
    let payload = null;
    try {
      payload = JSON.parse(String(params?.payload || ""));
    } catch {
      return;
    }
    if (!payload || typeof payload !== "object") return;
    if (payload.kind === "vitals") {
      const metric = String(payload.metric || "");
      const value = Number(payload.value);
      if (!metric || !Number.isFinite(value)) return;
      if (!["lcp", "cls", "inp", "fcp", "ttfb"].includes(metric)) return;
      void postIssue({
        sessionId,
        kind: "page-vitals",
        message: metric === "cls" ? `CLS ${value}` : `${metric.toUpperCase()} ${Math.round(value)}ms`,
        url: payload.url ? String(payload.url) : null,
        metric,
        value,
      });
    } else if (payload.kind === "long-task") {
      const value = Number(payload.value);
      if (!Number.isFinite(value)) return;
      if (Math.round(value) < LONG_TASK_REPORT_MS) return;
      void postIssue({
        sessionId,
        kind: "long-task",
        message: `${Math.round(value)}ms main-thread block`,
        url: payload.url ? String(payload.url) : null,
        value,
        durationMs: Math.round(value),
      });
    }
    return;
  }

  if (method === "Page.crashEvent") {
    void postIssue({
      sessionId,
      kind: "page-crash",
      message: "main frame crashed",
    });
    return;
  }

  if (method === "Network.responseReceived") {
    const status = Number(params?.response?.status || 0);
    const requestId = String(params?.requestId || "");
    const cached = requestMetaById.get(requestId);
    const url = cached?.url || params?.response?.url || "";
    const reqMethod = cached?.method || "GET";
    const resourceType = String(params?.type || "");
    if (status < 400) {
      const responseTs = Number(params?.timestamp || 0);
      if (responseTs > 0 && (cached?.timestamp || 0) > 0 && url) {
        const duration = Math.round((responseTs - cached.timestamp) * 1000);
        if (duration >= SLOW_REQUEST_REPORT_MS) {
          void postIssue({
            sessionId,
            kind: "slow-request",
            message: `${reqMethod} ${url} ${status} in ${duration}ms`,
            url: url || null,
            method: reqMethod,
            status,
            durationMs: duration,
            resourceType: resourceType || null,
          });
        }
      }
      return;
    }
    void postIssue({
      sessionId,
      kind: "network-http",
      message: `${reqMethod} ${url} ${status}`,
      url: url || null,
      method: reqMethod,
      status,
      resourceType: resourceType || null,
    });
    return;
  }

  if (method === "Network.loadingFailed") {
    const errorText = String(params?.errorText || "failed");
    const lower = errorText.toLowerCase();
    if (lower.includes("abort") || lower.includes("cancel")) return;
    const requestId = String(params?.requestId || "");
    const cached = requestMetaById.get(requestId);
    requestMetaById.delete(requestId);
    const url = cached?.url || "";
    const resourceType = String(params?.type || "");
    void postIssue({
      sessionId,
      kind: "network-failed",
      message: errorText,
      url: url || null,
      method: cached?.method || "GET",
      resourceType: resourceType || null,
    });
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "wise-page-monitor-status") {
    void pollOnce().then(() => {
      sendResponse({
        activeMonitor,
        bridgePort,
        attachedTabs: attachedTabs.size,
      });
    });
    return true;
  }
  return false;
});

void pollOnce();
