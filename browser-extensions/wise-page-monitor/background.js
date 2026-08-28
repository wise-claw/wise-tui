import { PAGE_INJECTION_SOURCE } from "./inject-vitals.js";
import {
  capturePageSelection,
  computeCropPixels,
  fitCropSize,
  prependRequirementNote,
  showWisePageToast,
  showWiseSelectionConfirm,
} from "./selection-capture.js";

const DEFAULT_PORTS = [17321, 17322, 17323, 17324, 17325];
const POLL_ALARM = "wise-page-monitor-poll";
const WISE_BINDING_NAME = "__wiseMonitorReport";
const SLOW_REQUEST_REPORT_MS = 3000;
const LONG_TASK_REPORT_MS = 500;
const TRAIL_MAX = 10;

/** @type {Map<number, { sessionId: string, url: string }>} */
const attachedTabs = new Map();
/** @type {Map<number, Array<{ metric: string, message: string }>>} */
const trailByTab = new Map();
/** @type {Map<number, Set<string>>} */
const alertedVitalsByTab = new Map();
/** @type {{ sessionId: string, url: string, port: number, vitals: { lcpMs: number, cls: number, inpMs: number } } | null} */
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
      vitals: {
        lcpMs: Number(data.vitals?.lcpMs) > 0 ? Number(data.vitals.lcpMs) : 4000,
        cls: Number(data.vitals?.cls) > 0 ? Number(data.vitals.cls) : 0.25,
        inpMs: Number(data.vitals?.inpMs) > 0 ? Number(data.vitals.inpMs) : 500,
      },
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

const MENU_SEND_REQUIREMENT = "wise-send-requirement";
const MENU_SEND_VIEWPORT = "wise-send-viewport";

function ensureContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_SEND_REQUIREMENT,
      title: "发送到 Wise 作为需求",
      contexts: ["selection", "image", "link"],
    });
    chrome.contextMenus.create({
      id: MENU_SEND_VIEWPORT,
      title: "发送可见区域到 Wise",
      contexts: ["page"],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureContextMenus();
});
chrome.runtime.onStartup.addListener(() => {
  ensureContextMenus();
});
ensureContextMenus();

/**
 * @param {number} tabId
 * @param {string} [clickedImageSrc]
 * @param {{ selectionText?: string, pageUrl?: string, pageTitle?: string, linkUrl?: string }} [fallback]
 * @param {"selection" | "viewport"} [mode]
 */
async function collectSelection(tabId, clickedImageSrc, fallback = {}, mode = "selection") {
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      func: capturePageSelection,
      args: [String(clickedImageSrc || ""), mode],
    });
    const result = injected?.[0]?.result;
    if (result && typeof result === "object") {
      let text = String(result.text || "");
      if (!text.trim()) {
        const fallbackText = String(fallback.selectionText || "").trim();
        const linkUrl = String(fallback.linkUrl || "").trim();
        if (fallbackText) text = fallbackText;
        else if (/^https?:\/\//i.test(linkUrl)) text = linkUrl;
      }
      return {
        text,
        pageUrl: String(result.pageUrl || fallback.pageUrl || ""),
        pageTitle: String(result.pageTitle || fallback.pageTitle || ""),
        images: Array.isArray(result.images) ? result.images : [],
        rect: result.rect && typeof result.rect === "object" ? result.rect : null,
      };
    }
  } catch (err) {
    console.warn("[wise-page-monitor] capture selection failed", err);
  }
  const images = [];
  const src = String(clickedImageSrc || "").trim();
  if (/^https?:\/\//i.test(src) || src.startsWith("data:")) {
    images.push({ alt: "", mime: "", dataBase64: "", url: src.startsWith("data:") ? "" : src });
  }
  const linkUrl = String(fallback.linkUrl || "").trim();
  const text =
    String(fallback.selectionText || "").trim() ||
    (/^https?:\/\//i.test(linkUrl) ? linkUrl : "");
  return {
    text,
    pageUrl: String(fallback.pageUrl || ""),
    pageTitle: String(fallback.pageTitle || ""),
    images,
    rect: null,
  };
}

function selectionHasContent(payload) {
  const text = String(payload?.text || "").trim();
  const images = Array.isArray(payload?.images) ? payload.images : [];
  return Boolean(text) || images.length > 0;
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * @param {string} dataUrl
 * @param {{ x: number, y: number, width: number, height: number, dpr?: number } | null} rect
 */
async function cropVisibleTabScreenshot(dataUrl, rect) {
  if (!dataUrl) return null;
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    if (!blob || blob.size <= 0) return null;
    const bitmap = await createImageBitmap(blob);
    const crop = rect
      ? computeCropPixels(rect, rect.dpr || 1, bitmap.width, bitmap.height)
      : { sx: 0, sy: 0, sw: bitmap.width, sh: bitmap.height };
    const fitted = fitCropSize(crop.sw, crop.sh);
    const canvas = new OffscreenCanvas(fitted.width, fitted.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, fitted.width, fitted.height);
    let out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
    if (out.size > 4 * 1024 * 1024) {
      out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.62 });
    }
    if (!out || out.size <= 0 || out.size > 4 * 1024 * 1024) return null;
    return {
      alt: rect ? "选区截图" : "可见区域截图",
      mime: "image/jpeg",
      dataBase64: await blobToBase64(out),
      url: "",
    };
  } catch (err) {
    console.warn("[wise-page-monitor] crop screenshot failed", err);
    return null;
  }
}

async function captureTabScreenshot(tabId, rect) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg",
      quality: 80,
    });
    return cropVisibleTabScreenshot(dataUrl, rect);
  } catch (err) {
    console.warn("[wise-page-monitor] captureVisibleTab failed", err);
    return null;
  }
}

async function toastOnTab(tabId, message, ok) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: showWisePageToast,
      args: [String(message || ""), Boolean(ok)],
    });
  } catch {
    /* chrome:// and similar pages reject injection */
  }
}

async function confirmOnTab(tabId, preview) {
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      func: showWiseSelectionConfirm,
      args: [preview],
    });
    const result = injected?.[0]?.result;
    if (result && typeof result === "object") {
      return {
        cancelled: Boolean(result.cancelled),
        note: String(result.note || "").trim(),
      };
    }
  } catch (err) {
    console.warn("[wise-page-monitor] confirm overlay failed", err);
  }
  return { cancelled: false, note: "" };
}

/**
 * @param {number} tabId
 * @param {string} [clickedImageSrc]
 * @param {{ selectionText?: string, pageUrl?: string, pageTitle?: string, linkUrl?: string }} [fallback]
 * @param {"selection" | "viewport"} [mode]
 */
async function sendSelectionAsRequirement(tabId, clickedImageSrc, fallback = {}, mode = "selection") {
  const port = (await discoverBridgePort()) ?? bridgePort;
  const payload = await collectSelection(tabId, clickedImageSrc, fallback, mode);
  const shot = await captureTabScreenshot(tabId, mode === "viewport" ? null : payload.rect);
  if (shot) {
    payload.images = [shot, ...(Array.isArray(payload.images) ? payload.images : [])].slice(0, 8);
  }
  if (!selectionHasContent(payload)) {
    await toastOnTab(tabId, "请先选中文字、图片，或改用「发送可见区域」", false);
    return { ok: false, error: "empty" };
  }
  const confirmed = await confirmOnTab(tabId, {
    textPreview: String(payload.text || "").slice(0, 280),
    imageCount: payload.images.length,
    pageTitle: payload.pageTitle,
    hasScreenshot: Boolean(shot),
    mode,
  });
  if (confirmed.cancelled) {
    return { ok: false, error: "cancelled" };
  }
  payload.text = prependRequirementNote(confirmed.note, payload.text);
  delete payload.rect;
  const livePort = (await discoverBridgePort()) ?? port;
  try {
    const res = await fetch(`http://127.0.0.1:${livePort}/v1/requirements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      const error = String(data?.error || `HTTP ${res.status}`);
      await toastOnTab(tabId, `发送失败：${error}`, false);
      return { ok: false, error };
    }
    await toastOnTab(tabId, "已发送到 Wise 作为需求", true);
    return { ok: true };
  } catch {
    await toastOnTab(tabId, "未连接到 Wise，请先打开桌面端", false);
    return { ok: false, error: "offline" };
  }
}

async function sendFromActiveTab(clickedImageSrc, fallback = {}, mode = "selection") {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false, error: "no-tab" };
  return sendSelectionAsRequirement(tab.id, clickedImageSrc, {
    selectionText: fallback.selectionText,
    pageUrl: fallback.pageUrl || tab.url || "",
    pageTitle: fallback.pageTitle || tab.title || "",
    linkUrl: fallback.linkUrl,
  }, mode);
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const tabId = tab?.id;
  if (!tabId) return;
  const fallback = {
    selectionText: info.selectionText || "",
    pageUrl: info.pageUrl || tab.url || "",
    pageTitle: tab.title || "",
    linkUrl: info.linkUrl || "",
  };
  if (info?.menuItemId === MENU_SEND_VIEWPORT) {
    void sendSelectionAsRequirement(tabId, "", fallback, "viewport");
    return;
  }
  if (info?.menuItemId !== MENU_SEND_REQUIREMENT) return;
  void sendSelectionAsRequirement(tabId, info.srcUrl || "", fallback, "selection");
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "wise-send-selection") return;
  void sendFromActiveTab("");
});

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
  trailByTab.delete(tabId);
  alertedVitalsByTab.delete(tabId);
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
  trailByTab.delete(tabId);
  alertedVitalsByTab.delete(tabId);
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId != null) {
    attachedTabs.delete(source.tabId);
    trailByTab.delete(source.tabId);
    alertedVitalsByTab.delete(source.tabId);
  }
});

/** @type {Map<string, { method: string, url: string, timestamp: number }>} */
const requestMetaById = new Map();

function pushTrail(tabId, metric, message) {
  const m = String(metric || "").trim();
  const msg = String(message || "")
    .replace(/\n/g, " ")
    .trim();
  if (!m && !msg) return;
  const list = trailByTab.get(tabId) || [];
  list.push({ metric: m, message: msg.slice(0, 120) });
  while (list.length > TRAIL_MAX) list.shift();
  trailByTab.set(tabId, list);
}

function trailSuffix(tabId) {
  const list = trailByTab.get(tabId);
  if (!list || list.length === 0) return "";
  const body = list
    .map((item) => {
      if (!item.message) return item.metric;
      if (!item.metric) return item.message;
      return `${item.metric} ${item.message}`;
    })
    .join(" > ");
  return ` | trail: ${body}`;
}

function withTrail(tabId, message, attach) {
  const text = String(message || "").trim();
  if (!attach) return text;
  return `${text}${trailSuffix(tabId)}`;
}

function vitalsPoorAlert(metric, value, thresholds) {
  const t = thresholds || activeMonitor?.vitals || { lcpMs: 4000, cls: 0.25, inpMs: 500 };
  if (!Number.isFinite(value) || value < 0) return null;
  if (metric === "lcp" && value >= t.lcpMs) return `LCP ${Math.round(value)}ms exceeds ${t.lcpMs}ms`;
  if (metric === "cls" && value >= t.cls) return `CLS ${value} exceeds ${t.cls}`;
  if (metric === "inp" && value >= t.inpMs) return `INP ${Math.round(value)}ms exceeds ${t.inpMs}ms`;
  return null;
}

function noteVitalsAlert(tabId, metric) {
  const set = alertedVitalsByTab.get(tabId) || new Set();
  if (set.has(metric)) return false;
  set.add(metric);
  alertedVitalsByTab.set(tabId, set);
  return true;
}

async function resolveOrigLocation(sessionId, url, line, column) {
  try {
    const res = await fetch(`http://127.0.0.1:${bridgePort}/v1/source-location`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        url,
        line: Number(line) || 0,
        column: Number(column) || 0,
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json?.orig === "string" && json.orig ? json.orig : null;
  } catch {
    return null;
  }
}

async function captureBlankScreenEvidence(tabId, sessionId) {
  try {
    const shot = await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", {
      format: "jpeg",
      quality: 50,
    });
    const data = shot?.data;
    if (!data) return null;
    const res = await fetch(`http://127.0.0.1:${bridgePort}/v1/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, imageJpeg: data }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json?.path === "string" && json.path ? json.path : null;
  } catch {
    return null;
  }
}

function compactStackSuffix(details) {
  const frames = details?.stackTrace?.callFrames;
  if (!Array.isArray(frames) || frames.length === 0) return "";
  const parts = [];
  for (const frame of frames.slice(0, 4)) {
    const fn = String(frame?.functionName || "").trim() || "(anonymous)";
    const url = String(frame?.url || "").trim();
    const line = Number(frame?.lineNumber || 0);
    if (!url && fn === "(anonymous)") continue;
    parts.push(`${fn}@${url}:${line}`);
  }
  return parts.length ? ` | ${parts.join(" ")}` : "";
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  const meta = tabId != null ? attachedTabs.get(tabId) : null;
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
    const column = details.columnNumber ?? 0;
    void (async () => {
      let message = desc ? `${text}: ${desc}` : String(text);
      if (url) message += ` at ${url}:${line}`;
      const hasInlineStack = String(desc).includes("\n") || String(desc).includes(" at ");
      const stack = compactStackSuffix(details);
      if (stack && !hasInlineStack) message += stack;
      message = String(message).replace(/\n/g, " ").trim();
      if (!message) return;
      if (url) {
        const orig = await resolveOrigLocation(sessionId, url, line, column);
        if (orig && !message.includes("| orig ")) message += ` | orig ${orig}`;
      }
      void postIssue({
        sessionId,
        kind: "page-error",
        message: withTrail(tabId, message, true),
        url: url || null,
      });
    })();
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
    const kind = level === "warning" ? "console-warning" : "console-error";
    void postIssue({
      sessionId,
      kind,
      message: withTrail(tabId, message, kind === "console-error"),
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
      const alert = vitalsPoorAlert(metric, value, activeMonitor?.vitals);
      if (alert && noteVitalsAlert(tabId, metric)) {
        void postIssue({
          sessionId,
          kind: "vitals-alert",
          message: withTrail(tabId, alert, true),
          url: payload.url ? String(payload.url) : null,
          metric,
          value,
        });
      }
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
    } else if (payload.kind === "breadcrumb") {
      const metric = String(payload.metric || "")
        .trim()
        .toLowerCase();
      if (!["click", "input", "submit", "navigate"].includes(metric)) return;
      const message =
        String(payload.message || "")
          .replace(/\n/g, " ")
          .trim() || metric;
      pushTrail(tabId, metric, message);
      void postIssue({
        sessionId,
        kind: "breadcrumb",
        message,
        url: payload.url ? String(payload.url) : null,
        metric,
      });
    } else if (payload.kind === "timing") {
      const metric = String(payload.metric || "")
        .trim()
        .toLowerCase();
      const value = Number(payload.value);
      if (!["dcl", "load"].includes(metric) || !Number.isFinite(value) || value < 0) return;
      void postIssue({
        sessionId,
        kind: "page-timing",
        message: `${metric.toUpperCase()} ${Math.round(value)}ms`,
        url: payload.url ? String(payload.url) : null,
        metric,
        value,
        durationMs: Math.round(value),
      });
    } else if (payload.kind === "blank-screen") {
      const message =
        String(payload.message || "")
          .replace(/\n/g, " ")
          .trim() || "blank screen";
      void (async () => {
        const evidencePath = await captureBlankScreenEvidence(tabId, sessionId);
        const text = withTrail(tabId, message, true);
        void postIssue({
          sessionId,
          kind: "blank-screen",
          message: evidencePath ? `${text} evidence: ${evidencePath}` : text,
          url: payload.url ? String(payload.url) : null,
          value: Number.isFinite(Number(payload.value)) ? Number(payload.value) : null,
          evidencePath,
        });
      })();
    }
    return;
  }

  if (method === "Page.crashEvent") {
    void postIssue({
      sessionId,
      kind: "page-crash",
      message: withTrail(tabId, "main frame crashed", true),
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
    void Promise.all([pollOnce(), discoverBridgePort()]).then(([, port]) => {
      sendResponse({
        activeMonitor,
        bridgePort: port ?? bridgePort,
        attachedTabs: attachedTabs.size,
        wiseReady: Boolean(port),
      });
    });
    return true;
  }
  if (msg?.type === "wise-send-selection") {
    void sendFromActiveTab("").then(sendResponse);
    return true;
  }
  if (msg?.type === "wise-send-viewport") {
    void sendFromActiveTab("", {}, "viewport").then(sendResponse);
    return true;
  }
  return false;
});

void pollOnce();
